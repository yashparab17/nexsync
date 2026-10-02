//! A journal of what other people changed while this device was not looking, for the catch-up review.
//!
//! A CRDT merge always succeeds, so the person never learns what it did. Here every merge of a task or card is compared
//! with the record as it was, and each field that changed is written down with its old and new value and who wrote the
//! new one (every write in the merge state carries its author). Text changes arrive through the note documents and are
//! journaled by the app with the text before and after. Reverting is not special: it is an ordinary new write.

use std::collections::{BTreeMap, BTreeSet};

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::crdt::{now_ms, RecordState};

/// Entries kept; the oldest go first
const KEEP: i64 = 500;
/// Text longer than this is journaled without its content, since the journal lives in the workspace database
pub const MAX_TEXT: usize = 200_000;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Entry {
    pub id: i64,
    /// Milliseconds since 1970 when this device merged the change
    pub at: i64,
    /// "field", "created", "deleted" or "text"
    pub kind: String,
    /// "task", "card" or "file"
    pub entity: String,
    /// The record id, or the document id of a file
    pub target: String,
    /// The record's title or the file's name, as it was when the change arrived
    pub label: String,
    /// The changed path ("title", "tags/urgent", "comments/<id>"); empty unless kind is "field"
    pub path: String,
    /// JSON for a field, plain text for a file; absent when there was no value, or the text was too large
    pub before: Option<String>,
    pub after: Option<String>,
    pub who: Option<String>,
    /// The device key that signed the change, when it was signed; `who` alone is only a name the writer chose
    pub signer: Option<String>,
    /// "new", "seen" or "reverted"
    pub state: String,
}

/// A card's place in its column and a checklist's order change on almost every move, and say little to the reader
fn is_noise(path: &str, before: Option<&Value>, after: Option<&Value>) -> bool {
    if path == "position" {
        return true;
    }
    let item_order = path.strip_prefix("checklist/").is_some_and(|rest| !rest.contains('/'));
    item_order && before.is_some() && after.is_some()
}

fn shown(v: Option<&Value>) -> Option<&Value> {
    v.filter(|v| !v.is_null())
}

fn insert(conn: &Connection, e: &Entry) -> Result<(), String> {
    conn.execute(
        "INSERT INTO catchup_log (at, kind, entity, target, label, path, before, after, who, signer) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![e.at, e.kind, e.entity, e.target, e.label, e.path, e.before, e.after, e.who, e.signer],
    )
    .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM catchup_log WHERE id NOT IN (SELECT id FROM catchup_log ORDER BY id DESC LIMIT ?1)", [KEEP])
        .map(|_| ())
        .map_err(|e| e.to_string())
}

fn entry(kind: &str, entity: &str, target: &str, label: &str, who: Option<String>) -> Entry {
    Entry {
        id: 0,
        at: now_ms() as i64,
        kind: kind.into(),
        entity: entity.into(),
        target: target.into(),
        label: label.into(),
        path: String::new(),
        before: None,
        after: None,
        who,
        signer: None,
        state: "new".into(),
    }
}

/// Writes down how a merge changed a record. `before` is `None` when the record is new to this device.
pub fn record_merge(
    conn: &Connection,
    entity: &str,
    id: &str,
    label: &str,
    before: Option<&BTreeMap<String, Value>>,
    after: &BTreeMap<String, Value>,
    state: &RecordState,
) -> Result<(), String> {
    let Some(before) = before else {
        let mut e = entry("created", entity, id, label, state.writer_of("title"));
        e.signer = state.signer_of("title");
        return insert(conn, &e);
    };
    let paths: BTreeSet<&String> = before.keys().chain(after.keys()).collect();
    for path in paths {
        let (b, a) = (shown(before.get(path)), shown(after.get(path)));
        if b == a || is_noise(path, b, a) {
            continue;
        }
        let mut e = entry("field", entity, id, label, state.writer_of(path));
        e.path = path.clone();
        e.signer = state.signer_of(path);
        e.before = b.map(Value::to_string);
        e.after = a.map(Value::to_string);
        insert(conn, &e)?;
    }
    Ok(())
}

