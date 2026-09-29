//! Catch-up sync for tasks and kanban: per-record last-write-wins with delete markers (tombstones).
//!
//! Peers exchange their full state on every connect and merge it symmetrically, so edits made
//! while offline converge. A record with the newer `updated_at` wins; a tombstone keeps a stale
//! copy from bringing a deleted record back unless that copy was edited after the deletion.
// ponytail: wall-clock timestamps, so badly skewed device clocks can pick the wrong winner; swap in hybrid logical clocks if that bites.

use std::collections::HashMap;

use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use super::helpers::get_workspace_id;
use super::models::{KanbanCard, Task};
use crate::commands::validation::{validate_task_priority, validate_task_status};

pub const ENTITY_TASK: &str = "task";
pub const ENTITY_COLUMN: &str = "column";
pub const ENTITY_CARD: &str = "card";

/// Marks a record as deleted at a point in time
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Tombstone {
    pub entity: String,
    pub id: String,
    pub deleted_at: String,
}

/// A kanban column without its cards
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq, Eq)]
pub struct ColumnRecord {
    pub id: String,
    pub title: String,
    pub position: i64,
}

/// Everything two peers compare when catching up
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct DataState {
    pub tasks: Vec<Task>,
    pub columns: Vec<ColumnRecord>,
    pub cards: Vec<KanbanCard>,
    pub tombstones: Vec<Tombstone>,
}

fn parse_time(s: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(s).ok().map(|t| t.with_timezone(&Utc))
}

/// True if `a` is a later instant than `b`; an unreadable `a` never wins.
fn is_later(a: &str, b: &str) -> bool {
    match (parse_time(a), parse_time(b)) {
        (Some(a), Some(b)) => a > b,
        (Some(_), None) => true,
        _ => false,
    }
}

/// Decides whether an incoming record replaces the local one: later edit wins, and a stable
/// tie-break on the serialized form makes both peers choose the same winner.
fn remote_wins<T: Serialize>(remote: &T, remote_at: &str, local: Option<(&T, &str)>) -> bool {
    let Some((local, local_at)) = local else { return true };
    let (r, l) = (serde_json::to_string(remote).ok(), serde_json::to_string(local).ok());
    r != l && (is_later(remote_at, local_at) || (remote_at == local_at && r > l))
}

/// Records that a record was deleted now, so peers don't resurrect it.
pub fn record_tombstone(conn: &Connection, ws_id: &str, entity: &str, id: &str) -> Result<(), String> {
    conn.execute(
        "INSERT OR REPLACE INTO tombstones (workspace_id, entity, id, deleted_at) VALUES (?1, ?2, ?3, ?4)",
        params![ws_id, entity, id, Utc::now().to_rfc3339()],
    )
    .map(|_| ())
    .map_err(|e| e.to_string())
}

/// Forgets a tombstone because the record exists again.
pub fn clear_tombstone(conn: &Connection, entity: &str, id: &str) -> Result<(), String> {
    conn.execute("DELETE FROM tombstones WHERE entity = ?1 AND id = ?2", params![entity, id])
        .map(|_| ())
        .map_err(|e| e.to_string())
}

fn valid_task(t: &Task) -> bool {
    !t.id.is_empty()
        && t.id.len() <= 64
        && !t.title.is_empty()
        && t.title.len() <= 256
        && t.description.len() <= 32768
        && validate_task_status(&t.status).is_ok()
        && validate_task_priority(&t.priority).is_ok()
}

fn valid_card(c: &KanbanCard) -> bool {
    !c.id.is_empty()
        && c.id.len() <= 64
        && c.column_id.len() <= 64
        && !c.title.is_empty()
        && c.title.len() <= 256
        && c.description.len() <= 32768
}

const TASK_COLUMNS: &str =
    "id, title, description, status, priority, due_date, assignee_id, created_at, updated_at";
const CARD_COLUMNS: &str = "id, title, description, column_id, position, created_at, updated_at";

