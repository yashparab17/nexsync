//! Chat and comments over the links between devices.
//!
//! The log of signed entries (`workspace/chatlog.rs`) is passed around as the entries themselves. An entry says who wrote it
//! and carries their signature, so any device may pass one on and any device checks it against the signed member list: the
//! Owner's device is not the only way an entry travels, and no device has to be trusted to say who wrote what. A device
//! that receives new entries stores them, tells the app, and sends them on to its other links; entries it already has are
//! ignored, so nothing loops.
//!
//! A device that has just linked says which entries it holds (`LOG_HAVE`, their ids) and the other side sends the rest, the
//! newest first and up to a limit, so a member who was away catches up and a new member gets recent history, not all of it.

use std::{
    collections::{HashMap, HashSet, VecDeque},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use serde::Serialize;
use tauri::{AppHandle, State};

use super::node::Node;
use super::P2pState;
use crate::commands::config::validate_allowed_root;
use crate::commands::workspace::chat::chatlog::{self, Ctx, Entry, Role};
use crate::commands::workspace::{crdt, signing};
use crate::database::WorkspaceDb;

pub const KIND_LOG: &str = "LOG";
pub const KIND_LOG_HAVE: &str = "LOG_HAVE";
/// Tells the app that entries arrived
pub const EVENT_LOG: &str = "p2p://log-changed";
/// Tells the app that what is in force (timeouts, bans, kicks to carry out, approvals waiting) changed
pub const EVENT_MODERATION: &str = "p2p://moderation-changed";

/// Entries one message may carry, and the size past which a batch is split
const BATCH_ENTRIES: usize = 100;
const BATCH_BYTES: usize = 256 * 1024;
/// How many entries one link may deliver in a minute, whatever their authors; catching up fits well inside it
const LINK_BUDGET: usize = 3_000;
/// How many new entries one author may have delivered live in ten seconds. A removed device that is still connected, or
/// one that simply sends as much as it likes, is slowed here: with no server, nothing else does it.
const AUTHOR_BURST: usize = 40;

pub fn is_log_kind(kind: &str) -> bool {
    kind == KIND_LOG || kind == KIND_LOG_HAVE
}

/// Who may do what, as this device's signed member list (or, before it has one, the roles it was told) has it
#[derive(Debug, Clone, Default)]
pub struct RoleView {
    pub owner: Option<String>,
    pub roles: HashMap<String, String>,
    pub me: String,
    /// Members who are timed out or banned right now: they count as Viewers, so what they write is refused
    pub muted: HashSet<String>,
}

impl RoleView {
    /// The role in the member list, whatever moderation says
    pub fn base_role_of(&self, key: &str) -> Option<Role> {
        if self.owner.as_deref() == Some(key) {
            return Some(Role::Owner);
        }
        self.roles.get(key).and_then(|r| Role::parse(r))
    }

    /// The role that counts now: a member who is timed out or banned may not write
    pub fn role_of(&self, key: &str) -> Option<Role> {
        let role = self.base_role_of(key)?;
        if role != Role::Owner && self.muted.contains(key) {
            return Some(Role::Viewer);
        }
        Some(role)
    }

    /// A device that has no one else to ask: it is its own owner
    pub fn solo(me: &str) -> RoleView {
        RoleView { owner: Some(me.to_string()), roles: HashMap::new(), me: me.to_string(), muted: HashSet::new() }
    }
}

/// A sliding window of what arrived, to hold a link or an author to a rate
#[derive(Default)]
struct Window(VecDeque<(Instant, usize)>);

impl Window {
    /// Adds `n` and returns whether the total in the last `span` is still within `limit`
    fn allow(&mut self, now: Instant, span: Duration, n: usize, limit: usize) -> bool {
        while self.0.front().is_some_and(|(t, _)| now.duration_since(*t) > span) {
            self.0.pop_front();
        }
        let total: usize = self.0.iter().map(|(_, c)| c).sum();
        if total + n > limit {
            return false;
        }
        self.0.push_back((now, n));
        true
    }
}

static LINKS: Mutex<Option<HashMap<String, Window>>> = Mutex::new(None);
static AUTHORS: Mutex<Option<HashMap<String, Window>>> = Mutex::new(None);

fn within(map: &Mutex<Option<HashMap<String, Window>>>, key: &str, span: Duration, n: usize, limit: usize) -> bool {
    let mut guard = map.lock().unwrap_or_else(|p| p.into_inner());
    guard.get_or_insert_with(HashMap::new).entry(key.to_string()).or_default().allow(Instant::now(), span, n, limit)
}

/// Splits entries into messages that stay well inside a frame
fn batches(entries: Vec<Entry>) -> Vec<Vec<Entry>> {
    let mut out: Vec<Vec<Entry>> = Vec::new();
    let (mut current, mut bytes) = (Vec::new(), 0usize);
    for e in entries {
        let size = e.body.len() + 400;
        if !current.is_empty() && (current.len() >= BATCH_ENTRIES || bytes + size > BATCH_BYTES) {
            out.push(std::mem::take(&mut current));
            bytes = 0;
        }
        bytes += size;
        current.push(e);
    }
    if !current.is_empty() {
        out.push(current);
    }
    out
}

async fn send_entries(node: &Arc<Node>, target: Option<&str>, entries: Vec<Entry>, catch_up: bool) {
    for batch in batches(entries) {
        let message = serde_json::json!({ "kind": KIND_LOG, "timestamp": crdt::now_ms(), "catchUp": catch_up, "entries": batch });
        let _ = node.send(target, &message).await;
    }
}

/// Sends an entry this device just wrote to every link
pub async fn publish(node: &Arc<Node>, entry: &Entry) {
    send_entries(node, None, vec![entry.clone()], false).await;
}

/// Asks a peer that has just linked for the entries this device lacks
pub async fn catch_up(node: Arc<Node>, peer_id: String) {
    let Some(workspace) = node.workspace_path() else { return };
    let ids = tokio::task::spawn_blocking(move || WorkspaceDb::open_existing(&workspace).and_then(|db| chatlog::have(&db.conn))).await;
    if let Ok(Ok(ids)) = ids {
        let _ = node.send(Some(&peer_id), &serde_json::json!({ "kind": KIND_LOG_HAVE, "timestamp": crdt::now_ms(), "ids": ids })).await;
    }
}

/// Handles a `LOG` or `LOG_HAVE` message from a peer
pub async fn handle(node: Arc<Node>, from: String, message: serde_json::Value) {
    let Some(workspace) = node.workspace_path() else { return };
    match message.get("kind").and_then(|k| k.as_str()) {
        Some(KIND_LOG) => on_entries(node, from, workspace, message).await,
        Some(KIND_LOG_HAVE) => on_have(node, from, workspace, message).await,
        _ => {}
    }
}

async fn on_entries(node: Arc<Node>, from: String, workspace: String, message: serde_json::Value) {
    let Some(raw) = message.get("entries").cloned() else { return };
    let Ok(mut entries) = serde_json::from_value::<Vec<Entry>>(raw) else {
        eprintln!("[log] Dropped a malformed batch of entries");
        return;
    };
    entries.truncate(BATCH_ENTRIES);
    if !within(&LINKS, &from, Duration::from_secs(60), entries.len(), LINK_BUDGET) {
        eprintln!("[log] A link is sending entries faster than allowed; dropped a batch");
        return;
    }
    let catching_up = message.get("catchUp").and_then(|c| c.as_bool()).unwrap_or(false);
    if !catching_up {
        // Live entries from one author are slowed; the check counts only entries this device has not seen yet
        let mut counts: HashMap<String, usize> = HashMap::new();
        entries.retain(|e| {
            let n = counts.entry(e.author.clone()).or_insert(0);
            *n += 1;
            within(&AUTHORS, &e.author, Duration::from_secs(10), 1, AUTHOR_BURST)
        });
    }
    if entries.is_empty() {
        return;
    }
    let view = node.role_view();
    // Messages and comments of a member who is timed out are kept apart for an Admin, not refused (held.rs)
    let (held, entries): (Vec<Entry>, Vec<Entry>) = entries.into_iter().partition(|e| {
        crate::commands::workspace::held::holdable(&e.kind) && view.muted.contains(&e.author) && e.signature_ok() && view.base_role_of(&e.author).is_some_and(|r| r >= Role::Commenter)
    });
    let merged = tokio::task::spawn_blocking(move || {
        let db = WorkspaceDb::open_existing(&workspace)?;
        for e in &held {
            crate::commands::workspace::held::hold_entry(&db.conn, e, crdt::now_ms())?;
        }
        let role_of = |k: &str| view.role_of(k);
        chatlog::merge(&db.conn, entries, &Ctx { me: &view.me, now: crdt::now_ms(), role_of: &role_of })
    })
    .await;
    let Ok(Ok(merged)) = merged else { return };
    if merged.added.is_empty() {
        return;
    }
    node.emit(EVENT_LOG, serde_json::json!({ "count": merged.added.len() }));
    if merged.added.iter().any(|e| e.kind == crate::commands::workspace::chat::moderation::KIND) {
        node.refresh_moderation();
    }
    // Pass what was new on to the other links; each of them ignores what it already has
    let others: Vec<String> = node.peers().into_iter().map(|p| p.id).filter(|id| *id != from).collect();
    for id in others {
        send_entries(&node, Some(&id), merged.added.clone(), false).await;
    }
}

async fn on_have(node: Arc<Node>, from: String, workspace: String, message: serde_json::Value) {
    let Some(ids) = message.get("ids").and_then(|v| v.as_array()) else { return };
    let have: HashSet<String> = ids.iter().filter_map(|v| v.as_str().map(str::to_string)).take(chatlog::HAVE_LIMIT).collect();
    let entries = tokio::task::spawn_blocking(move || WorkspaceDb::open_existing(&workspace).and_then(|db| chatlog::missing(&db.conn, &have))).await;
    if let Ok(Ok(entries)) = entries {
        if !entries.is_empty() {
            send_entries(&node, Some(&from), entries, true).await;
        }
    }
}

// ────────────────────────────
// Commands
// ────────────────────────────

/// Writes an entry as this device, stores it and sends it to every link
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn chat_post(app: AppHandle, state: State<'_, P2pState>, path: String, kind: String, channel: String, parent: String, body: String, name: String) -> Result<Entry, String> {
    validate_allowed_root(&app, &path)?;
    let me = signing::device_key().ok_or("This device has no key yet.")?;
    let node = state.existing().await;
    let view = node.as_ref().map(|n| n.role_view()).unwrap_or_else(|| RoleView::solo(&me));
    let entry = {
        let path = path.clone();
        tokio::task::spawn_blocking(move || {
            let db = WorkspaceDb::open_existing(&path)?;
            let role_of = |k: &str| view.role_of(k);
            chatlog::post(&db.conn, &kind, &channel, &parent, &body, &name, crdt::now_ms(), &role_of)
        })
        .await
        .map_err(|e| e.to_string())??
    };
    if let Some(node) = node {
        publish(&node, &entry).await;
        if entry.kind == crate::commands::workspace::chat::moderation::KIND {
            node.refresh_moderation();
        }
    }
    Ok(entry)
}

/// What the Members screen needs: what is in force, who was removed, who this device is and how many writes are held
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModerationView {
    pub state: crate::commands::workspace::chat::moderation::State,
    /// Keys of the people who were removed from the workspace, for the Removed badge
    pub removed: Vec<String>,
    pub me: String,
    pub held: i64,
}

#[tauri::command(async)]
pub fn moderation_state(app: AppHandle, path: String) -> Result<ModerationView, String> {
    validate_allowed_root(&app, &path)?;
    let db = WorkspaceDb::open_existing(&path)?;
    let (list, state) = crate::commands::workspace::chat::moderation::load(&db.conn, crdt::now_ms());
    Ok(ModerationView { state, removed: list.map(|m| m.removed).unwrap_or_default(), me: signing::device_key().unwrap_or_default(), held: crate::commands::workspace::held::count(&db.conn) })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatState {
    pub entries: Vec<Entry>,
    pub read: Vec<chatlog::ReadState>,
    pub me: String,
    /// When this device first held each entry, by id
    pub seen: HashMap<String, u64>,
}

/// Everything the chat and comment views need: the entries, the read markers, and this device's key
#[tauri::command(async)]
pub fn chat_state(app: AppHandle, path: String) -> Result<ChatState, String> {
    validate_allowed_root(&app, &path)?;
    let db = WorkspaceDb::open_existing(&path)?;
    Ok(ChatState { entries: chatlog::list(&db.conn)?, read: chatlog::read_states(&db.conn)?, me: signing::device_key().unwrap_or_default(), seen: chatlog::seen(&db.conn)? })
}

/// The body of a direct message to `to`, sealed so only that device and this one can read it; post it with kind "dm" on the
/// channel `dm_channel` returns
#[tauri::command(async)]
pub fn dm_seal(to: String, text: String) -> Result<String, String> {
    let key = signing::device_secret().ok_or("This device has no key yet.")?;
    crate::commands::workspace::chat::dm::body_for(key, &to, &text).ok_or_else(|| "That member's device key is not valid.".to_string())
}

#[tauri::command(async)]
pub fn dm_channel(with: String) -> Result<String, String> {
    let me = signing::device_key().ok_or("This device has no key yet.")?;
    Ok(crate::commands::workspace::chat::dm::channel_of(&me, &with))
}

/// Opens the direct messages among the given entries that this device wrote or was sent: entry id to text
#[tauri::command(async)]
pub fn dm_open(entries: Vec<(String, String, String)>) -> std::collections::HashMap<String, String> {
    let Some(key) = signing::device_secret() else { return Default::default() };
    entries.into_iter().filter_map(|(id, author, body)| crate::commands::workspace::chat::dm::read_entry(key, &author, &body).map(|t| (id, t))).collect()
}

#[tauri::command(async)]
pub fn chat_get_history_limit(app: AppHandle, path: String) -> Result<usize, String> {
    validate_allowed_root(&app, &path)?;
    chatlog::history_limit(&WorkspaceDb::open_existing(&path)?.conn)
}

#[tauri::command(async)]
pub fn chat_set_history_limit(app: AppHandle, path: String, limit: usize) -> Result<(), String> {
    validate_allowed_root(&app, &path)?;
    chatlog::set_history_limit(&WorkspaceDb::open_existing(&path)?.conn, limit)
}

#[tauri::command(async)]
pub fn chat_mark_read(app: AppHandle, path: String, channel: String, ts: u64) -> Result<(), String> {
    validate_allowed_root(&app, &path)?;
    chatlog::mark_read(&WorkspaceDb::open_existing(&path)?.conn, &channel, ts)
}

#[tauri::command(async)]
pub fn chat_set_muted(app: AppHandle, path: String, channel: String, muted: bool) -> Result<(), String> {
    validate_allowed_root(&app, &path)?;
    chatlog::set_muted(&WorkspaceDb::open_existing(&path)?.conn, &channel, muted)
}

#[tauri::command(async)]
pub fn inbox_list(app: AppHandle, path: String) -> Result<Vec<chatlog::InboxItem>, String> {
    validate_allowed_root(&app, &path)?;
    chatlog::inbox_list(&WorkspaceDb::open_existing(&path)?.conn)
}

#[tauri::command(async)]
pub fn inbox_add(app: AppHandle, path: String, kind: String, reference: String, snippet: String, channel: Option<String>, author: Option<String>) -> Result<(), String> {
    validate_allowed_root(&app, &path)?;
    let snippet: String = snippet.chars().take(200).collect();
    chatlog::inbox_add(&WorkspaceDb::open_existing(&path)?.conn, &kind, &reference, channel.as_deref().unwrap_or(""), author.as_deref().unwrap_or(""), &snippet, crdt::now_ms())
}

/// Marks the given items read, or every item when none are given
#[tauri::command(async)]
pub fn inbox_mark_read(app: AppHandle, path: String, ids: Vec<i64>) -> Result<(), String> {
    validate_allowed_root(&app, &path)?;
    chatlog::inbox_mark_read(&WorkspaceDb::open_existing(&path)?.conn, &ids)
}

#[tauri::command(async)]
pub fn inbox_clear(app: AppHandle, path: String) -> Result<(), String> {
    validate_allowed_root(&app, &path)?;
    chatlog::inbox_clear(&WorkspaceDb::open_existing(&path)?.conn)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_window_allows_up_to_its_limit_and_forgets_what_is_older_than_its_span() {
        let mut w = Window::default();
        let start = Instant::now();
        assert!(w.allow(start, Duration::from_secs(10), 30, 40));
        assert!(w.allow(start, Duration::from_secs(10), 10, 40));
        assert!(!w.allow(start, Duration::from_secs(10), 1, 40), "the eleventh over the limit is refused");
        assert!(w.allow(start + Duration::from_secs(11), Duration::from_secs(10), 40, 40), "ten seconds later it is empty again");
    }

    #[test]
    fn batches_keep_each_message_small_and_lose_nothing() {
        let entry = |i: usize, size: usize| Entry { id: format!("e{i}"), kind: "message".into(), channel: "general".into(), parent: String::new(), author: "a".into(), name: "n".into(), ts: i as u64, body: "x".repeat(size), sig: "s".into() };
        let small: Vec<Entry> = (0..250).map(|i| entry(i, 10)).collect();
        let b = batches(small);
        assert_eq!(b.iter().map(Vec::len).collect::<Vec<_>>(), vec![100, 100, 50]);
        let big: Vec<Entry> = (0..5).map(|i| entry(i, 100_000)).collect();
        let b = batches(big);
        assert!(b.len() >= 2 && b.iter().map(Vec::len).sum::<usize>() == 5);
    }

    #[test]
    fn the_owner_and_listed_members_have_roles_and_nobody_else_does() {
        let view = RoleView { owner: Some("OWNER".into()), roles: [("ED".to_string(), "Editor".to_string()), ("CO".to_string(), "Commenter".to_string())].into(), me: "ED".into(), muted: HashSet::new() };
        assert_eq!(view.role_of("OWNER"), Some(Role::Owner));
        assert_eq!(view.role_of("ED"), Some(Role::Editor));
        assert_eq!(view.role_of("CO"), Some(Role::Commenter));
        assert_eq!(view.role_of("STRANGER"), None);
        assert_eq!(RoleView::solo("ME").role_of("ME"), Some(Role::Owner));
        // Timed out or banned, a member counts as a Viewer, and the Owner is never muted
        let muted = RoleView { muted: ["ED".to_string(), "OWNER".to_string()].into(), ..view };
        assert_eq!(muted.role_of("ED"), Some(Role::Viewer));
        assert_eq!(muted.base_role_of("ED"), Some(Role::Editor));
        assert_eq!(muted.role_of("OWNER"), Some(Role::Owner));
    }
}
