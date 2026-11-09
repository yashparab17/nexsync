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

use super::crdt;
use super::helpers::get_workspace_id;
use super::models::{json_list, to_json, valid_checklist, valid_comments, valid_tags, KanbanCard, Task};
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
    /// The record was erased for good, not only deleted: a device that was away scrubs its history of it too
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub erased: bool,
}

/// A file or folder that was erased for good, and when
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ErasedPath {
    pub path: String,
    pub erased_at: String,
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
    /// Files and folders erased for good; absent from a device that predates erasing
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub erased_paths: Vec<ErasedPath>,
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

pub(super) fn valid_task(t: &Task) -> bool {
    !t.id.is_empty()
        && t.id.len() <= 64
        && !t.title.is_empty()
        && t.title.len() <= 256
        && t.description.len() <= 32768
        && valid_tags(&t.tags)
        && valid_comments(&t.comments)
        && validate_task_status(&t.status).is_ok()
        && validate_task_priority(&t.priority).is_ok()
}

pub(super) fn valid_card(c: &KanbanCard) -> bool {
    !c.id.is_empty()
        && c.id.len() <= 64
        && c.column_id.len() <= 64
        && !c.title.is_empty()
        && c.title.len() <= 256
        && c.description.len() <= 32768
        && valid_tags(&c.tags)
        && valid_comments(&c.comments)
        && valid_checklist(&c.checklist)
}

const TASK_COLUMNS: &str =
    "id, title, description, status, priority, due_date, assignee_id, created_at, updated_at, tags, comments";
const CARD_COLUMNS: &str =
    "id, title, description, column_id, position, created_at, updated_at, tags, due_date, assignee_id, checklist, comments";

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
        tags: json_list(&r.get::<_, String>(9)?),
        comments: json_list(&r.get::<_, String>(10)?),
        ..Default::default()
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
        tags: json_list(&r.get::<_, String>(7)?),
        due_date: r.get(8)?,
        assignee_id: r.get(9)?,
        checklist: json_list(&r.get::<_, String>(10)?),
        comments: json_list(&r.get::<_, String>(11)?),
        ..Default::default()
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
        .prepare("SELECT entity, id, deleted_at, erased FROM tombstones WHERE workspace_id = ?1")
        .map_err(e)?
        .query_map([ws_id], |r| Ok(Tombstone { entity: r.get(0)?, id: r.get(1)?, deleted_at: r.get(2)?, erased: r.get::<_, i64>(3)? != 0 }))
        .map_err(e)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(e)?;
    let erased_paths = conn
        .prepare("SELECT path, erased_at FROM erased_paths")
        .map_err(e)?
        .query_map([], |r| Ok(ErasedPath { path: r.get(0)?, erased_at: r.get(1)? }))
        .map_err(e)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(e)?;
    let (mut tasks, mut cards) = (tasks, cards);
    for t in &mut tasks {
        crdt::attach(conn, t)?;
    }
    for c in &mut cards {
        crdt::attach(conn, c)?;
    }
    Ok(DataState { tasks, columns, cards, tombstones, erased_paths })
}

pub fn read_task(conn: &Connection, id: &str) -> Result<Option<Task>, String> {
    conn.query_row(&format!("SELECT {TASK_COLUMNS} FROM tasks WHERE id = ?1"), [id], task_from_row).optional().map_err(|e| e.to_string())
}

pub fn read_card(conn: &Connection, id: &str) -> Result<Option<KanbanCard>, String> {
    conn.query_row(&format!("SELECT {CARD_COLUMNS} FROM kanban_cards WHERE id = ?1"), [id], card_from_row).optional().map_err(|e| e.to_string())
}

pub(super) fn put_task_row(conn: &Connection, ws_id: &str, t: &Task) -> Result<(), String> {
    conn.execute(
        "INSERT OR REPLACE INTO tasks (id, workspace_id, title, description, status, priority,
         due_date, assignee_id, created_at, updated_at, tags, comments)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
        params![
            t.id, ws_id, t.title, t.description, t.status, t.priority, t.due_date, t.assignee_id,
            t.created_at, t.updated_at, to_json(&t.tags), to_json(&t.comments)
        ],
    )
    .map(|_| ())
    .map_err(|e| e.to_string())
}