fn task_from_row(r: &rusqlite::Row) -> rusqlite::Result<Task> {
    Ok(Task {
        id: r.get(0)?,
        title: r.get(1)?,
        description: r.get(2)?,
        status: r.get(3)?,
        priority: r.get(4)?,
        due_date: r.get(5)?,
        assignee_id: r.get(6)?,
        created_at: r.get(7)?,
        updated_at: r.get(8)?,
    })
}

fn card_from_row(r: &rusqlite::Row) -> rusqlite::Result<KanbanCard> {
    Ok(KanbanCard {
        id: r.get(0)?,
        title: r.get(1)?,
        description: r.get(2)?,
        column_id: r.get(3)?,
        position: r.get(4)?,
        created_at: r.get(5)?,
        updated_at: r.get(6)?,
    })
}

/// Reads this device's full task and kanban state.
pub fn export_state(conn: &Connection, ws_id: &str) -> Result<DataState, String> {
    let e = |e: rusqlite::Error| e.to_string();
    let tasks = conn
        .prepare(&format!("SELECT {TASK_COLUMNS} FROM tasks WHERE workspace_id = ?1"))
        .map_err(e)?
        .query_map([ws_id], task_from_row)
        .map_err(e)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(e)?;
    let columns = conn
        .prepare("SELECT id, title, position FROM kanban_columns WHERE workspace_id = ?1")
        .map_err(e)?
        .query_map([ws_id], |r| Ok(ColumnRecord { id: r.get(0)?, title: r.get(1)?, position: r.get(2)? }))
        .map_err(e)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(e)?;
    let cards = conn
        .prepare(&format!("SELECT {CARD_COLUMNS} FROM kanban_cards WHERE workspace_id = ?1"))
        .map_err(e)?
        .query_map([ws_id], card_from_row)
        .map_err(e)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(e)?;
    let tombstones = conn
        .prepare("SELECT entity, id, deleted_at FROM tombstones WHERE workspace_id = ?1")
        .map_err(e)?
        .query_map([ws_id], |r| Ok(Tombstone { entity: r.get(0)?, id: r.get(1)?, deleted_at: r.get(2)? }))
        .map_err(e)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(e)?;
    Ok(DataState { tasks, columns, cards, tombstones })
}

