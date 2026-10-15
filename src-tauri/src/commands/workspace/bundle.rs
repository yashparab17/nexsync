//! A signed bundle of a workspace, to carry from one device to another by a USB stick or a shared folder when there is no network.
//!
//! The bundle holds what two devices exchange over a link: the signed member list, the signed log (chat, comments,
//! announcements, moderation), the task and card state with each write's signature, the files, and the stored state of each
//! shared text. It is checked like anything that arrives over a link, not trusted because it came by hand:
//!
//! - the exporter signs the bundle, and must be a member of the workspace in the newest member list the importing device
//!   holds or the bundle carries, and not banned or removed, so a bundle made by a removed member is refused whole;
//! - the member list in it is taken only if it is genuine, from the same workspace, signed by the owner and newer than the
//!   one held, so an old bundle cannot bring back a member who was removed since: its list is ignored and everything in it is
//!   judged by the newer list the device already has;
//! - log entries go through the same checks as live ones (signature, author's role, announcement and moderation rules);
//! - task and card writes go through the same merge as live ones, which holds a write whose key may not write (\`held.rs\`);
//! - a file is written only where this device has none and never over one it has, and never where it was erased for good.
//!
//! What the bundle cannot do: carry text merges (the Yjs state of a shared text is merged by the app, which has the library),
//! so those are returned for the app to merge; and it is only as current as the day it was made.
//!
//! The format is one JSON file: a small envelope with the exporter's key, a signature, and the content as one string, so the
//! signature covers exactly the bytes that were written.

use std::collections::HashMap;
use std::path::Path;

use base64::prelude::{Engine, BASE64_STANDARD};
use rusqlite::params;
use serde::{Deserialize, Serialize};

use super::chatlog::{self, Ctx, Entry, Role};
use super::data_sync::{self, DataState};
use super::{crdt, moderation, signing};
use crate::commands::config::validate_allowed_root;
use crate::commands::p2p::files::{check_rel_path, list_shareable_files};
use crate::commands::p2p::membership::{self, Membership};
use crate::database::WorkspaceDb;