/// Writes down that a record was deleted by someone else
pub fn record_deleted(conn: &Connection, entity: &str, id: &str, label: &str) -> Result<(), String> {
    insert(conn, &entry("deleted", entity, id, label, None))
}

/// Writes down a change to a file's text that arrived from someone else
pub fn record_text(conn: &Connection, doc_id: &str, label: &str, who: Option<&str>, before: &str, after: &str, live: bool) -> Result<(), String> {
    if before == after {
        return Ok(());
    }
    let mut e = entry("text", "file", doc_id, label, who.map(str::to_string));
    // Typing seen as it happened is marked, so it is not later announced as made while the person was away
    if live {
        e.path = "live".into();
    }
    if before.len() <= MAX_TEXT && after.len() <= MAX_TEXT {
        e.before = Some(before.to_string());
        e.after = Some(after.to_string());
    }
    insert(conn, &e)
}

/// What there is to review: everything not yet marked seen, newest first
pub fn list(conn: &Connection) -> Result<Vec<Entry>, String> {
    let e = |e: rusqlite::Error| e.to_string();
    conn.prepare("SELECT id, at, kind, entity, target, label, path, before, after, who, state, signer FROM catchup_log WHERE state != 'seen' ORDER BY id DESC")
        .map_err(e)?
        .query_map([], |r| {
            Ok(Entry {
                id: r.get(0)?,
                at: r.get(1)?,
                kind: r.get(2)?,
                entity: r.get(3)?,
                target: r.get(4)?,
                label: r.get(5)?,
                path: r.get(6)?,
                before: r.get(7)?,
                after: r.get(8)?,
                who: r.get(9)?,
                state: r.get(10)?,
                signer: r.get(11)?,
            })
        })
        .map_err(e)?
        .collect::<Result<_, _>>()
        .map_err(e)
}