/// Merges a peer's state into this device's database; returns true if anything changed.
pub fn merge_state(conn: &Connection, ws_id: &str, remote: DataState) -> Result<bool, String> {
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    let mut changed = false;
    let e = |e: rusqlite::Error| e.to_string();

    let mut tombs: HashMap<(String, String), String> = tx
        .prepare("SELECT entity, id, deleted_at FROM tombstones WHERE workspace_id = ?1")
        .map_err(e)?
        .query_map([ws_id], |r| Ok(((r.get(0)?, r.get(1)?), r.get(2)?)))
        .map_err(e)?
        .collect::<Result<_, _>>()
        .map_err(e)?;

    // 1. Deletions: remove records that were not edited after the peer deleted them.
    for t in &remote.tombstones {
        let table = match t.entity.as_str() {
            ENTITY_TASK => "tasks",
            ENTITY_CARD => "kanban_cards",
            ENTITY_COLUMN => "kanban_columns",
            _ => continue,
        };
        // `None` means no such record; `Some(None)` is a record without an edit time (columns).
        let local_updated: Option<Option<String>> = if t.entity == ENTITY_COLUMN {
            tx.query_row("SELECT 1 FROM kanban_columns WHERE id = ?1", [&t.id], |_| Ok(None))
                .optional()
                .map_err(e)?
        } else {
            tx.query_row(&format!("SELECT updated_at FROM {table} WHERE id = ?1"), [&t.id], |r| Ok(Some(r.get(0)?)))
                .optional()
                .map_err(e)?
        };
        if let Some(Some(updated)) = &local_updated {
            if is_later(updated, &t.deleted_at) {
                continue; // Edited after the deletion, so the record survives.
            }
        }
        if local_updated.is_some() {
            tx.execute(&format!("DELETE FROM {table} WHERE id = ?1"), [&t.id]).map_err(e)?;
            changed = true;
        }
        let key = (t.entity.clone(), t.id.clone());
        if tombs.get(&key).is_none_or(|old| is_later(&t.deleted_at, old)) {
            tx.execute(
                "INSERT OR REPLACE INTO tombstones (workspace_id, entity, id, deleted_at) VALUES (?1, ?2, ?3, ?4)",
                params![ws_id, t.entity, t.id, t.deleted_at],
            )
            .map_err(e)?;
            tombs.insert(key, t.deleted_at.clone());
            changed = true;
        }
    }

    // 2. Columns: add the ones we don't have and haven't deleted.
    let now = Utc::now().to_rfc3339();
    for c in &remote.columns {
        if c.id.is_empty() || c.id.len() > 64 || c.title.is_empty() || c.title.len() > 128 {
            continue;
        }
        if tombs.contains_key(&(ENTITY_COLUMN.into(), c.id.clone())) {
            continue;
        }
        let added = tx
            .execute(
                "INSERT OR IGNORE INTO kanban_columns (id, workspace_id, title, position, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
                params![c.id, ws_id, c.title, c.position, now],
            )
            .map_err(e)?;
        changed |= added > 0;
    }

    // 3. Tasks.
    for t in remote.tasks.iter().filter(|t| valid_task(t)) {
        if tombs.get(&(ENTITY_TASK.into(), t.id.clone())).is_some_and(|d| !is_later(&t.updated_at, d)) {
            continue;
        }
        let local: Option<Task> = tx
            .query_row(&format!("SELECT {TASK_COLUMNS} FROM tasks WHERE id = ?1"), [&t.id], task_from_row)
            .optional()
            .map_err(e)?;
        if !remote_wins(t, &t.updated_at, local.as_ref().map(|l| (l, l.updated_at.as_str()))) {
            continue;
        }
        tx.execute(
            "INSERT OR REPLACE INTO tasks (id, workspace_id, title, description, status, priority,
             due_date, assignee_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                t.id, ws_id, t.title, t.description, t.status, t.priority, t.due_date, t.assignee_id,
                t.created_at, t.updated_at
            ],
        )
        .map_err(e)?;
        tx.execute("DELETE FROM tombstones WHERE entity = ?1 AND id = ?2", params![ENTITY_TASK, t.id]).map_err(e)?;
        changed = true;
    }

    // 4. Cards: same rule, and only into a column that exists here.
    for c in remote.cards.iter().filter(|c| valid_card(c)) {
        if tombs.get(&(ENTITY_CARD.into(), c.id.clone())).is_some_and(|d| !is_later(&c.updated_at, d)) {
            continue;
        }
        let column_exists = tx
            .query_row("SELECT 1 FROM kanban_columns WHERE id = ?1", [&c.column_id], |_| Ok(()))
            .optional()
            .map_err(e)?
            .is_some();
        if !column_exists {
            continue;
        }
        let local: Option<KanbanCard> = tx
            .query_row(&format!("SELECT {CARD_COLUMNS} FROM kanban_cards WHERE id = ?1"), [&c.id], card_from_row)
            .optional()
            .map_err(e)?;
        if !remote_wins(c, &c.updated_at, local.as_ref().map(|l| (l, l.updated_at.as_str()))) {
            continue;
        }
        tx.execute(
            "INSERT OR REPLACE INTO kanban_cards (id, workspace_id, column_id, title, description,
             position, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![c.id, ws_id, c.column_id, c.title, c.description, c.position, c.created_at, c.updated_at],
        )
        .map_err(e)?;
        tx.execute("DELETE FROM tombstones WHERE entity = ?1 AND id = ?2", params![ENTITY_CARD, c.id]).map_err(e)?;
        changed = true;
    }

    tx.commit().map_err(e)?;
    Ok(changed)
}

