//! Erasing for good (RESEARCH.md §8g).
//!
//! Deleting a task, a card or a file moves it out of sight, but the app keeps content in several other places on purpose:
//! the journal behind the catch-up review, the activity feed, drafts, the merge state, saved versions of a file, the
//! Yjs state of its text, and the trash. Erasing removes the item from all of them on this device, and leaves a mark that
//! devices which were away apply when they next sync: a tombstone flagged `erased` for a record, a row in
//! `erased_paths` for a file. What it cannot reach is stated in the app: copies other people exported, backups of a
//! disk, and a device that is modified to ignore the mark.

use rusqlite::{params, Connection};
use serde::Serialize;

use super::data_sync::{ErasedPath, ENTITY_CARD, ENTITY_TASK};
use super::helpers::get_workspace_id;
use super::{crdt, trash, versions};
use crate::commands::config::validate_allowed_root;
use crate::commands::path_utils::resolve_workspace_path;
use crate::database::WorkspaceDb;

/// How many places each kind of store gave up
#[derive(Debug, Default, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Erased {
    pub records: usize,
    pub journal: usize,
    pub activity: usize,
    pub drafts: usize,
    pub versions: usize,
    pub documents: usize,
    pub trash: usize,
    pub files: usize,
}

fn err(e: rusqlite::Error) -> String {
    e.to_string()
}

/// Removes everything this device keeps about a task or card except the row itself and the tombstone: the journal,
/// the activity feed, drafts and the merge state
pub fn scrub_record(conn: &Connection, entity: &str, id: &str) -> Result<Erased, String> {
    let journal = conn.execute("DELETE FROM catchup_log WHERE entity = ?1 AND target = ?2", params![entity, id]).map_err(err)?;
    let activity = conn.execute("DELETE FROM activity_events WHERE target = ?1", [format!("{entity}:{id}")]).map_err(err)?;
    let drafts = conn.execute("DELETE FROM drafts WHERE entity = ?1 AND target = ?2", params![entity, id]).map_err(err)?;
    crdt::forget(conn, entity, id)?;
    Ok(Erased { journal, activity, drafts, ..Default::default() })
}

/// Erases a task or card from this device and marks it erased, so devices that were away erase it too
pub fn erase_record(conn: &Connection, ws_id: &str, entity: &str, id: &str) -> Result<Erased, String> {
    let table = match entity {
        ENTITY_TASK => "tasks",
        ENTITY_CARD => "kanban_cards",
        _ => return Err("Only tasks and cards can be erased this way.".into()),
    };
    let records = conn.execute(&format!("DELETE FROM {table} WHERE id = ?1"), [id]).map_err(err)?;
    let mut out = scrub_record(conn, entity, id)?;
    out.records = records;
    conn.execute(
        "INSERT OR REPLACE INTO tombstones (workspace_id, entity, id, deleted_at, erased) VALUES (?1, ?2, ?3, ?4, 1)",
        params![ws_id, entity, id, chrono::Utc::now().to_rfc3339()],
    )
    .map_err(err)?;
    conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);").map_err(err)?;
    Ok(out)
}

fn looks_like_uuid(w: &[u8]) -> bool {
    w.len() == 36 && w.iter().enumerate().all(|(i, b)| if matches!(i, 8 | 13 | 18 | 23) { *b == b'-' } else { b.is_ascii_hexdigit() })
}

/// The branch documents that the stored state of `docs` names. A branch id is written into the state as plain text, so
/// every id-shaped string in it that matches a stored `branch:<id>` document is one.
fn branch_docs(db: &WorkspaceDb, ws_id: &str, docs: &[String]) -> Result<Vec<String>, String> {
    let mut found = Vec::new();
    for doc in docs {
        let state: Option<Vec<u8>> = db
            .conn
            .query_row("SELECT binary_state FROM yjs_documents WHERE workspace_id = ?1 AND doc_id = ?2", params![ws_id, doc], |r| r.get(0))
            .ok();
        for w in state.iter().flat_map(|bytes| bytes.windows(36)).filter(|w| looks_like_uuid(w)) {
            let id = format!("branch:{}", String::from_utf8_lossy(w));
            let stored: bool = db.conn.query_row("SELECT COUNT(*) > 0 FROM yjs_documents WHERE workspace_id = ?1 AND doc_id = ?2", params![ws_id, id], |r| r.get(0)).map_err(err)?;
            if stored {
                found.push(id);
            }
        }
    }
    Ok(found)
}

