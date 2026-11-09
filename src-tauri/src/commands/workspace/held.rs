//! Writes held for an Admin: task and card edits signed by a key that may not write now.
//!
//! A write inside a task's or card's merge state carries the key that signed it. Until now it was merged whenever its
//! signature was good, whoever the key belonged to and whoever passed it on (RESEARCH.md §8j: a write signed by a Viewer's key,
//! or by a stranger's, was merged when an Editor carried it in). Here the key's role is looked up in the signed member list
//! this device holds, and a write that the list does not allow is not merged: it is kept apart, signed, in the held-writes
//! inbox, and an Owner or Admin accepts or discards each one.
//!
//! The verdict is "held", not "refused", for every case, because this device cannot tell the cases apart from the write
//! alone (the write does not say which version of the list it was made under): a removed member's edit may have been made
//! honestly before the removal (RESEARCH.md §8i: 0.3 to 4.7 such edits per removal), a demoted member's edit before the
//! demotion, and a key this device does not know may be a new member whose list version has not arrived yet. So nothing is
//! thrown away, and nothing a device may not write is merged.
//!
//! A write with no signature (from before signing, or from a device that does not sign) cannot be judged and is merged as
//! before. A device that holds no member list judges nothing.

use std::collections::{HashMap, HashSet};

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

use super::chat::chatlog::{self, Role};
use super::crdt::{self, Crdt, RecordState, Sibling};
use super::models::{KanbanCard, Task};
use super::chat::moderation;
use super::data_sync;
use crate::commands::config::validate_allowed_root;
use crate::database::WorkspaceDb;

/// The reason given to a write kept because this device's person asked to review other people's changes first
pub const REVIEW_REASON: &str = "you asked to review changes from others first";

/// Whether this device keeps other people's changes to tasks and cards apart until they are accepted
pub fn review_on(conn: &Connection) -> bool {
    conn.query_row("SELECT value FROM log_settings WHERE key = 'review'", [], |r| r.get::<_, String>(0)).optional().ok().flatten().is_some_and(|v| v == "1")
}