pub(super) fn put_card(conn: &Connection, ws_id: &str, c: &KanbanCard) -> Result<(), String> {
    conn.execute(
        "INSERT OR REPLACE INTO kanban_cards (id, workspace_id, column_id, title, description,
         position, created_at, updated_at, tags, due_date, assignee_id, checklist, comments)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
        params![
            c.id, ws_id, c.column_id, c.title, c.description, c.position, c.created_at, c.updated_at,
            to_json(&c.tags), c.due_date, c.assignee_id, to_json(&c.checklist), to_json(&c.comments)
        ],
    )
    .map(|_| ())
    .map_err(|e| e.to_string())
}

/// The column that takes in cards whose own column was deleted while someone else was still using it
pub const RECOVERED_COLUMN: &str = "recovered";

/// Merges one task a peer sent into this device's copy; returns true if the local record changed.
fn merge_task(conn: &Connection, ws_id: &str, tombs: &HashMap<(String, String), String>, t: &Task) -> Result<bool, String> {
    if !valid_task(t) || crdt_too_big(t.crdt.as_ref()) {
        return Ok(false);
    }
    if tombs.get(&(ENTITY_TASK.into(), t.id.clone())).is_some_and(|d| !is_later(&t.updated_at, d)) {
        return Ok(false);
    }
    let local = read_task(conn, &t.id)?;
    let Some(row) = crdt::merge_remote(conn, t, local.as_ref(), valid_task)? else { return Ok(false) };
    put_task_row(conn, ws_id, &row)?;
    clear_tombstone(conn, ENTITY_TASK, &t.id)?;
    journal(conn, ENTITY_TASK, &row.id, &row.title, local.as_ref().map(|l| crdt::Crdt::paths(l, false)), crdt::Crdt::paths(&row, false))?;
    Ok(true)
}

/// Same for a card. A card whose column no longer exists goes to a Recovered column, not into the void.
fn merge_card(conn: &Connection, ws_id: &str, tombs: &HashMap<(String, String), String>, c: &KanbanCard) -> Result<bool, String> {
    if !valid_card(c) || crdt_too_big(c.crdt.as_ref()) {
        return Ok(false);
    }
    if tombs.get(&(ENTITY_CARD.into(), c.id.clone())).is_some_and(|d| !is_later(&c.updated_at, d)) {
        return Ok(false);
    }
    let local = read_card(conn, &c.id)?;
    let Some(mut row) = crdt::merge_remote(conn, c, local.as_ref(), valid_card)? else {
        return reclaim(conn, local.as_ref());
    };
    let column_exists = conn
        .query_row("SELECT 1 FROM kanban_columns WHERE id = ?1", [&row.column_id], |_| Ok(()))
        .optional()
        .map_err(|e| e.to_string())?
        .is_some();
    if !column_exists {
        let now = Utc::now().to_rfc3339();
        conn.execute(
            "INSERT OR IGNORE INTO kanban_columns (id, workspace_id, title, position, created_at, updated_at)
             VALUES (?1, ?2, 'Recovered', 9999, ?3, ?3)",
            params![RECOVERED_COLUMN, ws_id, now],
        )
        .map_err(|e| e.to_string())?;
        row.column_id = RECOVERED_COLUMN.to_string();
    }
    put_card(conn, ws_id, &row)?;
    clear_tombstone(conn, ENTITY_CARD, &c.id)?;
    journal(conn, ENTITY_CARD, &row.id, &row.title, local.as_ref().map(|l| crdt::Crdt::paths(l, false)), crdt::Crdt::paths(&row, false))?;
    Ok(true)
}

/// Writes down what a merge changed in a record, for the catch-up review
fn journal(conn: &Connection, entity: &str, id: &str, label: &str, before: Option<std::collections::BTreeMap<String, serde_json::Value>>, after: std::collections::BTreeMap<String, serde_json::Value>) -> Result<(), String> {
    let Some(state) = crdt::load(conn, entity, id)? else { return Ok(()) };
    super::catchup::record_merge(conn, entity, id, label, before.as_ref(), &after, &state)
}

/// A card parked in the Recovered column goes back to its own column once that column exists here again
fn reclaim(conn: &Connection, parked: Option<&KanbanCard>) -> Result<bool, String> {
    let Some(card) = parked.filter(|c| c.column_id == RECOVERED_COLUMN) else { return Ok(false) };
    let Some(state) = crdt::load(conn, <KanbanCard as crdt::Crdt>::ENTITY, &card.id)? else { return Ok(false) };
    let Some(home) = state.resolved().get("column_id").and_then(|v| v.as_str().map(str::to_string)) else { return Ok(false) };
    let home_exists = conn.query_row("SELECT 1 FROM kanban_columns WHERE id = ?1", [&home], |_| Ok(())).optional().map_err(|e| e.to_string())?.is_some();
    if home == RECOVERED_COLUMN || !home_exists {
        return Ok(false);
    }
    conn.execute("UPDATE kanban_cards SET column_id = ?1 WHERE id = ?2", params![home, card.id]).map_err(|e| e.to_string())?;
    Ok(true)
}