/// Erases a file or folder from this device: the file itself, its trash copies, saved versions, the Yjs state of its text
/// (under the names in `doc_ids` and the usual ones), what the journal and activity feed say about it, and its name in the
/// list of recent files. Records the erasure so devices that were away do the same.
pub fn erase_file(db: &WorkspaceDb, workspace: &str, rel: &str, doc_ids: &[String]) -> Result<Erased, String> {
    let rel = rel.trim_matches('/');
    if rel.is_empty() || rel.split('/').next().is_some_and(|first| first.starts_with('.')) {
        return Err("That path is not a file or folder of the workspace.".into());
    }
    let ws_id = get_workspace_id(db)?;
    let mut out = Erased::default();

    let on_disk = resolve_workspace_path(workspace, rel)?;
    if on_disk.is_dir() {
        std::fs::remove_dir_all(&on_disk).map_err(|e| e.to_string())?;
        out.files = 1;
    } else if on_disk.is_file() {
        std::fs::remove_file(&on_disk).map_err(|e| e.to_string())?;
        out.files = 1;
    }
    out.trash = trash::erase_matching(workspace, rel);
    out.versions = versions::erase_path(db, workspace, &ws_id, rel)?;

    let mut docs: Vec<String> = doc_ids.to_vec();
    docs.push(rel.to_string());
    docs.push(format!("notes/{rel}"));
    docs.sort();
    docs.dedup();
    // The file's own document lists its branches by id, and each branch is a document of its own that starts as a full copy
    // of the file. They are found from that list, so a file already in the trash (whose caller cannot name them) is covered.
    let branches = branch_docs(db, &ws_id, &docs)?;
    docs.extend(branches);
    docs.sort();
    docs.dedup();
    for doc in &docs {
        out.documents += db.conn.execute("DELETE FROM yjs_documents WHERE workspace_id = ?1 AND doc_id = ?2", params![ws_id, doc]).map_err(err)?;
        out.journal += db.conn.execute("DELETE FROM catchup_log WHERE entity = 'file' AND target = ?1", [doc]).map_err(err)?;
    }
    out.journal += db.conn.execute("DELETE FROM catchup_log WHERE entity = 'file' AND target = ?1", [rel]).map_err(err)?;
    out.activity = db
        .conn
        .execute("DELETE FROM activity_events WHERE target = ?1 OR target = ?2", params![rel, format!("file:{rel}")])
        .map_err(err)?;

    // The recent-files list keeps names
    let recent: Option<String> = db.conn.query_row("SELECT recent_files FROM history WHERE workspace_id = ?1", [&ws_id], |r| r.get(0)).ok();
    if let Some(Ok(mut list)) = recent.map(|text| serde_json::from_str::<Vec<serde_json::Value>>(&text)) {
        let before = list.len();
        list.retain(|v| v.as_str().is_none_or(|s| s != rel && !s.starts_with(&format!("{rel}/"))));
        if list.len() != before {
            db.conn.execute("UPDATE history SET recent_files = ?1 WHERE workspace_id = ?2", params![serde_json::to_string(&list).unwrap_or_default(), ws_id]).map_err(err)?;
        }
    }

    db.conn
        .execute("INSERT OR REPLACE INTO erased_paths (path, erased_at) VALUES (?1, ?2)", params![rel, chrono::Utc::now().to_rfc3339()])
        .map_err(err)?;
    db.conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);").map_err(err)?;
    Ok(out)
}

/// The paths erased on this device and when, in milliseconds since 1970; file sync reads it so that a copy of an erased file on
/// another device is not pulled back
pub fn erased_list(workspace: &str) -> Vec<(String, i64)> {
    let Ok(db) = WorkspaceDb::open_existing(workspace) else { return Vec::new() };
    let Ok(mut stmt) = db.conn.prepare("SELECT path, erased_at FROM erased_paths") else { return Vec::new() };
    let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)));
    rows.map(|rows| rows.flatten().filter_map(|(p, t)| chrono::DateTime::parse_from_rfc3339(&t).ok().map(|d| (p, d.timestamp_millis()))).collect()).unwrap_or_default()
}