/// Opens the workspace database at `path` and exports its state.
pub fn export_for(path: &str) -> Result<DataState, String> {
    let db = crate::database::WorkspaceDb::open_existing(path)?;
    let ws_id = get_workspace_id(&db)?;
    export_state(&db.conn, &ws_id)
}

/// Opens the workspace database at `path` and merges a peer's state into it.
pub fn merge_into(path: &str, remote: DataState) -> Result<bool, String> {
    let db = crate::database::WorkspaceDb::open_existing(path)?;
    let ws_id = get_workspace_id(&db)?;
    merge_state(&db.conn, &ws_id, remote)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn db(ws: &str) -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        crate::database::schema::init_schema(&conn).unwrap();
        conn.execute(
            "INSERT INTO workspace (id, name, description, path, created_at, updated_at) VALUES (?1, 'w', '', '/w', 't', 't')",
            [ws],
        )
        .unwrap();
        conn
    }

    fn task(id: &str, title: &str, at: &str) -> Task {
        Task {
            id: id.into(),
            title: title.into(),
            description: String::new(),
            status: "todo".into(),
            priority: "medium".into(),
            due_date: None,
            assignee_id: None,
            created_at: "2026-01-01T00:00:00Z".into(),
            updated_at: at.into(),
        }
    }

    fn only_tasks(tasks: Vec<Task>) -> DataState {
        DataState { tasks, ..Default::default() }
    }

    fn put_task(conn: &Connection, ws: &str, t: &Task) {
        merge_state(conn, ws, only_tasks(vec![t.clone()])).unwrap();
    }

    fn titles(conn: &Connection, ws: &str) -> Vec<(String, String)> {
        let mut v: Vec<_> = export_state(conn, ws).unwrap().tasks.into_iter().map(|t| (t.id, t.title)).collect();
        v.sort();
        v
    }

    #[test]
    fn test_newer_edit_wins_and_older_is_ignored() {
        let a = db("a");
        put_task(&a, "a", &task("1", "old", "2026-01-02T00:00:00Z"));
        assert!(merge_state(&a, "a", only_tasks(vec![task("1", "new", "2026-01-03T00:00:00Z")])).unwrap());
        assert_eq!(titles(&a, "a"), vec![("1".into(), "new".into())]);
        assert!(!merge_state(&a, "a", only_tasks(vec![task("1", "stale", "2026-01-01T12:00:00Z")])).unwrap());
        assert_eq!(titles(&a, "a"), vec![("1".into(), "new".into())]);
    }

    #[test]
    fn test_timestamps_compare_as_instants_not_strings() {
        let a = db("a");
        put_task(&a, "a", &task("1", "local", "2026-01-02T10:00:00+00:00"));
        // 09:00 at UTC-5 is 14:00 UTC, which is later even though the string sorts earlier.
        put_task(&a, "a", &task("1", "remote", "2026-01-02T09:00:00-05:00"));
        assert_eq!(titles(&a, "a"), vec![("1".into(), "remote".into())]);
    }

    #[test]
    fn test_deletion_wins_over_older_copy_and_blocks_resurrection() {
        let a = db("a");
        let b = db("b");
        let t = task("1", "keep?", "2026-01-02T00:00:00Z");
        put_task(&a, "a", &t);
        put_task(&b, "b", &t);
        record_tombstone(&a, "a", ENTITY_TASK, "1").unwrap();
        a.execute("DELETE FROM tasks WHERE id = '1'", []).unwrap();

        // The peer that stayed offline receives the deletion...
        merge_state(&b, "b", export_state(&a, "a").unwrap()).unwrap();
        assert!(titles(&b, "b").is_empty());
        // ...and its old copy can no longer bring the record back on the deleting side.
        put_task(&a, "a", &t);
        assert!(titles(&a, "a").is_empty());
    }

    #[test]
    fn test_edit_after_deletion_survives() {
        let a = db("a");
        record_tombstone(&a, "a", ENTITY_TASK, "1").unwrap();
        put_task(&a, "a", &task("1", "revived", "2999-01-01T00:00:00Z"));
        assert_eq!(titles(&a, "a"), vec![("1".into(), "revived".into())]);
        assert!(export_state(&a, "a").unwrap().tombstones.is_empty());
    }

    #[test]
    fn test_two_devices_converge_after_offline_edits() {
        let a = db("a");
        let b = db("b");
        put_task(&a, "a", &task("1", "shared", "2026-01-01T00:00:00Z"));
        put_task(&b, "b", &task("1", "shared", "2026-01-01T00:00:00Z"));
        put_task(&a, "a", &task("1", "edited on a", "2026-01-05T00:00:00Z"));
        put_task(&b, "b", &task("1", "edited on b", "2026-01-06T00:00:00Z"));
        put_task(&a, "a", &task("only-a", "a task", "2026-01-02T00:00:00Z"));
        put_task(&b, "b", &task("only-b", "b task", "2026-01-02T00:00:00Z"));

        merge_state(&a, "a", export_state(&b, "b").unwrap()).unwrap();
        merge_state(&b, "b", export_state(&a, "a").unwrap()).unwrap();
        assert_eq!(titles(&a, "a"), titles(&b, "b"));
        assert_eq!(titles(&a, "a").len(), 3);
        assert!(titles(&a, "a").contains(&("1".into(), "edited on b".into())));
    }

    #[test]
    fn test_equal_timestamps_still_converge() {
        let a = db("a");
        let b = db("b");
        put_task(&a, "a", &task("1", "from a", "2026-01-05T00:00:00Z"));
        put_task(&b, "b", &task("1", "from b", "2026-01-05T00:00:00Z"));
        merge_state(&a, "a", export_state(&b, "b").unwrap()).unwrap();
        merge_state(&b, "b", export_state(&a, "a").unwrap()).unwrap();
        assert_eq!(titles(&a, "a"), titles(&b, "b"));
    }

    #[test]
    fn test_cards_follow_columns_and_deleted_columns_stay_deleted() {
        let a = db("a");
        let col = ColumnRecord { id: "c1".into(), title: "Todo".into(), position: 0 };
        let card = KanbanCard {
            id: "k1".into(),
            title: "card".into(),
            description: String::new(),
            column_id: "c1".into(),
            position: 0,
            created_at: "2026-01-01T00:00:00Z".into(),
            updated_at: "2026-01-01T00:00:00Z".into(),
        };
        // A card for a column we don't have is skipped rather than failing the whole merge.
        merge_state(&a, "a", DataState { cards: vec![card.clone()], ..Default::default() }).unwrap();
        assert!(export_state(&a, "a").unwrap().cards.is_empty());

        merge_state(&a, "a", DataState { columns: vec![col.clone()], cards: vec![card.clone()], ..Default::default() }).unwrap();
        assert_eq!(export_state(&a, "a").unwrap().cards.len(), 1);

        // Deleting the column removes its cards, and the old column can't come back.
        let tomb = Tombstone { entity: ENTITY_COLUMN.into(), id: "c1".into(), deleted_at: "2999-01-01T00:00:00Z".into() };
        merge_state(&a, "a", DataState { tombstones: vec![tomb], ..Default::default() }).unwrap();
        let s = export_state(&a, "a").unwrap();
        assert!(s.columns.is_empty() && s.cards.is_empty());
        merge_state(&a, "a", DataState { columns: vec![col], cards: vec![card], ..Default::default() }).unwrap();
        assert!(export_state(&a, "a").unwrap().columns.is_empty());
    }

    #[test]
    fn test_invalid_remote_records_are_ignored() {
        let a = db("a");
        let mut bad = task("1", "bad status", "2026-01-02T00:00:00Z");
        bad.status = "not-a-status".into();
        let empty_title = task("2", "", "2026-01-02T00:00:00Z");
        merge_state(&a, "a", only_tasks(vec![bad, empty_title])).unwrap();
        assert!(titles(&a, "a").is_empty());
    }
}