pub fn set_review(conn: &Connection, on: bool) -> Result<(), String> {
    conn.execute("INSERT INTO log_settings (key, value) VALUES ('review', ?1) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [if on { "1" } else { "0" }]).map(|_| ()).map_err(|e| e.to_string())
}

/// Most writes kept; a flood of them from a stranger does not grow the database without end
const KEEP: i64 = 500;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Verdict {
    Allow,
    Hold(&'static str),
    /// The write names a version of the member list under which its key could not write, and is dropped
    Refuse(&'static str),
}

impl Verdict {
    /// A write that would be merged is kept for review instead when it is new here and review is on
    pub fn or_review(self, new_and_reviewing: bool) -> Verdict {
        match self {
            Verdict::Allow if new_and_reviewing => Verdict::Hold(REVIEW_REASON),
            other => other,
        }
    }
}

/// The version of the member list this workspace holds, or 0 when it holds none
pub fn list_epoch(conn: &Connection) -> u64 {
    let doc: Option<String> = conn.query_row("SELECT doc FROM membership WHERE id = 1", [], |r| r.get(0)).optional().ok().flatten();
    doc.and_then(|d| serde_json::from_str::<serde_json::Value>(&d).ok()).and_then(|v| v.get("epoch").and_then(|e| e.as_u64())).unwrap_or(0)
}

/// Who held which role under one past version of the member list
#[derive(Debug, Clone, Default)]
struct PastList {
    owner: String,
    roles: HashMap<String, Role>,
}

/// What this device knows about who may write
#[derive(Debug, Clone, Default)]
pub struct Gate {
    /// Whether this device holds a member list at all
    pub listed: bool,
    pub owner: String,
    pub roles: HashMap<String, Role>,
    removed: HashSet<String>,
    banned: HashSet<String>,
    timed_out: HashSet<String>,
    /// Versions of the member list this device has held, by number
    history: HashMap<u64, PastList>,
    /// This device's person asked to review other people's changes before they apply
    pub review: bool,
}

impl Gate {
    /// The signed member list stored with the workspace, and the moderation entries of the log
    pub fn load(conn: &Connection, now: u64) -> Gate {
        let (list, state) = moderation::load(conn, now);
        let review = review_on(conn);
        let Some(list) = list else { return Gate { review, ..Gate::default() } };
        let roles: HashMap<String, Role> = list.members.iter().filter_map(|(k, r)| Role::parse(r).map(|r| (k.clone(), r))).collect();
        let history = conn
            .prepare("SELECT epoch, doc FROM membership_history")
            .and_then(|mut stmt| {
                stmt.query_map([], |r| Ok((r.get::<_, i64>(0)? as u64, r.get::<_, String>(1)?))).map(|rows| rows.filter_map(|r| r.ok()).collect::<Vec<_>>())
            })
            .unwrap_or_default()
            .into_iter()
            .filter_map(|(epoch, doc)| {
                let m = serde_json::from_str::<crate::commands::p2p::membership::Membership>(&doc).ok().filter(|m| m.verify().is_ok())?;
                let roles = m.members.iter().filter_map(|(k, r)| Role::parse(r).map(|r| (k.clone(), r))).collect();
                Some((epoch, PastList { owner: m.owner.clone(), roles }))
            })
            .collect();
        Gate {
            review,
            history,
            listed: true,
            owner: list.owner.clone(),
            removed: list.removed.iter().cloned().collect(),
            banned: state.banned.iter().map(|b| b.key.clone()).collect(),
            timed_out: state.timeouts.iter().map(|t| t.key.clone()).collect(),
            roles,
        }
    }

    pub fn verdict(&self, by: &str) -> Verdict {
        if !self.listed || by == self.owner {
            return Verdict::Allow;
        }
        if self.banned.contains(by) {
            return Verdict::Hold("the device was banned");
        }
        if self.removed.contains(by) && !self.roles.contains_key(by) {
            return Verdict::Hold("the device was removed from the workspace");
        }
        if self.timed_out.contains(by) {
            return Verdict::Hold("the device is timed out");
        }
        match self.roles.get(by) {
            Some(r) if *r >= Role::Editor => Verdict::Allow,
            Some(_) => Verdict::Hold("the role of the device does not let it change things"),
            None => Verdict::Hold("the device is not on the member list this device holds"),
        }
    }

    /// The verdict on one write: the key's standing now, and, when the write names the version of the member list it was made
    /// under and this device has held that version, whether the key could write under it. A write the key could not have made
    /// is dropped; one it could have made then but may not now (removed or demoted since) is held, since a writer can claim an
    /// old version and nothing tells that apart from an honest old write. A version this device never held is not judged.
    pub fn verdict_of(&self, s: &Sibling) -> Verdict {
        let Some(by) = s.by.as_deref() else { return Verdict::Allow };
        if self.listed {
            if let Some(past) = s.ep.and_then(|e| self.history.get(&e)) {
                let could = by == past.owner || past.roles.get(by).is_some_and(|r| *r >= Role::Editor);
                if !could {
                    return Verdict::Refuse("the device could not write under the member list it names");
                }
            }
        }
        self.verdict(by)
    }

    /// Whether the device with this key may review held writes: the Owner and Admins, or anyone on a device with no list
    pub fn may_review(&self, me: &str) -> bool {
        !self.listed || me == self.owner || self.roles.get(me).is_some_and(|r| *r >= Role::Admin)
    }
}

/// Keeps a write apart. The same write is kept once however often it arrives.
pub fn hold(conn: &Connection, entity: &str, record: &str, path: &str, s: &Sibling, reason: &str, now: u64) -> Result<(), String> {
    conn.execute(
        "INSERT OR IGNORE INTO held_writes (entity, record, path, replica, counter, by_key, who, ts, value, sibling, reason, held_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
        params![
            entity,
            record,
            path,
            s.dot.r,
            s.dot.c as i64,
            s.by.clone().unwrap_or_default(),
            s.who.clone().unwrap_or_default(),
            s.ts as i64,
            s.value.to_string(),
            serde_json::to_string(s).map_err(|e| e.to_string())?,
            reason,
            now as i64
        ],
    )
    .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM held_writes WHERE id NOT IN (SELECT id FROM held_writes ORDER BY id DESC LIMIT ?1)", [KEEP]).map(|_| ()).map_err(|e| e.to_string())
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Held {
    pub id: i64,
    pub entity: String,
    pub record: String,
    /// The record's title here, or empty when this device has no such record
    pub title: String,
    pub path: String,
    /// The value, as JSON text
    pub value: String,
    /// The device key that signed it, and the name it wrote under
    pub by: String,
    pub who: String,
    pub ts: u64,
    pub held_at: u64,
    pub reason: String,
}

pub fn list(conn: &Connection) -> Result<Vec<Held>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT h.id, h.entity, h.record, COALESCE((SELECT title FROM tasks WHERE id = h.record), (SELECT title FROM kanban_cards WHERE id = h.record), ''),
                    h.path, h.value, h.by_key, h.who, h.ts, h.held_at, h.reason
             FROM held_writes h ORDER BY h.held_at DESC, h.id DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(Held { id: r.get(0)?, entity: r.get(1)?, record: r.get(2)?, title: r.get(3)?, path: r.get(4)?, value: r.get(5)?, by: r.get(6)?, who: r.get(7)?, ts: r.get::<_, i64>(8)? as u64, held_at: r.get::<_, i64>(9)? as u64, reason: r.get(10)? })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<rusqlite::Result<Vec<_>>>().map_err(|e| e.to_string())
}

pub fn count(conn: &Connection) -> i64 {
    let writes: i64 = conn.query_row("SELECT COUNT(*) FROM held_writes", [], |r| r.get(0)).unwrap_or(0);
    let entries: i64 = conn.query_row("SELECT COUNT(*) FROM held_entries", [], |r| r.get(0)).unwrap_or(0);
    writes + entries
}

// ────────────────────────────
// Messages and comments of a timed-out member
// ────────────────────────────
//
// A chat message or comment signed by a member who is timed out is not shown or passed on, but it is kept, signed, for an Owner
// or Admin to accept or discard, as the task and card writes above are. A member's older message that reaches this device only
// after their timeout began waits here too: nothing tells the two apart, so nothing is thrown away.

/// Kinds of entry that are held. Reactions, edits and the like from a timed-out member are simply not taken.
pub fn holdable(kind: &str) -> bool {
    matches!(kind, "message" | "comment")
}

/// Keeps an entry apart, once however often it arrives. An entry this device already has is not kept again.
pub fn hold_entry(conn: &Connection, e: &chatlog::Entry, now: u64) -> Result<(), String> {
    let have: bool = conn.query_row("SELECT COUNT(*) > 0 FROM log_entries WHERE id = ?1", [&e.id], |r| r.get(0)).map_err(|x| x.to_string())?;
    if have {
        return Ok(());
    }
    conn.execute(
        "INSERT OR IGNORE INTO held_entries (id, entry, author, name, kind, ts, held_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![e.id, serde_json::to_string(e).map_err(|x| x.to_string())?, e.author, e.name, e.kind, e.ts as i64, now as i64],
    )
    .map_err(|x| x.to_string())?;
    conn.execute("DELETE FROM held_entries WHERE id NOT IN (SELECT id FROM held_entries ORDER BY held_at DESC, rowid DESC LIMIT ?1)", [KEEP]).map(|_| ()).map_err(|x| x.to_string())
}

pub fn list_entries(conn: &Connection) -> Result<Vec<chatlog::Entry>, String> {
    let mut stmt = conn.prepare("SELECT entry FROM held_entries ORDER BY ts ASC").map_err(|x| x.to_string())?;
    let rows = stmt.query_map([], |r| r.get::<_, String>(0)).map_err(|x| x.to_string())?;
    Ok(rows.filter_map(Result::ok).filter_map(|t| serde_json::from_str(&t).ok()).collect())
}

pub fn discard_entry(conn: &Connection, id: &str) -> Result<(), String> {
    conn.execute("DELETE FROM held_entries WHERE id = ?1", [id]).map(|_| ()).map_err(|x| x.to_string())
}

/// Takes a held entry into the log, judged by the role its author has in the member list (the timeout is set aside)
pub fn accept_entry(conn: &Connection, id: &str, now: u64) -> Result<Option<chatlog::Entry>, String> {
    let text: Option<String> = conn.query_row("SELECT entry FROM held_entries WHERE id = ?1", [id], |r| r.get(0)).optional().map_err(|x| x.to_string())?;
    let Some(text) = text else { return Ok(None) };
    let entry: chatlog::Entry = serde_json::from_str(&text).map_err(|x| x.to_string())?;
    let (list, _) = moderation::load(conn, now);
    let Some(list) = list else { return Err("This device holds no member list.".into()) };
    let roles: HashMap<String, Role> = list.members.iter().filter_map(|(k, r)| Role::parse(r).map(|r| (k.clone(), r))).collect();
    let owner = list.owner.clone();
    let role_of = move |k: &str| if k == owner { Some(Role::Owner) } else { roles.get(k).copied() };
    let me = super::signing::device_key().unwrap_or_default();
    let merged = chatlog::merge(conn, vec![entry], &chatlog::Ctx { me: &me, now, role_of: &role_of })?;
    discard_entry(conn, id)?;
    Ok(merged.added.into_iter().next())
}

#[tauri::command(async)]
pub fn held_entries_list(app: tauri::AppHandle, path: String) -> Result<Vec<chatlog::Entry>, String> {
    validate_allowed_root(&app, &path)?;
    list_entries(&WorkspaceDb::open_existing(&path)?.conn)
}

fn entry_reviewer(conn: &Connection) -> Result<(), String> {
    let me = super::signing::device_key().unwrap_or_default();
    if Gate::load(conn, crdt::now_ms()).may_review(&me) {
        Ok(())
    } else {
        Err("Only the Owner and Admins review held messages.".into())
    }
}

#[tauri::command(async)]
pub fn held_entry_accept(app: tauri::AppHandle, path: String, id: String) -> Result<(), String> {
    use tauri::Emitter;
    validate_allowed_root(&app, &path)?;
    let db = WorkspaceDb::open_existing(&path)?;
    entry_reviewer(&db.conn)?;
    accept_entry(&db.conn, &id, crdt::now_ms())?;
    let _ = app.emit(crate::commands::p2p::chat::EVENT_LOG, ());
    Ok(())
}

#[tauri::command(async)]
pub fn held_entry_discard(app: tauri::AppHandle, path: String, id: String) -> Result<(), String> {
    validate_allowed_root(&app, &path)?;
    let db = WorkspaceDb::open_existing(&path)?;
    entry_reviewer(&db.conn)?;
    discard_entry(&db.conn, &id)
}

pub fn discard(conn: &Connection, id: i64) -> Result<(), String> {
    conn.execute("DELETE FROM held_writes WHERE id = ?1", [id]).map(|_| ()).map_err(|e| e.to_string())
}

/// Merges one held write into its record, as if it had just arrived from a device that may write, and forgets it
pub fn accept(conn: &Connection, ws_id: &str, id: i64) -> Result<(), String> {
    let row: Option<(String, String, String, String)> = conn
        .query_row("SELECT entity, record, path, sibling FROM held_writes WHERE id = ?1", [id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
        .optional()
        .map_err(|e| e.to_string())?;
    let Some((entity, record, path, sibling)) = row else { return Ok(()) };
    let sibling: Sibling = serde_json::from_str(&sibling).map_err(|e| e.to_string())?;
    match entity.as_str() {
        data_sync::ENTITY_TASK => adopt_task(conn, ws_id, &record, &path, sibling)?,
        data_sync::ENTITY_CARD => adopt_card(conn, ws_id, &record, &path, sibling)?,
        _ => return Err("That kind of record cannot be accepted here.".into()),
    }
    discard(conn, id)
}

fn state_of<T: Crdt>(conn: &Connection, local: Option<&T>, id: &str) -> Result<RecordState, String> {
    Ok(match crdt::load(conn, T::ENTITY, id)? {
        Some(s) => s,
        None => local.map(|l| RecordState::from_legacy(l.paths(false), crdt::ts_of(l.updated_at()))).unwrap_or_default(),
    })
}

fn adopt_task(conn: &Connection, ws_id: &str, id: &str, path: &str, sibling: Sibling) -> Result<(), String> {
    let local = data_sync::read_task(conn, id)?;
    let mut state = state_of(conn, local.as_ref(), id)?;
    state.adopt(path, sibling);
    crdt::save(conn, Task::ENTITY, id, &state)?;
    let now = chrono::Utc::now().to_rfc3339();
    let base = local.unwrap_or_else(|| Task { id: id.to_string(), created_at: now, ..Default::default() });
    let mut row = Task::materialize(&base, &state.resolved());
    row.set_updated_at(crdt::rfc3339_of(state.max_ts()));
    data_sync::put_task_row(conn, ws_id, &row)
}

fn adopt_card(conn: &Connection, ws_id: &str, id: &str, path: &str, sibling: Sibling) -> Result<(), String> {
    let local = data_sync::read_card(conn, id)?;
    let mut state = state_of(conn, local.as_ref(), id)?;
    state.adopt(path, sibling);
    crdt::save(conn, KanbanCard::ENTITY, id, &state)?;
    let now = chrono::Utc::now().to_rfc3339();
    let base = local.unwrap_or_else(|| KanbanCard { id: id.to_string(), created_at: now.clone(), ..Default::default() });
    let mut row = KanbanCard::materialize(&base, &state.resolved());
    row.set_updated_at(crdt::rfc3339_of(state.max_ts()));
    let column_exists = conn.query_row("SELECT 1 FROM kanban_columns WHERE id = ?1", [&row.column_id], |_| Ok(())).optional().map_err(|e| e.to_string())?.is_some();
    if !column_exists {
        conn.execute(
            "INSERT OR IGNORE INTO kanban_columns (id, workspace_id, title, position, created_at, updated_at) VALUES (?1, ?2, 'Recovered', 9999, ?3, ?3)",
            params![data_sync::RECOVERED_COLUMN, ws_id, now],
        )
        .map_err(|e| e.to_string())?;
        row.column_id = data_sync::RECOVERED_COLUMN.to_string();
    }
    data_sync::put_card(conn, ws_id, &row)
}

// ────────────────────────────
// Commands
// ────────────────────────────

#[tauri::command(async)]
pub fn held_list(app: tauri::AppHandle, path: String) -> Result<Vec<Held>, String> {
    validate_allowed_root(&app, &path)?;
    list(&WorkspaceDb::open_existing(&path)?.conn)
}

/// Who may accept or discard a held write: the Owner and Admins, and anyone for a change kept only because they asked to see
/// it first (it is their own device's intake)
fn reviewer(conn: &Connection, id: i64) -> Result<(), String> {
    let reason: Option<String> = conn.query_row("SELECT reason FROM held_writes WHERE id = ?1", [id], |r| r.get(0)).optional().map_err(|e| e.to_string())?;
    if reason.as_deref() == Some(REVIEW_REASON) {
        return Ok(());
    }
    let me = super::signing::device_key().unwrap_or_default();
    if Gate::load(conn, crdt::now_ms()).may_review(&me) {
        Ok(())
    } else {
        Err("Only the Owner and Admins review held changes.".into())
    }
}

#[tauri::command(async)]
pub fn held_review_get(app: tauri::AppHandle, path: String) -> Result<bool, String> {
    validate_allowed_root(&app, &path)?;
    Ok(review_on(&WorkspaceDb::open_existing(&path)?.conn))
}

#[tauri::command(async)]
pub fn held_review_set(app: tauri::AppHandle, path: String, on: bool) -> Result<(), String> {
    validate_allowed_root(&app, &path)?;
    set_review(&WorkspaceDb::open_existing(&path)?.conn, on)
}

#[tauri::command(async)]
pub fn held_accept(app: tauri::AppHandle, path: String, id: i64) -> Result<(), String> {
    validate_allowed_root(&app, &path)?;
    let db = WorkspaceDb::open_existing(&path)?;
    reviewer(&db.conn, id)?;
    let ws_id = super::helpers::get_workspace_id(&db)?;
    accept(&db.conn, &ws_id, id)
}

#[tauri::command(async)]
pub fn held_discard(app: tauri::AppHandle, path: String, id: i64) -> Result<(), String> {
    validate_allowed_root(&app, &path)?;
    let db = WorkspaceDb::open_existing(&path)?;
    reviewer(&db.conn, id)?;
    discard(&db.conn, id)
}

#[cfg(test)]
mod tests;