/// Merge state comes from a peer, so it is bounded like everything else they send
fn crdt_too_big(state: Option<&crdt::RecordState>) -> bool {
    state.is_some_and(|s| s.fields.len() > 1000 || s.vv.len() > 64 || s.fields.values().any(|v| v.len() > 64))
}

/// Runs one record's merge on its own, so a record the database refuses (say, one assigned to a member this device has
/// no record of yet) does not stop the rest of a peer's state from merging. What it had written is undone, which also
/// keeps its merge state from being saved without its row; the record merges on a later sync once it can be stored.
fn isolated(conn: &Connection, id: &str, merge: impl FnOnce() -> Result<bool, String>) -> Result<bool, String> {
    conn.execute_batch("SAVEPOINT merge_one").map_err(|e| e.to_string())?;
    match merge() {
        Ok(changed) => {
            conn.execute_batch("RELEASE merge_one").map_err(|e| e.to_string())?;
            Ok(changed)
        }
        Err(e) => {
            eprintln!("[sync] Could not merge record {id} yet: {e}");
            conn.execute_batch("ROLLBACK TO merge_one; RELEASE merge_one").map_err(|e| e.to_string())?;
            Ok(false)
        }
    }
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
            if t.entity != ENTITY_COLUMN {
                let title: Option<String> = tx.query_row(&format!("SELECT title FROM {table} WHERE id = ?1"), [&t.id], |r| r.get(0)).optional().map_err(e)?;
                super::catchup::record_deleted(&tx, &t.entity, &t.id, &title.unwrap_or_default())?;
            }
            tx.execute(&format!("DELETE FROM {table} WHERE id = ?1"), [&t.id]).map_err(e)?;
            changed = true;
        }
        if t.erased && matches!(t.entity.as_str(), ENTITY_TASK | ENTITY_CARD) {
            super::erase::scrub_record(&tx, &t.entity, &t.id)?;
            changed = true;
        }
        let key = (t.entity.clone(), t.id.clone());
        if t.erased || tombs.get(&key).is_none_or(|old| is_later(&t.deleted_at, old)) {
            tx.execute(
                "INSERT OR REPLACE INTO tombstones (workspace_id, entity, id, deleted_at, erased) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![ws_id, t.entity, t.id, t.deleted_at, t.erased],
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

    // 3. Tasks and 4. cards: merged field by field, see crdt.rs
    for t in &remote.tasks {
        changed |= isolated(&tx, &t.id, || merge_task(&tx, ws_id, &tombs, t))?;
    }
    for c in &remote.cards {
        changed |= isolated(&tx, &c.id, || merge_card(&tx, ws_id, &tombs, c))?;
    }

    tx.commit().map_err(e)?;
    Ok(changed)
}

/// Merges one record that arrived live from a peer
pub fn merge_task_into(path: &str, task: &Task) -> Result<bool, String> {
    let db = crate::database::WorkspaceDb::open_existing(path)?;
    let ws_id = get_workspace_id(&db)?;
    let tx = db.conn.unchecked_transaction().map_err(|e| e.to_string())?;
    let tombs = tombstone_map(&tx, &ws_id)?;
    let changed = merge_task(&tx, &ws_id, &tombs, task)?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(changed)
}

pub fn merge_card_into(path: &str, card: &KanbanCard) -> Result<bool, String> {
    let db = crate::database::WorkspaceDb::open_existing(path)?;
    let ws_id = get_workspace_id(&db)?;
    let tx = db.conn.unchecked_transaction().map_err(|e| e.to_string())?;
    let tombs = tombstone_map(&tx, &ws_id)?;
    let changed = merge_card(&tx, &ws_id, &tombs, card)?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(changed)
}

fn tombstone_map(conn: &Connection, ws_id: &str) -> Result<HashMap<(String, String), String>, String> {
    let e = |e: rusqlite::Error| e.to_string();
    conn.prepare("SELECT entity, id, deleted_at FROM tombstones WHERE workspace_id = ?1")
        .map_err(e)?
        .query_map([ws_id], |r| Ok(((r.get(0)?, r.get(1)?), r.get(2)?)))
        .map_err(e)?
        .collect::<Result<_, _>>()
        .map_err(e)
}

/// A record as other devices should merge it: its row plus its merge state
pub fn export_task(path: &str, id: &str) -> Result<Option<Task>, String> {
    let db = crate::database::WorkspaceDb::open_existing(path)?;
    let Some(mut task) = read_task(&db.conn, id)? else { return Ok(None) };
    crdt::attach(&db.conn, &mut task)?;
    Ok(Some(task))
}

pub fn export_card(path: &str, id: &str) -> Result<Option<KanbanCard>, String> {
    let db = crate::database::WorkspaceDb::open_existing(path)?;
    let Some(mut card) = read_card(&db.conn, id)? else { return Ok(None) };
    crdt::attach(&db.conn, &mut card)?;
    Ok(Some(card))
}

/// Settles a conflict on one field by choosing a value; returns the record as it now reads
pub fn resolve_task_field(path: &str, id: &str, field: &str, value: serde_json::Value, author: Option<&str>) -> Result<Option<Task>, String> {
    let db = crate::database::WorkspaceDb::open_existing(path)?;
    let ws_id = get_workspace_id(&db)?;
    let Some(base) = read_task(&db.conn, id)? else { return Ok(None) };
    let Some(row) = crdt::resolve_field(&db.conn, &base, field, value, author)? else { return Ok(None) };
    put_task_row(&db.conn, &ws_id, &row)?;
    export_task(path, id)
}

pub fn resolve_card_field(path: &str, id: &str, field: &str, value: serde_json::Value, author: Option<&str>) -> Result<Option<KanbanCard>, String> {
    let db = crate::database::WorkspaceDb::open_existing(path)?;
    let ws_id = get_workspace_id(&db)?;
    let Some(base) = read_card(&db.conn, id)? else { return Ok(None) };
    let Some(row) = crdt::resolve_field(&db.conn, &base, field, value, author)? else { return Ok(None) };
    put_card(&db.conn, &ws_id, &row)?;
    export_card(path, id)
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
    let erasures = remote.erased_paths.clone();
    let changed = merge_state(&db.conn, &ws_id, remote)?;
    // Files another device erased for good are erased here too
    let erased_files = super::erase::apply_remote_erasures(&db, path, &erasures)?;
    Ok(changed || erased_files)
}

// ────────────────────────────
// Tauri commands — live sync and conflicts
// ────────────────────────────

pub(super) fn checked(app_handle: &tauri::AppHandle, path: &str) -> Result<(), String> {
    crate::commands::config::validate_allowed_root(app_handle, path)?;
    crate::commands::path_utils::resolve_workspace_path(path, ".").map(|_| ())
}

/// A task with the state other devices need to merge it, to send to collaborators after a local change
#[tauri::command(async)]
pub fn export_task_record(app_handle: tauri::AppHandle, path: String, id: String) -> Result<Option<Task>, String> {
    checked(&app_handle, &path)?;
    export_task(&path, &id)
}

#[tauri::command(async)]
pub fn export_card_record(app_handle: tauri::AppHandle, path: String, id: String) -> Result<Option<KanbanCard>, String> {
    checked(&app_handle, &path)?;
    export_card(&path, &id)
}

/// Merges a task a collaborator sent; returns whether anything here changed
#[tauri::command(async)]
pub fn merge_task_record(app_handle: tauri::AppHandle, path: String, task: Task) -> Result<bool, String> {
    checked(&app_handle, &path)?;
    merge_task_into(&path, &task)
}

#[tauri::command(async)]
pub fn merge_card_record(app_handle: tauri::AppHandle, path: String, card: KanbanCard) -> Result<bool, String> {
    checked(&app_handle, &path)?;
    merge_card_into(&path, &card)
}

/// Settles a conflict on a task by choosing one of its values
#[tauri::command(async)]
pub fn resolve_task_conflict(app_handle: tauri::AppHandle, path: String, id: String, field: String, value: serde_json::Value, author: Option<String>) -> Result<Option<Task>, String> {
    checked(&app_handle, &path)?;
    resolve_task_field(&path, &id, &field, value, author.as_deref())
}

#[tauri::command(async)]
pub fn resolve_card_conflict(app_handle: tauri::AppHandle, path: String, id: String, field: String, value: serde_json::Value, author: Option<String>) -> Result<Option<KanbanCard>, String> {
    checked(&app_handle, &path)?;
    resolve_card_field(&path, &id, &field, value, author.as_deref())
}

#[cfg(test)]
mod tests;