pub fn set_state(conn: &Connection, ids: &[i64], state: &str) -> Result<(), String> {
    if !matches!(state, "seen" | "reverted") {
        return Err("Unknown state.".into());
    }
    for id in ids.iter().take(KEEP as usize) {
        conn.execute("UPDATE catchup_log SET state = ?1 WHERE id = ?2", params![state, id]).map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ────────────────────────────
// Tauri commands
// ────────────────────────────

fn open(app_handle: &tauri::AppHandle, path: &str) -> Result<crate::database::WorkspaceDb, String> {
    super::data_sync::checked(app_handle, path)?;
    crate::database::WorkspaceDb::open_existing(path)
}

#[tauri::command]
pub fn get_catchup(app_handle: tauri::AppHandle, path: String) -> Result<Vec<Entry>, String> {
    list(&open(&app_handle, &path)?.conn)
}

#[tauri::command]
pub fn mark_catchup(app_handle: tauri::AppHandle, path: String, ids: Vec<i64>, state: String) -> Result<(), String> {
    set_state(&open(&app_handle, &path)?.conn, &ids, &state)
}

#[tauri::command]
pub fn add_text_catchup(app_handle: tauri::AppHandle, path: String, doc_id: String, label: String, who: Option<String>, before: String, after: String, live: Option<bool>) -> Result<(), String> {
    if doc_id.is_empty() || doc_id.len() > 512 || label.len() > 512 || who.as_ref().is_some_and(|w| w.len() > 128) {
        return Err("Invalid change.".into());
    }
    record_text(&open(&app_handle, &path)?.conn, &doc_id, &label, who.as_deref(), &before, &after, live.unwrap_or(false))
}

#[cfg(test)]
mod tests {
    use super::super::crdt;
    use super::super::data_sync::{export_state, merge_state, put_task_row};
    use super::super::models::Task;
    use super::*;

    fn db(ws: &str) -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        crate::database::schema::init_schema(&conn).unwrap();
        conn.execute("INSERT INTO workspace (id, name, description, path, created_at, updated_at) VALUES (?1, 'w', '', '/w', 't', 't')", [ws]).unwrap();
        conn
    }

    fn task(title: &str) -> Task {
        Task { id: "t1".into(), title: title.into(), status: "todo".into(), priority: "medium".into(), created_at: "2026-01-01T00:00:00Z".into(), updated_at: "2026-01-01T00:00:00Z".into(), ..Default::default() }
    }

    /// Two devices share a task; the second changes it as `who` while they are apart
    fn apart(who: &str, edit: impl Fn(&mut Task)) -> (Connection, Connection) {
        let (a, b) = (db("a"), db("b"));
        put_task_row(&a, "a", &task("Old")).unwrap();
        put_task_row(&b, "b", &task("Old")).unwrap();
        crdt::ensure(&b, &task("Old")).unwrap();
        let mut edited = task("Old");
        edit(&mut edited);
        crdt::record_write(&b, &edited, Some(who), None).unwrap();
        put_task_row(&b, "b", &edited).unwrap();
        (a, b)
    }

    #[test]
    fn a_remote_edit_is_journaled_with_its_author_and_old_value() {
        let (a, b) = apart("Sam", |t| {
            t.title = "New".into();
            t.tags = vec!["urgent".into()];
        });
        assert!(merge_state(&a, "a", export_state(&b, "b").unwrap()).unwrap());
        let log = list(&a).unwrap();
        let title = log.iter().find(|e| e.path == "title").expect("title change");
        assert_eq!((title.who.as_deref(), title.before.as_deref(), title.after.as_deref()), (Some("Sam"), Some("\"Old\""), Some("\"New\"")));
        assert!(log.iter().any(|e| e.path == "tags/urgent" && e.before.is_none() && e.after.is_some()));
        assert!(log.iter().all(|e| e.state == "new"));
    }

    #[test]
    fn merging_the_same_state_again_adds_nothing() {
        let (a, b) = apart("Sam", |t| t.title = "New".into());
        merge_state(&a, "a", export_state(&b, "b").unwrap()).unwrap();
        let first = list(&a).unwrap().len();
        merge_state(&a, "a", export_state(&b, "b").unwrap()).unwrap();
        assert_eq!(list(&a).unwrap().len(), first);
    }

    #[test]
    fn a_record_new_to_this_device_is_one_created_entry() {
        let (a, b) = (db("a"), db("b"));
        let t = task("Fresh");
        put_task_row(&b, "b", &t).unwrap();
        crdt::record_write(&b, &t, Some("Sam"), None).unwrap();
        merge_state(&a, "a", export_state(&b, "b").unwrap()).unwrap();
        let log = list(&a).unwrap();
        assert_eq!(log.len(), 1);
        assert_eq!((log[0].kind.as_str(), log[0].who.as_deref(), log[0].label.as_str()), ("created", Some("Sam"), "Fresh"));
    }

    #[test]
    fn undoing_a_journaled_change_is_a_new_write_that_reaches_the_author_too() {
        use super::super::data_sync::read_task;
        let (a, b) = apart("Sam", |t| {
            t.title = "New".into();
            t.tags = vec!["urgent".into()];
        });
        merge_state(&a, "a", export_state(&b, "b").unwrap()).unwrap();
        let log = list(&a).unwrap();

        // The review writes each old value back: the title, and "no tag" (null) for the tag that had no value before
        let mut row = read_task(&a, "t1").unwrap().unwrap();
        for entry in &log {
            let before: Value = entry.before.as_deref().map_or(Value::Null, |j| serde_json::from_str(j).unwrap());
            row = crdt::resolve_field(&a, &row, &entry.path, before, Some("Me")).unwrap().unwrap();
        }
        put_task_row(&a, "a", &row).unwrap();
        assert_eq!((row.title.as_str(), row.tags.len()), ("Old", 0));

        // Sam's device takes the undo as an ordinary newer write, and both devices end up identical
        merge_state(&b, "b", export_state(&a, "a").unwrap()).unwrap();
        let theirs = read_task(&b, "t1").unwrap().unwrap();
        assert_eq!((theirs.title.as_str(), theirs.tags.len()), ("Old", 0));
        let undone = list(&b).unwrap();
        assert!(undone.iter().any(|e| e.path == "title" && e.who.as_deref() == Some("Me") && e.after.as_deref() == Some("\"Old\"")));
    }

    #[test]
    fn signed_writes_name_their_device_and_forgeries_are_refused() {
        use super::super::data_sync::read_task;
        use super::super::signing;
        signing::init_for_tests();
        let device = iroh::SecretKey::from_bytes(&[7u8; 32]).public().to_string();
        let (a, b) = apart("Sam", |t| t.title = "New".into());

        // A value changed after it was signed: the whole record is refused and nothing here changes
        let mut forged = export_state(&b, "b").unwrap();
        forged.tasks[0].crdt.as_mut().unwrap().fields.get_mut("title").unwrap()[0].value = serde_json::json!("Hacked");
        assert!(!merge_state(&a, "a", forged).unwrap());
        assert_eq!(read_task(&a, "t1").unwrap().unwrap().title, "Old");

        // A real signature put on a different record
        let mut moved = export_state(&b, "b").unwrap();
        moved.tasks[0].id = "t2".into();
        assert!(!merge_state(&a, "a", moved).unwrap());
        assert!(read_task(&a, "t2").unwrap().is_none());

        // A signature with its key removed is not a valid one either
        let mut half = export_state(&b, "b").unwrap();
        for s in half.tasks[0].crdt.as_mut().unwrap().fields.values_mut().flatten() {
            s.by = None;
        }
        assert!(!merge_state(&a, "a", half).unwrap());

        // The untouched state merges, and the journal says which key wrote the change
        assert!(merge_state(&a, "a", export_state(&b, "b").unwrap()).unwrap());
        let title = list(&a).unwrap().into_iter().find(|e| e.path == "title").unwrap();
        assert_eq!((title.who.as_deref(), title.signer.as_deref()), (Some("Sam"), Some(device.as_str())));

        // A device that does not sign (an older version) is still accepted, and simply cannot be vouched for
        let c = db("c");
        put_task_row(&c, "c", &task("Old")).unwrap();
        let mut unsigned = export_state(&b, "b").unwrap();
        for s in unsigned.tasks[0].crdt.as_mut().unwrap().fields.values_mut().flatten() {
            s.by = None;
            s.sig = None;
        }
        assert!(merge_state(&c, "c", unsigned).unwrap());
        assert!(list(&c).unwrap().iter().all(|e| e.signer.is_none()));
    }

    #[test]
    fn marking_seen_removes_entries_and_the_journal_is_bounded() {
        let a = db("a");
        for i in 0..(KEEP + 20) {
            record_deleted(&a, "task", &format!("t{i}"), "x").unwrap();
        }
        let all = list(&a).unwrap();
        assert_eq!(all.len() as i64, KEEP);
        set_state(&a, &[all[0].id], "seen").unwrap();
        assert_eq!(list(&a).unwrap().len() as i64, KEEP - 1);
        assert!(set_state(&a, &[1], "anything").is_err());
    }

    #[test]
    fn text_changes_keep_their_content_unless_too_large() {
        let a = db("a");
        record_text(&a, "notes/a.md", "a.md", Some("Sam"), "one", "two", false).unwrap();
        record_text(&a, "notes/b.md", "b.md", Some("Sam"), &"x".repeat(MAX_TEXT + 1), "y", false).unwrap();
        record_text(&a, "notes/c.md", "c.md", None, "same", "same", false).unwrap();
        let log = list(&a).unwrap();
        assert_eq!(log.len(), 2);
        assert!(log.iter().find(|e| e.target == "notes/b.md").unwrap().before.is_none());
        assert_eq!(log.iter().find(|e| e.target == "notes/a.md").unwrap().after.as_deref(), Some("two"));
    }
}