/// Whether `rel` (a file, or anything inside an erased folder) was erased at or after `modified_ms`, the time its copy was
/// last written; a copy written after the erasure is new work and is kept
pub fn covers(erased: &[(String, i64)], rel: &str, modified_ms: u64) -> bool {
    erased.iter().any(|(p, at)| {
        let p = p.trim_matches('/');
        (rel == p || rel.starts_with(&format!("{p}/"))) && (modified_ms as i64) <= *at
    })
}

/// Applies the erasures another device sent, for files this device has not erased yet. A file that was written after
/// the erasure survives, as with a delete. Returns whether anything changed.
pub fn apply_remote_erasures(db: &WorkspaceDb, workspace: &str, remote: &[ErasedPath]) -> Result<bool, String> {
    let mut changed = false;
    for item in remote {
        let known: bool = db.conn.query_row("SELECT COUNT(*) > 0 FROM erased_paths WHERE path = ?1", [&item.path], |r| r.get(0)).map_err(err)?;
        if known {
            continue;
        }
        let erased_at = chrono::DateTime::parse_from_rfc3339(&item.erased_at).ok().map(|t| t.timestamp_millis());
        if let (Some(at), Ok(path)) = (erased_at, resolve_workspace_path(workspace, item.path.trim_matches('/'))) {
            let written = std::fs::metadata(&path).and_then(|m| m.modified()).ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis() as i64);
            if written.is_some_and(|w| w > at) {
                continue;
            }
        }
        match erase_file(db, workspace, &item.path, &[]) {
            Ok(_) => changed = true,
            Err(e) => eprintln!("[erase] Could not apply an erasure of {}: {e}", item.path),
        }
        // Keep the remote time, so the same erasure is not applied twice
        let _ = db.conn.execute("INSERT OR REPLACE INTO erased_paths (path, erased_at) VALUES (?1, ?2)", params![item.path.trim_matches('/'), item.erased_at]);
    }
    Ok(changed)
}

// ────────────────────────────
// Tauri commands
// ────────────────────────────

/// Erases a task or card for good, here; the caller tells the other devices
#[tauri::command]
pub fn erase_record_for_good(app_handle: tauri::AppHandle, path: String, entity: String, id: String) -> Result<Erased, String> {
    validate_allowed_root(&app_handle, &path)?;
    let db = WorkspaceDb::open_existing(&path)?;
    let ws_id = get_workspace_id(&db)?;
    erase_record(&db.conn, &ws_id, &entity, &id)
}