pub const FORMAT: &str = "nexsync bundle v1";
/// A file bigger than this is left out (the usual sync fetches it); and all the files together are capped
const MAX_FILE: u64 = 10 * 1024 * 1024;
const MAX_FILES_TOTAL: u64 = 200 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BundleFile {
    pub path: String,
    pub data: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BundleDoc {
    pub doc: String,
    pub state: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Content {
    pub created: u64,
    pub membership: Membership,
    pub entries: Vec<Entry>,
    pub data: DataState,
    pub files: Vec<BundleFile>,
    pub docs: Vec<BundleDoc>,
    /// Files left out for size
    #[serde(default)]
    pub skipped: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Bundle {
    pub format: String,
    /// The exporter's device key
    pub by: String,
    /// Their signature over the hash of \`content\`
    pub sig: String,
    pub content: String,
}

fn hash_payload(content: &str) -> Vec<u8> {
    format!("{FORMAT}\n{}", blake3::hash(content.as_bytes()).to_hex()).into_bytes()
}

/// Builds a bundle of the workspace at \`path\`, signed with this device's key
pub fn make(path: &str) -> Result<Bundle, String> {
    let list = membership::load(path).ok_or("This device holds no member list, so it cannot make a bundle that others could check.")?;
    let db = WorkspaceDb::open_existing(path)?;
    let entries = chatlog::list(&db.conn)?;
    let data = data_sync::export_for(path)?;
    let erased: Vec<String> = data.erased_paths.iter().map(|p| p.path.trim_matches('/').to_string()).collect();

    let mut files = Vec::new();
    let mut skipped = Vec::new();
    let mut total = 0u64;
    for f in list_shareable_files(path)? {
        if erased.iter().any(|e| f.rel_path == *e || f.rel_path.starts_with(&format!("{e}/"))) {
            continue;
        }
        if f.size > MAX_FILE || total + f.size > MAX_FILES_TOTAL {
            skipped.push(f.rel_path);
            continue;
        }
        let on_disk = crate::commands::path_utils::resolve_workspace_path(path, &f.rel_path)?;
        let bytes = std::fs::read(&on_disk).map_err(|e| format!("Could not read {}: {e}", f.rel_path))?;
        total += f.size;
        files.push(BundleFile { path: f.rel_path, data: BASE64_STANDARD.encode(bytes) });
    }

    let ws_id = super::helpers::get_workspace_id(&db)?;
    let mut docs = Vec::new();
    {
        let mut stmt = db.conn.prepare("SELECT doc_id, binary_state FROM yjs_documents WHERE workspace_id = ?1").map_err(|e| e.to_string())?;
        let rows = stmt.query_map([&ws_id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, Vec<u8>>(1)?))).map_err(|e| e.to_string())?;
        for row in rows {
            let (doc, state) = row.map_err(|e| e.to_string())?;
            docs.push(BundleDoc { doc, state: BASE64_STANDARD.encode(state) });
        }
    }

    let content = serde_json::to_string(&Content { created: crdt::now_ms(), membership: list, entries, data, files, docs, skipped }).map_err(|e| e.to_string())?;
    let (by, sig) = signing::sign_bytes(&hash_payload(&content)).ok_or("This device has no key yet.")?;
    Ok(Bundle { format: FORMAT.into(), by, sig, content })
}

/// Reads a bundle and checks its envelope: the format, the exporter's signature, and that its member list is genuine
pub fn check(bundle: &Bundle) -> Result<Content, String> {
    if bundle.format != FORMAT {
        return Err("This is not a Nexsync bundle of a version this app reads.".into());
    }
    if !signing::verify_bytes(&bundle.by, &bundle.sig, &hash_payload(&bundle.content)) {
        return Err("The bundle's signature does not match: it was changed after it was made, or damaged.".into());
    }
    let content: Content = serde_json::from_str(&bundle.content).map_err(|e| format!("The bundle could not be read: {e}"))?;
    content.membership.verify().map_err(|e| format!("The member list in the bundle is not genuine: {e}"))?;
    Ok(content)
}

/// The member list that judges an import: the newer of the one held and the one in the bundle, when the bundle's is acceptable
fn judging_list(held: Option<&Membership>, theirs: &Membership) -> Result<(Membership, bool), String> {
    match held {
        None => Err("This device holds no member list yet, so it has nothing to check a bundle against. Join the workspace first.".into()),
        Some(h) if h.workspace_id != theirs.workspace_id => Err("This bundle is from another workspace.".into()),
        Some(h) => match membership::accept(Some(h), theirs) {
            Ok(()) => Ok((theirs.clone(), true)),
            // Not newer, or not signed by the owner this device knows: the list in the bundle is left out
            Err(_) => Ok((h.clone(), false)),
        },
    }
}

fn may_import_from(list: &Membership, by: &str, banned: bool) -> Result<(), String> {
    if banned || list.removed.iter().any(|r| r == by) {
        return Err("The person who made this bundle was removed from the workspace, so it is refused.".into());
    }
    if list.owner != by && list.role_of(by).is_none() {
        return Err("The person who made this bundle is not a member of the workspace.".into());
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub by: String,
    pub created: u64,
    pub epoch: u64,
    pub entries: usize,
    pub tasks: usize,
    pub cards: usize,
    pub files: usize,
    pub docs: usize,
    pub skipped: usize,
    /// The bundle's member list is newer than the one this device holds and would be taken
    pub newer_list: bool,
}

/// What a bundle holds and whether it would be accepted, without changing anything
pub fn inspect(path: &str, bundle: &Bundle) -> Result<Summary, String> {
    let content = check(bundle)?;
    let held = membership::load(path);
    let (list, newer) = judging_list(held.as_ref(), &content.membership)?;
    let db = WorkspaceDb::open_existing(path)?;
    let (_, state) = moderation::load(&db.conn, crdt::now_ms());
    may_import_from(&list, &bundle.by, state.is_banned(&bundle.by))?;
    Ok(Summary {
        by: bundle.by.clone(),
        created: content.created,
        epoch: content.membership.epoch,
        entries: content.entries.len(),
        tasks: content.data.tasks.len(),
        cards: content.data.cards.len(),
        files: content.files.len(),
        docs: content.docs.len(),
        skipped: content.skipped.len(),
        newer_list: newer,
    })
}

#[derive(Debug, Clone, Serialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub list_taken: bool,
    pub entries_added: usize,
    pub entries_refused: usize,
    pub data_changed: bool,
    pub files_written: usize,
    pub files_kept: usize,
    /// Stored text states for the app to merge into its documents
    pub docs: Vec<(String, String)>,
}

/// Applies a bundle to the workspace at \`path\`
pub fn import(path: &str, bundle: &Bundle) -> Result<Report, String> {
    let content = check(bundle)?;
    let held = membership::load(path);
    let (list, newer) = judging_list(held.as_ref(), &content.membership)?;
    let db = WorkspaceDb::open_existing(path)?;
    let (_, state) = moderation::load(&db.conn, crdt::now_ms());
    may_import_from(&list, &bundle.by, state.is_banned(&bundle.by))?;
    let mut report = Report::default();

    if newer {
        membership::store(path, &list)?;
        report.list_taken = true;
    }

    // The log: each entry is checked against the roles of the list that judges this import
    let roles: HashMap<String, Role> = list.members.iter().filter_map(|(k, r)| Role::parse(r).map(|r| (k.clone(), r))).collect();
    let owner = list.owner.clone();
    let role_of = move |k: &str| if k == owner { Some(Role::Owner) } else { roles.get(k).copied() };
    let me = signing::device_key().unwrap_or_default();
    let merged = chatlog::merge(&db.conn, content.entries, &Ctx { me: &me, now: crdt::now_ms(), role_of: &role_of })?;
    report.entries_added = merged.added.len();
    report.entries_refused = merged.refused;

    // Tasks and cards: the usual merge, which holds a write whose key may not write
    report.data_changed = data_sync::merge_into(path, content.data.clone())?;

    // Files only where there is none, never over one, never where erased for good
    let erased: Vec<String> = {
        let mut stmt = db.conn.prepare("SELECT path FROM erased_paths").map_err(|e| e.to_string())?;
        let rows = stmt.query_map(params![], |r| r.get::<_, String>(0)).map_err(|e| e.to_string())?;
        rows.filter_map(Result::ok).map(|p| p.trim_matches('/').to_string()).collect()
    };
    let mut rules = super::syncignore::Rules::load(std::path::Path::new(path));
    for f in content.files {
        let Ok(rel) = check_rel_path(&f.path) else { continue };
        if rules.ignored(&rel, false) {
            continue;
        }
        if erased.iter().any(|e| rel == *e || rel.starts_with(&format!("{e}/"))) {
            continue;
        }
        let target = crate::commands::path_utils::resolve_workspace_path(path, &rel)?;
        if target.exists() {
            report.files_kept += 1;
            continue;
        }
        let Ok(bytes) = BASE64_STANDARD.decode(&f.data) else { continue };
        if let Some(parent) = Path::new(&target).parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        std::fs::write(&target, bytes).map_err(|e| e.to_string())?;
        report.files_written += 1;
    }

    report.docs = content.docs.into_iter().map(|d| (d.doc, d.state)).collect();
    Ok(report)
}

#[tauri::command]
pub fn bundle_export(app: tauri::AppHandle, path: String, dest: String) -> Result<usize, String> {
    validate_allowed_root(&app, &path)?;
    let bundle = make(&path)?;
    let text = serde_json::to_string(&bundle).map_err(|e| e.to_string())?;
    std::fs::write(&dest, &text).map_err(|e| format!("Could not write the bundle: {e}"))?;
    Ok(text.len())
}

fn read_bundle(source: &str) -> Result<Bundle, String> {
    let meta = std::fs::metadata(source).map_err(|e| format!("Could not open the bundle: {e}"))?;
    if meta.len() > 512 * 1024 * 1024 {
        return Err("That file is too large to be a bundle.".into());
    }
    let text = std::fs::read_to_string(source).map_err(|e| format!("Could not read the bundle: {e}"))?;
    serde_json::from_str(&text).map_err(|_| "That file is not a Nexsync bundle.".to_string())
}

#[tauri::command]
pub fn bundle_inspect(app: tauri::AppHandle, path: String, source: String) -> Result<Summary, String> {
    validate_allowed_root(&app, &path)?;
    inspect(&path, &read_bundle(&source)?)
}

#[tauri::command]
pub fn bundle_import(app: tauri::AppHandle, path: String, source: String) -> Result<Report, String> {
    use tauri::Emitter;
    validate_allowed_root(&app, &path)?;
    let report = import(&path, &read_bundle(&source)?)?;
    // The app reloads what it shows
    let _ = app.emit(crate::commands::p2p::chat::EVENT_LOG, ());
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::workspace::chatlog::Entry;

    fn workspace_dir(tag: &str) -> String {
        let dir = std::env::temp_dir().join(format!("nexsync-bundle-{tag}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(dir.join("notes")).unwrap();
        let path = dir.to_str().unwrap().to_string();
        let db = WorkspaceDb::open(&path).unwrap();
        db.conn.execute("INSERT INTO workspace (id, name, description, path, created_at, updated_at) VALUES ('w1', 'w', '', ?1, 't', 't')", [&path]).unwrap();
        path
    }

    fn key(n: u8) -> iroh::SecretKey {
        iroh::SecretKey::from_bytes(&[n; 32])
    }

    fn list(epoch: u64, members: &[(u8, &str)], removed: &[u8]) -> Membership {
        membership::issue(&key(1), "ws", "w", epoch, &key(1).public().to_string(), members.iter().map(|(n, r)| (key(*n).public().to_string(), r.to_string())).collect(), removed.iter().map(|n| key(*n).public().to_string()).collect())
    }

    fn make_with(by: u8, list: Membership, entries: Vec<Entry>, files: Vec<(&str, &str)>) -> Bundle {
        let content = serde_json::to_string(&Content {
            created: 1,
            membership: list,
            entries,
            data: DataState::default(),
            files: files.into_iter().map(|(p, d)| BundleFile { path: p.into(), data: BASE64_STANDARD.encode(d) }).collect(),
            docs: vec![BundleDoc { doc: "notes/a.md".into(), state: "AA==".into() }],
            skipped: vec![],
        })
        .unwrap();
        let sig = signing::to_hex(&key(by).sign(&hash_payload(&content)).to_bytes());
        Bundle { format: FORMAT.into(), by: key(by).public().to_string(), sig, content }
    }

    #[test]
    fn a_bundle_from_a_member_is_taken_and_one_that_was_changed_or_made_by_a_stranger_or_a_removed_member_is_refused() {
        let path = workspace_dir("a");
        let current = list(5, &[(2, "Editor"), (3, "Editor")], &[]);
        membership::store(&path, &current).unwrap();
        let msg = Entry::signed_with(&key(2), "message", "general", "", "from the stick", 1_000);
        let good = make_with(2, current.clone(), vec![msg.clone()], vec![("notes/new.md", "hello")]);
        assert!(inspect(&path, &good).unwrap().entries == 1);
        let report = import(&path, &good).unwrap();
        assert_eq!((report.entries_added, report.files_written, report.docs.len()), (1, 1, 1));
        assert_eq!(std::fs::read_to_string(std::path::Path::new(&path).join("notes/new.md")).unwrap(), "hello");
        // A second import adds nothing and keeps the file as it is
        let again = import(&path, &good).unwrap();
        assert_eq!((again.entries_added, again.files_written, again.files_kept), (0, 0, 1));
        // Changed after signing
        let mut altered = good.clone();
        altered.content = altered.content.replace("from the stick", "from the stick!");
        assert!(check(&altered).is_err());
        // A stranger made it
        assert!(inspect(&path, &make_with(9, current.clone(), vec![], vec![])).unwrap_err().contains("not a member"));
        // Someone removed since made it, under an older list that still had them
        let removed_now = list(6, &[(2, "Editor")], &[3]);
        membership::store(&path, &removed_now).unwrap();
        assert!(inspect(&path, &make_with(3, current, vec![], vec![])).unwrap_err().contains("removed"));
        let _ = std::fs::remove_dir_all(&path);
    }

    #[test]
    fn an_old_bundle_cannot_bring_back_a_removed_member_and_a_newer_list_is_taken() {
        let path = workspace_dir("b");
        // This device knows member 3 was removed (version 6); the bundle was made at version 5, when 3 was in
        membership::store(&path, &list(6, &[(2, "Editor")], &[3])).unwrap();
        let old = list(5, &[(2, "Editor"), (3, "Editor")], &[]);
        let by_removed = Entry::signed_with(&key(3), "message", "general", "", "after removal", 2_000);
        let by_member = Entry::signed_with(&key(2), "message", "general", "", "fine", 2_001);
        let bundle = make_with(2, old, vec![by_removed, by_member], vec![]);
        let summary = inspect(&path, &bundle).unwrap();
        assert!(!summary.newer_list, "the older list in the bundle is not taken");
        let report = import(&path, &bundle).unwrap();
        assert_eq!((report.list_taken, report.entries_added, report.entries_refused), (false, 1, 1));
        assert_eq!(membership::load(&path).unwrap().epoch, 6);
        // A newer list from the same owner is taken, and lets the new member's entries in
        let newer = list(7, &[(2, "Editor"), (4, "Editor")], &[3]);
        let from_new = Entry::signed_with(&key(4), "message", "general", "", "new here", 3_000);
        let report = import(&path, &make_with(2, newer, vec![from_new], vec![])).unwrap();
        assert_eq!((report.list_taken, report.entries_added), (true, 1));
        assert_eq!(membership::load(&path).unwrap().epoch, 7);
        let _ = std::fs::remove_dir_all(&path);
    }

    #[test]
    fn a_bundle_for_another_workspace_or_into_a_device_with_no_list_is_refused_and_a_file_never_replaces_one() {
        let path = workspace_dir("c");
        let current = list(5, &[(2, "Editor")], &[]);
        let bundle = make_with(2, current.clone(), vec![], vec![("notes/kept.md", "theirs")]);
        // No list yet: nothing to check against
        assert!(import(&path, &bundle).unwrap_err().contains("no member list"));
        membership::store(&path, &current).unwrap();
        std::fs::write(std::path::Path::new(&path).join("notes/kept.md"), "mine").unwrap();
        let report = import(&path, &bundle).unwrap();
        assert_eq!((report.files_written, report.files_kept), (0, 1));
        assert_eq!(std::fs::read_to_string(std::path::Path::new(&path).join("notes/kept.md")).unwrap(), "mine");
        // Another workspace
        let other = membership::issue(&key(1), "other-ws", "x", 9, &key(1).public().to_string(), vec![(key(2).public().to_string(), "Editor".into())], vec![]);
        assert!(inspect(&path, &make_with(2, other, vec![], vec![])).unwrap_err().contains("another workspace"));
        let _ = std::fs::remove_dir_all(&path);
    }
}