/// Erases a file or folder for good, here; `doc_ids` are any other Yjs documents that belong to it, such as branches
#[tauri::command]
pub fn erase_file_for_good(app_handle: tauri::AppHandle, path: String, rel_path: String, doc_ids: Vec<String>) -> Result<Erased, String> {
    validate_allowed_root(&app_handle, &path)?;
    let db = WorkspaceDb::open_existing(&path)?;
    erase_file(&db, &path, &rel_path, &doc_ids)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::workspace::models::{Comment, Task};
    use crate::commands::workspace::{catchup, data_sync, tasks};
    use std::path::PathBuf;

    const MARKER: &str = "ZEBRA-7731-MARKER";
    const NOTE: &str = "notes/secret.md";

    struct Ws {
        dir: PathBuf,
        db: WorkspaceDb,
    }

    fn workspace(label: &str) -> Ws {
        let dir = std::env::temp_dir().join(format!("nexsync-erase-{label}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(dir.join("notes")).unwrap();
        let db = WorkspaceDb::open(dir.to_str().unwrap()).unwrap();
        db.conn
            .execute("INSERT INTO workspace (id, name, description, path, created_at, updated_at) VALUES ('w1', 'w', '', ?1, 't', 't')", [dir.to_string_lossy()])
            .unwrap();
        Ws { dir, db }
    }

    /// Puts the marker into everything the app keeps about a task and about a note, the way using the app does
    fn plant(w: &Ws) {
        let ws = w.dir.to_str().unwrap();
        let task = Task {
            id: "t1".into(),
            title: format!("plan {MARKER}"),
            description: format!("details {MARKER}"),
            status: "todo".into(),
            priority: "medium".into(),
            comments: vec![Comment { id: "c1".into(), author: "Bo".into(), text: format!("remember {MARKER}"), at: "2026-01-01T00:00:00Z".into() }],
            created_at: "2026-01-01T00:00:00Z".into(),
            updated_at: "2026-01-01T00:00:00Z".into(),
            ..Default::default()
        };
        data_sync::put_task_row(&w.db.conn, "w1", &task).unwrap();
        crdt::ensure(&w.db.conn, &task).unwrap();
        catchup::record_deleted(&w.db.conn, "task", "t1", &task.title).unwrap();
        w.db.conn
            .execute("INSERT INTO activity_events (id, workspace_id, timestamp, action, detail, target, target_type) VALUES ('a1', 'w1', 't', 'Created task', ?1, 'task:t1', 'task')", [format!("Created task: {MARKER}")])
            .unwrap();
        w.db.conn
            .execute("INSERT INTO drafts (id, entity, target, name, author, created_at, replica, state) VALUES ('d1', 'task', 't1', ?1, 'Bo', 1, 'r', ?2)", [format!("draft {MARKER}"), format!("{{\"title\":\"{MARKER}\"}}")])
            .unwrap();

        std::fs::write(w.dir.join(NOTE), format!("# secret\n{MARKER}\n")).unwrap();
        versions::record_bytes(ws, NOTE, format!("# secret\n{MARKER}\n").as_bytes(), "save", None).unwrap();
        w.db.conn
            .execute("INSERT INTO yjs_documents (workspace_id, doc_id, binary_state, updated_at) VALUES ('w1', ?1, ?2, 't')", params![NOTE, format!("yjs bytes {MARKER} more").into_bytes()])
            .unwrap();
        catchup::record_text(&w.db.conn, NOTE, "secret.md", Some("Bo"), "", &format!("{MARKER} typed by Bo"), false).unwrap();
        w.db.conn
            .execute("INSERT OR REPLACE INTO history (workspace_id, last_opened, recent_files) VALUES ('w1', 't', ?1)", [format!("[\"{NOTE}\",\"other.md\"]")])
            .unwrap();
    }

    /// Every file under the workspace that holds the marker, by a name that says what kind of store it is
    fn found(w: &Ws) -> Vec<String> {
        let mut hits = Vec::new();
        fn walk(dir: &std::path::Path, base: &std::path::Path, hits: &mut Vec<String>) {
            for e in std::fs::read_dir(dir).into_iter().flatten().flatten() {
                let path = e.path();
                if path.is_dir() {
                    walk(&path, base, hits);
                } else if std::fs::read(&path).map(|b| b.windows(MARKER.len()).any(|w| w == MARKER.as_bytes())).unwrap_or(false) {
                    let rel = path.strip_prefix(base).unwrap().to_string_lossy().replace('\\', "/");
                    let kind = if rel.starts_with(".nexsync/versions/") {
                        ".nexsync/versions/<saved version>".to_string()
                    } else if rel.starts_with(".nexsync/trash/") {
                        ".nexsync/trash/<deleted item>".to_string()
                    } else {
                        rel
                    };
                    hits.push(kind);
                }
            }
        }
        walk(&w.dir, &w.dir, &mut hits);
        hits.sort();
        hits
    }

    /// What the database says about the marker, table by table (the live rows, apart from free pages and the log)
    fn tables_holding(w: &Ws) -> Vec<&'static str> {
        let mut out = Vec::new();
        let count = |sql: &str| -> i64 { w.db.conn.query_row(sql, [], |r| r.get(0)).unwrap() };
        let like = format!("%{MARKER}%");
        for (name, sql) in [
            ("tasks", format!("SELECT COUNT(*) FROM tasks WHERE title LIKE '{like}' OR description LIKE '{like}'")),
            ("crdt_meta", format!("SELECT COUNT(*) FROM crdt_meta WHERE state LIKE '{like}'")),
            ("catchup_log", format!("SELECT COUNT(*) FROM catchup_log WHERE label LIKE '{like}' OR before LIKE '{like}' OR after LIKE '{like}'")),
            ("activity_events", format!("SELECT COUNT(*) FROM activity_events WHERE detail LIKE '{like}'")),
            ("drafts", format!("SELECT COUNT(*) FROM drafts WHERE name LIKE '{like}' OR state LIKE '{like}'")),
        ] {
            if count(&sql) > 0 {
                out.push(name);
            }
        }
        if count(&format!("SELECT COUNT(*) FROM yjs_documents WHERE CAST(binary_state AS TEXT) LIKE '{like}'")) > 0 {
            out.push("yjs_documents");
        }
        out
    }

    #[test]
    fn the_residue_audit_what_survives_an_ordinary_delete_and_what_survives_erasing() {
        let w = workspace("audit");
        let ws = w.dir.to_str().unwrap();
        plant(&w);
        println!("\nbefore deleting:       tables {:?}\n                       files  {:?}", tables_holding(&w), found(&w));

        // The ordinary delete of a task, and of a note (which goes to the trash)
        tasks::delete_task_row(&w.db.conn, "w1", "t1").unwrap();
        trash::move_to_trash(ws, &w.dir.join(NOTE), NOTE).unwrap();
        let (tables, files) = (tables_holding(&w), found(&w));
        println!("after ordinary delete: tables {tables:?}\n                       files  {files:?}");
        for table in ["catchup_log", "activity_events", "drafts", "yjs_documents"] {
            assert!(tables.contains(&table), "{table} was expected to keep the content of an ordinary delete");
        }
        assert!(!tables.contains(&"tasks") && !tables.contains(&"crdt_meta"), "the row and its merge state should be gone");
        assert!(files.iter().any(|f| f.contains("versions")) && files.iter().any(|f| f.contains("trash")), "{files:?}");

        // Erasing for good, which also covers what the ordinary delete left
        let rec = erase_record(&w.db.conn, "w1", "task", "t1").unwrap();
        let file = erase_file(&w.db, ws, NOTE, &[]).unwrap();
        let (tables, files) = (tables_holding(&w), found(&w));
        println!("after erasing:         tables {tables:?}\n                       files  {files:?}\nrecord {rec:?}\nfile   {file:?}");
        assert!(tables.is_empty(), "the marker is still in {tables:?}");
        assert!(files.is_empty(), "the marker is still in {files:?}, including the database file and its log");
        // The names of what was erased are kept, so devices that were away erase them too
        let (flag, paths): (i64, i64) = (
            w.db.conn.query_row("SELECT erased FROM tombstones WHERE id = 't1'", [], |r| r.get(0)).unwrap(),
            w.db.conn.query_row("SELECT COUNT(*) FROM erased_paths WHERE path = ?1", [NOTE], |r| r.get(0)).unwrap(),
        );
        assert_eq!((flag, paths), (1, 1));
        let recent: String = w.db.conn.query_row("SELECT recent_files FROM history", [], |r| r.get(0)).unwrap();
        assert!(!recent.contains("secret"), "{recent}");
        let _ = std::fs::remove_dir_all(&w.dir);
    }

    #[test]
    fn an_erased_file_is_not_pulled_back_but_a_copy_written_after_the_erasure_is() {
        let erased = vec![("notes/secret.md".to_string(), 1_000), ("old".to_string(), 1_000)];
        assert!(covers(&erased, "notes/secret.md", 900));
        assert!(covers(&erased, "old/inside/a.md", 1_000), "anything in an erased folder");
        assert!(!covers(&erased, "notes/secret.md", 1_001), "written after the erasure");
        assert!(!covers(&erased, "notes/secret.md.bak", 900) && !covers(&erased, "older/a.md", 900));
    }

    #[test]
    fn erasing_a_file_that_was_already_deleted_still_removes_its_branches() {
        // Real Yjs state of a note whose "branches" map holds branch 0b8f6c1e-... (made with the yjs library)
        let hex = "0102d79bb1bd0300040107636f6e74656e740568656c6c6f2801086272616e636865732430623866366331652d356432612d346637652d396133312d326334643565366637613862017605026964772430623866366331652d356432612d346637652d396133312d326334643565366637613862046e616d6577037472790262797702426f0261747d010673746174757377046f70656e00";
        let state: Vec<u8> = (0..hex.len()).step_by(2).map(|i| u8::from_str_radix(&hex[i..i + 2], 16).unwrap()).collect();
        let w = workspace("branches");
        let ws = w.dir.to_str().unwrap();
        let branch = "branch:0b8f6c1e-5d2a-4f7e-9a31-2c4d5e6f7a8b";
        for (doc, bytes) in [(NOTE, state), (branch, format!("a copy of the note {MARKER}").into_bytes()), ("branch:unrelated", b"keep me".to_vec())] {
            w.db.conn.execute("INSERT INTO yjs_documents (workspace_id, doc_id, binary_state, updated_at) VALUES ('w1', ?1, ?2, 't')", params![doc, bytes]).unwrap();
        }
        // The file was deleted earlier (here: never on disk), and the caller names no branches, as the Trash does
        let out = erase_file(&w.db, ws, NOTE, &[]).unwrap();
        let left: Vec<String> = w.db.conn.prepare("SELECT doc_id FROM yjs_documents").unwrap().query_map([], |r| r.get(0)).unwrap().map(|r| r.unwrap()).collect();
        assert_eq!(left, vec!["branch:unrelated".to_string()], "{out:?}");
        assert_eq!(out.documents, 2);
        assert!(tables_holding(&w).is_empty() && found(&w).is_empty());
        let _ = std::fs::remove_dir_all(&w.dir);
    }

    #[test]
    fn deleted_text_stays_in_the_database_file_unless_deleted_rows_are_overwritten() {
        let dir = std::env::temp_dir().join(format!("nexsync-secdel-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let mut left_behind = Vec::new();
        for (label, secure) in [("off", false), ("on", true)] {
            let file = dir.join(format!("{label}.db"));
            let conn = Connection::open(&file).unwrap();
            conn.execute_batch(&format!("PRAGMA secure_delete = {}; CREATE TABLE t (id INTEGER PRIMARY KEY, body TEXT);", if secure { "ON" } else { "OFF" })).unwrap();
            for i in 0..20 {
                conn.execute("INSERT INTO t (body) VALUES (?1)", [format!("{MARKER} row {i} {}", "x".repeat(200))]).unwrap();
            }
            conn.execute("DELETE FROM t", []).unwrap();
            conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);").unwrap();
            drop(conn);
            let bytes = std::fs::read(&file).unwrap();
            left_behind.push((label, bytes.windows(MARKER.len()).filter(|w| *w == MARKER.as_bytes()).count()));
        }
        println!("copies of a deleted row's text left in the database file: secure_delete off {}, on {}", left_behind[0].1, left_behind[1].1);
        assert!(left_behind[0].1 > 0, "the default was expected to leave the text in free pages");
        assert_eq!(left_behind[1].1, 0);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn an_erased_mark_from_another_device_erases_here_and_a_file_written_since_survives() {
        let w = workspace("remote");
        let ws = w.dir.to_str().unwrap();
        plant(&w);
        std::fs::write(w.dir.join("notes/kept.md"), "written after the erasure").unwrap();
        let remote = vec![
            ErasedPath { path: NOTE.into(), erased_at: "2999-01-01T00:00:00Z".into() },
            ErasedPath { path: "notes/kept.md".into(), erased_at: "2000-01-01T00:00:00Z".into() },
        ];
        assert!(apply_remote_erasures(&w.db, ws, &remote).unwrap());
        assert!(!w.dir.join(NOTE).exists(), "the erased file is still here");
        assert!(w.dir.join("notes/kept.md").exists(), "a file written after the erasure was erased");
        assert!(!found(&w).iter().any(|f| f.contains("versions")), "{:?}", found(&w));
        // Applying the same news again does nothing
        assert!(!apply_remote_erasures(&w.db, ws, &remote[..1]).unwrap());
        let _ = std::fs::remove_dir_all(&w.dir);
    }

    #[test]
    fn an_erased_tombstone_from_another_device_scrubs_the_journal_here() {
        let w = workspace("tomb");
        plant(&w);
        // This device only holds what the journal and feed kept; the record itself arrived and was deleted earlier
        tasks::delete_task_row(&w.db.conn, "w1", "t1").unwrap();
        let remote = data_sync::DataState {
            tombstones: vec![data_sync::Tombstone { entity: "task".into(), id: "t1".into(), deleted_at: "2999-01-01T00:00:00Z".into(), erased: true }],
            ..Default::default()
        };
        data_sync::merge_state(&w.db.conn, "w1", remote).unwrap();
        let about_the_task: i64 = w
            .db
            .conn
            .query_row(
                "SELECT (SELECT COUNT(*) FROM catchup_log WHERE entity = 'task' AND target = 't1') + (SELECT COUNT(*) FROM activity_events WHERE target = 'task:t1') + (SELECT COUNT(*) FROM drafts WHERE target = 't1')",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(about_the_task, 0, "something about the erased task is still kept");
        let tables = tables_holding(&w);
        assert!(tables.contains(&"catchup_log"), "the journal entry about the note was not this erasure's business");
        let flagged: i64 = w.db.conn.query_row("SELECT erased FROM tombstones WHERE id = 't1'", [], |r| r.get(0)).unwrap();
        assert_eq!(flagged, 1);
        let _ = std::fs::remove_dir_all(&w.dir);
    }
}
