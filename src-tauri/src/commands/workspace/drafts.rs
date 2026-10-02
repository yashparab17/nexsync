//! Drafts of a task or card: a copy of one record to change without touching the real one, then review and merge.
//!
//! This is the structured-data counterpart of a file branch. A draft starts from the record's merge state and has its
//! own replica id, so what is written in it is concurrent with whatever anyone changes in the real record meanwhile.
//! Merging it is therefore not a special operation: it is the same field-by-field merge used for a collaborator's copy.
//! Fields only one side changed take that side's value; a field both changed is kept as a conflict for the person to
//! choose. Because that is just a merge, the review can say what it will do before it is done: it merges on a copy of
//! the state, and reports the changes and the fields that will collide.
//!
//! A draft is private to this device. It reaches collaborators only when it is merged, as an ordinary edit.

use std::collections::BTreeSet;

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::crdt::{self, now_ms, Conflict, Crdt, RecordState};
use super::data_sync::{put_card, put_task_row, read_card, read_task, valid_card, valid_task};
use super::models::{KanbanCard, KanbanColumn, Task};

const MAX_NAME: usize = 80;
/// Drafts open at once; each merged draft also adds a replica to its record's merge state, which peers bound
const MAX_OPEN: i64 = 50;

/// A record kept as a task or a card
pub trait Stored: Crdt {
    fn read(conn: &Connection, id: &str) -> Result<Option<Self>, String>;
    fn put(conn: &Connection, workspace: &str, row: &Self) -> Result<(), String>;
    fn valid(&self) -> bool;
}

impl Stored for Task {
    fn read(conn: &Connection, id: &str) -> Result<Option<Self>, String> {
        read_task(conn, id)
    }
    fn put(conn: &Connection, workspace: &str, row: &Self) -> Result<(), String> {
        put_task_row(conn, workspace, row)
    }
    fn valid(&self) -> bool {
        valid_task(self)
    }
}

impl Stored for KanbanCard {
    fn read(conn: &Connection, id: &str) -> Result<Option<Self>, String> {
        read_card(conn, id)
    }
    fn put(conn: &Connection, workspace: &str, row: &Self) -> Result<(), String> {
        put_card(conn, workspace, row)
    }
    fn valid(&self) -> bool {
        valid_card(self)
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Draft {
    pub id: String,
    /// "task" or "card"
    pub entity: String,
    /// The record this is a draft of
    pub target: String,
    pub name: String,
    pub author: Option<String>,
    /// Milliseconds since 1970
    pub created_at: i64,
    /// "open" or "merged"
    pub status: String,
}

/// One field the merge would change in the real record
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Change {
    pub path: String,
    pub live: Option<Value>,
    pub draft: Option<Value>,
}

/// What merging a draft would do, worked out on a copy
#[derive(Serialize, Default, Debug)]
pub struct Preview {
    pub changes: Vec<Change>,
    /// Fields both the draft and someone else changed since it was started; the person will choose one after merging
    pub collisions: Vec<Conflict>,
    /// The real record was deleted, so there is nothing to merge into
    pub deleted: bool,
}

fn err(e: rusqlite::Error) -> String {
    e.to_string()
}

struct Loaded {
    draft: Draft,
    replica: String,
    state: RecordState,
}

fn load_draft(conn: &Connection, id: &str) -> Result<Loaded, String> {
    conn.query_row("SELECT id, entity, target, name, author, created_at, status, replica, state FROM drafts WHERE id = ?1", [id], |r| {
        Ok((
            Draft { id: r.get(0)?, entity: r.get(1)?, target: r.get(2)?, name: r.get(3)?, author: r.get(4)?, created_at: r.get(5)?, status: r.get(6)? },
            r.get::<_, String>(7)?,
            r.get::<_, String>(8)?,
        ))
    })
    .optional()
    .map_err(err)?
    .ok_or_else(|| "That draft no longer exists.".to_string())
    .and_then(|(draft, replica, state)| Ok(Loaded { draft, replica, state: serde_json::from_str(&state).map_err(|e| e.to_string())? }))
}

fn load_open(conn: &Connection, id: &str) -> Result<Loaded, String> {
    let loaded = load_draft(conn, id)?;
    if loaded.draft.status != "open" {
        return Err("That draft was already merged.".into());
    }
    Ok(loaded)
}

fn save_state(conn: &Connection, id: &str, state: &RecordState) -> Result<(), String> {
    let text = serde_json::to_string(state).map_err(|e| e.to_string())?;
    conn.execute("UPDATE drafts SET state = ?1 WHERE id = ?2", params![text, id]).map(|_| ()).map_err(err)
}

/// Starts a draft of the record as it stands now
pub fn start<T: Stored>(conn: &Connection, id: &str, name: &str, author: Option<&str>) -> Result<Draft, String> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > MAX_NAME {
        return Err(format!("Give the draft a name of up to {MAX_NAME} characters."));
    }
    let open: i64 = conn.query_row("SELECT COUNT(*) FROM drafts WHERE status = 'open' AND board IS NULL", [], |r| r.get(0)).map_err(err)?;
    if open >= MAX_OPEN {
        return Err("Too many drafts are open. Merge or discard some first.".into());
    }
    insert_draft::<T>(conn, id, name, author, None)
}

/// Starts a draft of the record as it stands now, optionally as part of a draft of the whole board
fn insert_draft<T: Stored>(conn: &Connection, id: &str, name: &str, author: Option<&str>, board: Option<&str>) -> Result<Draft, String> {
    let row = T::read(conn, id)?.ok_or("That record no longer exists.")?;
    crdt::ensure(conn, &row)?;
    let state = crdt::load(conn, T::ENTITY, id)?.ok_or("That record has no merge state.")?;
    let draft_id = uuid::Uuid::new_v4().simple().to_string()[..16].to_string();
    // The draft is a replica of its own, so its writes are concurrent with anything written to the record from now on
    let replica = format!("{}~{}", crdt::replica_id(conn)?, &draft_id[..6]);
    let draft = Draft { id: draft_id, entity: T::ENTITY.into(), target: id.into(), name: name.into(), author: author.map(str::to_string), created_at: now_ms() as i64, status: "open".into() };
    conn.execute(
        "INSERT INTO drafts (id, entity, target, name, author, created_at, replica, state, board) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![draft.id, draft.entity, draft.target, draft.name, draft.author, draft.created_at, replica, serde_json::to_string(&state).map_err(|e| e.to_string())?, board],
    )
    .map_err(err)?;
    Ok(draft)
}

/// The draft as a record: the real record's row with the draft's values on top
pub fn view<T: Stored>(conn: &Connection, draft_id: &str) -> Result<T, String> {
    let Loaded { draft, state, .. } = load_draft(conn, draft_id)?;
    let live = T::read(conn, &draft.target)?.ok_or("The record was deleted, so this draft can no longer be shown.")?;
    Ok(T::materialize(&live, &state.resolved()))
}

/// Saves the record as edited into the draft, writing only what changed in it
pub fn edit<T: Stored>(conn: &Connection, draft_id: &str, edited: &T, who: Option<&str>) -> Result<T, String> {
    let Loaded { draft, replica, mut state } = load_open(conn, draft_id)?;
    if edited.id() != draft.target || !edited.valid() {
        return Err("That is not a valid version of the record.".into());
    }
    state.diff_write_from(&replica, &edited.paths(false), None, now_ms(), who);
    state.sign_own(T::ENTITY, &draft.target, &replica);
    save_state(conn, draft_id, &state)?;
    view(conn, draft_id)
}

fn shown(v: Option<&Value>) -> Option<&Value> {
    v.filter(|v| !v.is_null())
}

/// What merging would do, on a copy: nothing is written
pub fn preview<T: Stored>(conn: &Connection, draft_id: &str) -> Result<Preview, String> {
    let Loaded { draft, state, .. } = load_open(conn, draft_id)?;
    let Some(live) = T::read(conn, &draft.target)? else { return Ok(Preview { deleted: true, ..Default::default() }) };
    crdt::ensure(conn, &live)?;
    let live_state = crdt::load(conn, T::ENTITY, &draft.target)?.ok_or("That record has no merge state.")?;
    let merged = live_state.merge(&state);
    let (before, after) = (live_state.resolved(), merged.resolved());
    let paths: BTreeSet<&String> = before.keys().chain(after.keys()).collect();
    let changes = paths
        .into_iter()
        .filter(|p| shown(before.get(*p)) != shown(after.get(*p)))
        .map(|p| Change { path: p.clone(), live: shown(before.get(p)).cloned(), draft: shown(after.get(p)).cloned() })
        .collect();
    // Fields already in conflict in the real record are not news
    let already: Vec<String> = live_state.conflicts().into_iter().map(|c| c.field).collect();
    let collisions = merged.conflicts().into_iter().filter(|c| !already.contains(&c.field)).collect();
    Ok(Preview { changes, collisions, deleted: false })
}

/// Merges the draft into the real record; returns the record as it now reads
pub fn merge<T: Stored>(conn: &Connection, workspace: &str, draft_id: &str) -> Result<T, String> {
    let tx = conn.unchecked_transaction().map_err(err)?;
    let row = merge_in::<T>(&tx, workspace, draft_id)?;
    tx.commit().map_err(err)?;
    Ok(row)
}

/// The merge itself, inside a transaction the caller owns, so several drafts can be merged together or not at all
fn merge_in<T: Stored>(tx: &Connection, workspace: &str, draft_id: &str) -> Result<T, String> {
    let Loaded { draft, state, .. } = load_open(tx, draft_id)?;
    let live = T::read(tx, &draft.target)?.ok_or("The record was deleted, so there is nothing to merge into.")?;
    crdt::ensure(tx, &live)?;
    let live_state = crdt::load(tx, T::ENTITY, &draft.target)?.ok_or("That record has no merge state.")?;
    let merged = live_state.merge(&state);
    let mut row = T::materialize(&live, &merged.resolved());
    row.set_updated_at(crdt::rfc3339_of(merged.max_ts()));
    if !row.valid() {
        return Err("The merged record would not be valid, so nothing was merged.".into());
    }
    crdt::save(tx, T::ENTITY, &draft.target, &merged)?;
    // The database refuses an assignee that is not a member, which a draft can hold if the member was removed since
    T::put(tx, workspace, &row).map_err(|e| {
        if e.contains("FOREIGN KEY") {
            "The assignee is no longer a member, so this draft cannot be merged. Change the assignee in the draft and try again.".to_string()
        } else {
            e
        }
    })?;
    tx.execute("UPDATE drafts SET status = 'merged' WHERE id = ?1", [draft_id]).map_err(err)?;
    Ok(row)
}

pub fn discard(conn: &Connection, draft_id: &str) -> Result<(), String> {
    conn.execute("DELETE FROM drafts WHERE id = ?1", [draft_id]).map(|_| ()).map_err(err)
}

/// Open drafts of one record, newest first
pub fn list(conn: &Connection, entity: &str, target: &str) -> Result<Vec<Draft>, String> {
    conn.prepare("SELECT id, entity, target, name, author, created_at, status FROM drafts WHERE entity = ?1 AND target = ?2 AND status = 'open' AND board IS NULL ORDER BY created_at DESC")
        .map_err(err)?
        .query_map(params![entity, target], |r| Ok(Draft { id: r.get(0)?, entity: r.get(1)?, target: r.get(2)?, name: r.get(3)?, author: r.get(4)?, created_at: r.get(5)?, status: r.get(6)? }))
        .map_err(err)?
        .collect::<Result<_, _>>()
        .map_err(err)
}

// ────────────────────────────
// Drafts of a whole board
// ────────────────────────────
//
// Reorganising a board touches many cards at once, and it is only worth trying out if it can be thrown away. A draft of
// the board is a named group of card drafts, each made the first time its card is moved, so a board of any size costs
// only what was moved. Merging the board merges every one of those drafts in a single transaction: all of the moves are
// made or none of them are, and each is the same field-by-field merge a lone card draft makes, so what other people
// changed meanwhile is kept. Like any draft it is private to this device until it is merged.

const MAX_BOARDS: i64 = 10;
const MAX_BOARD_CARDS: i64 = 500;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct BoardDraft {
    pub id: String,
    pub name: String,
    pub author: Option<String>,
    /// Milliseconds since 1970
    pub created_at: i64,
    /// "open" or "merged"
    pub status: String,
}

/// One card the board draft would change
#[derive(Serialize, Debug)]
pub struct CardReview {
    pub id: String,
    pub title: String,
    pub changes: Vec<Change>,
    pub collisions: Vec<Conflict>,
    /// The card was deleted meanwhile, so its part of the draft will be dropped
    pub deleted: bool,
}

#[derive(Serialize, Default, Debug)]
pub struct BoardPreview {
    pub cards: Vec<CardReview>,
}

fn load_board(conn: &Connection, id: &str) -> Result<BoardDraft, String> {
    conn.query_row("SELECT id, name, author, created_at, status FROM board_drafts WHERE id = ?1", [id], |r| {
        Ok(BoardDraft { id: r.get(0)?, name: r.get(1)?, author: r.get(2)?, created_at: r.get(3)?, status: r.get(4)? })
    })
    .optional()
    .map_err(err)?
    .ok_or_else(|| "That board draft no longer exists.".to_string())
}

fn open_board(conn: &Connection, id: &str) -> Result<BoardDraft, String> {
    let board = load_board(conn, id)?;
    if board.status != "open" {
        return Err("That board draft was already merged.".into());
    }
    Ok(board)
}

/// The card drafts of a board draft as (draft id, card id), oldest first
fn card_drafts(conn: &Connection, board_id: &str) -> Result<Vec<(String, String)>, String> {
    conn.prepare("SELECT id, target FROM drafts WHERE board = ?1 AND status = 'open' ORDER BY created_at, id")
        .map_err(err)?
        .query_map([board_id], |r| Ok((r.get(0)?, r.get(1)?)))
        .map_err(err)?
        .collect::<Result<_, _>>()
        .map_err(err)
}

pub fn start_board(conn: &Connection, name: &str, author: Option<&str>) -> Result<BoardDraft, String> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > MAX_NAME {
        return Err(format!("Give the draft a name of up to {MAX_NAME} characters."));
    }
    let open: i64 = conn.query_row("SELECT COUNT(*) FROM board_drafts WHERE status = 'open'", [], |r| r.get(0)).map_err(err)?;
    if open >= MAX_BOARDS {
        return Err("Too many board drafts are open. Merge or discard some first.".into());
    }
    let board = BoardDraft { id: uuid::Uuid::new_v4().simple().to_string()[..16].to_string(), name: name.into(), author: author.map(str::to_string), created_at: now_ms() as i64, status: "open".into() };
    conn.execute("INSERT INTO board_drafts (id, name, author, created_at) VALUES (?1, ?2, ?3, ?4)", params![board.id, board.name, board.author, board.created_at]).map_err(err)?;
    Ok(board)
}

pub fn list_boards(conn: &Connection) -> Result<Vec<BoardDraft>, String> {
    conn.prepare("SELECT id, name, author, created_at, status FROM board_drafts WHERE status = 'open' ORDER BY created_at DESC")
        .map_err(err)?
        .query_map([], |r| Ok(BoardDraft { id: r.get(0)?, name: r.get(1)?, author: r.get(2)?, created_at: r.get(3)?, status: r.get(4)? }))
        .map_err(err)?
        .collect::<Result<_, _>>()
        .map_err(err)
}

/// Puts a card in a list at a position, in the draft only
pub fn move_card(conn: &Connection, board_id: &str, card_id: &str, column_id: &str, position: f64, who: Option<&str>) -> Result<(), String> {
    let board = open_board(conn, board_id)?;
    if !position.is_finite() {
        return Err("That is not a valid position.".into());
    }
    let known: bool = conn.query_row("SELECT COUNT(*) > 0 FROM kanban_columns WHERE id = ?1", [column_id], |r| r.get(0)).map_err(err)?;
    if !known {
        return Err("That list no longer exists.".into());
    }
    let existing = conn.query_row("SELECT id FROM drafts WHERE board = ?1 AND target = ?2 AND status = 'open'", params![board_id, card_id], |r| r.get::<_, String>(0)).optional().map_err(err)?;
    let draft_id = match existing {
        Some(id) => id,
        None => {
            let held: i64 = conn.query_row("SELECT COUNT(*) FROM drafts WHERE board = ?1", [board_id], |r| r.get(0)).map_err(err)?;
            if held >= MAX_BOARD_CARDS {
                return Err("This draft already moves as many cards as one draft can hold.".into());
            }
            insert_draft::<KanbanCard>(conn, card_id, &board.name, board.author.as_deref(), Some(board_id))?.id
        }
    };
    let mut card = view::<KanbanCard>(conn, &draft_id)?;
    card.column_id = column_id.into();
    card.position = position;
    edit::<KanbanCard>(conn, &draft_id, &card, who).map(|_| ())
}

/// The board as the draft would leave it: the real board with the drafted cards where the draft puts them
pub fn board_view(conn: &Connection, workspace: &str, board_id: &str) -> Result<Vec<KanbanColumn>, String> {
    load_board(conn, board_id)?;
    let mut columns = super::kanban::read_columns(conn, workspace)?;
    let mut moved = std::collections::HashMap::new();
    for (draft_id, _) in card_drafts(conn, board_id)? {
        // A card deleted since cannot be shown
        if let Ok(card) = view::<KanbanCard>(conn, &draft_id) {
            moved.insert(card.id.clone(), card);
        }
    }
    let mut cards: Vec<KanbanCard> = columns.iter_mut().flat_map(|c| std::mem::take(&mut c.cards)).map(|c| moved.remove(&c.id).unwrap_or(c)).collect();
    cards.sort_by(|a, b| a.position.partial_cmp(&b.position).unwrap_or(std::cmp::Ordering::Equal).then_with(|| a.id.cmp(&b.id)));
    for card in cards {
        if let Some(column) = columns.iter_mut().find(|c| c.id == card.column_id) {
            column.cards.push(card);
        }
    }
    Ok(columns)
}

/// What merging the board draft would change, card by card; a card put back where it was is not listed
pub fn preview_board(conn: &Connection, board_id: &str) -> Result<BoardPreview, String> {
    open_board(conn, board_id)?;
    let mut cards = Vec::new();
    for (draft_id, target) in card_drafts(conn, board_id)? {
        let p = preview::<KanbanCard>(conn, &draft_id)?;
        if p.changes.is_empty() && p.collisions.is_empty() && !p.deleted {
            continue;
        }
        let title = read_card(conn, &target)?.map(|c| c.title).unwrap_or_default();
        cards.push(CardReview { id: target, title, changes: p.changes, collisions: p.collisions, deleted: p.deleted });
    }
    Ok(BoardPreview { cards })
}

/// Merges every card draft, all or none; returns the ids of the cards that were merged
pub fn merge_board(conn: &Connection, workspace: &str, board_id: &str) -> Result<Vec<String>, String> {
    let tx = conn.unchecked_transaction().map_err(err)?;
    open_board(&tx, board_id)?;
    let mut merged = Vec::new();
    for (draft_id, target) in card_drafts(&tx, board_id)? {
        if read_card(&tx, &target)?.is_none() {
            // Deleted meanwhile: nothing to merge into, so its part of the draft is dropped
            tx.execute("DELETE FROM drafts WHERE id = ?1", [&draft_id]).map_err(err)?;
            continue;
        }
        merge_in::<KanbanCard>(&tx, workspace, &draft_id)?;
        merged.push(target);
    }
    tx.execute("UPDATE board_drafts SET status = 'merged' WHERE id = ?1", [board_id]).map_err(err)?;
    tx.commit().map_err(err)?;
    Ok(merged)
}

pub fn discard_board(conn: &Connection, board_id: &str) -> Result<(), String> {
    let tx = conn.unchecked_transaction().map_err(err)?;
    tx.execute("DELETE FROM drafts WHERE board = ?1", [board_id]).map_err(err)?;
    tx.execute("DELETE FROM board_drafts WHERE id = ?1", [board_id]).map_err(err)?;
    tx.commit().map_err(err)
}

// ────────────────────────────
// Tauri commands
// ────────────────────────────

fn open(app_handle: &tauri::AppHandle, path: &str) -> Result<crate::database::WorkspaceDb, String> {
    super::data_sync::checked(app_handle, path)?;
    crate::database::WorkspaceDb::open_existing(path)
}

fn entity_of(conn: &Connection, draft_id: &str) -> Result<String, String> {
    Ok(load_draft(conn, draft_id)?.draft.entity)
}

fn to_value<T: Serialize>(row: &T) -> Result<Value, String> {
    serde_json::to_value(row).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_drafts(app_handle: tauri::AppHandle, path: String, entity: String, target: String) -> Result<Vec<Draft>, String> {
    list(&open(&app_handle, &path)?.conn, &entity, &target)
}

#[tauri::command]
pub fn start_draft(app_handle: tauri::AppHandle, path: String, entity: String, target: String, name: String, author: Option<String>) -> Result<Draft, String> {
    let db = open(&app_handle, &path)?;
    match entity.as_str() {
        "task" => start::<Task>(&db.conn, &target, &name, author.as_deref()),
        "card" => start::<KanbanCard>(&db.conn, &target, &name, author.as_deref()),
        _ => Err("Unknown kind of record.".into()),
    }
}

/// The draft as a task or card
#[tauri::command]
pub fn get_draft(app_handle: tauri::AppHandle, path: String, draft_id: String) -> Result<Value, String> {
    let db = open(&app_handle, &path)?;
    match entity_of(&db.conn, &draft_id)?.as_str() {
        "task" => to_value(&view::<Task>(&db.conn, &draft_id)?),
        _ => to_value(&view::<KanbanCard>(&db.conn, &draft_id)?),
    }
}

#[tauri::command]
pub fn save_draft(app_handle: tauri::AppHandle, path: String, draft_id: String, record: Value, author: Option<String>) -> Result<Value, String> {
    let db = open(&app_handle, &path)?;
    match entity_of(&db.conn, &draft_id)?.as_str() {
        "task" => {
            let edited: Task = serde_json::from_value(record).map_err(|e| e.to_string())?;
            to_value(&edit(&db.conn, &draft_id, &edited, author.as_deref())?)
        }
        _ => {
            let edited: KanbanCard = serde_json::from_value(record).map_err(|e| e.to_string())?;
            to_value(&edit(&db.conn, &draft_id, &edited, author.as_deref())?)
        }
    }
}

#[tauri::command]
pub fn preview_draft(app_handle: tauri::AppHandle, path: String, draft_id: String) -> Result<Preview, String> {
    let db = open(&app_handle, &path)?;
    match entity_of(&db.conn, &draft_id)?.as_str() {
        "task" => preview::<Task>(&db.conn, &draft_id),
        _ => preview::<KanbanCard>(&db.conn, &draft_id),
    }
}

/// Merges the draft; returns the record with the state other devices need to merge it
#[tauri::command]
pub fn merge_draft(app_handle: tauri::AppHandle, path: String, draft_id: String) -> Result<Value, String> {
    let db = open(&app_handle, &path)?;
    let workspace = super::helpers::get_workspace_id(&db)?;
    match entity_of(&db.conn, &draft_id)?.as_str() {
        "task" => {
            let row = merge::<Task>(&db.conn, &workspace, &draft_id)?;
            to_value(&super::data_sync::export_task(&path, &row.id)?)
        }
        _ => {
            let row = merge::<KanbanCard>(&db.conn, &workspace, &draft_id)?;
            to_value(&super::data_sync::export_card(&path, &row.id)?)
        }
    }
}

#[tauri::command]
pub fn discard_draft(app_handle: tauri::AppHandle, path: String, draft_id: String) -> Result<(), String> {
    discard(&open(&app_handle, &path)?.conn, &draft_id)
}

#[tauri::command]
pub fn list_board_drafts(app_handle: tauri::AppHandle, path: String) -> Result<Vec<BoardDraft>, String> {
    list_boards(&open(&app_handle, &path)?.conn)
}

#[tauri::command]
pub fn start_board_draft(app_handle: tauri::AppHandle, path: String, name: String, author: Option<String>) -> Result<BoardDraft, String> {
    start_board(&open(&app_handle, &path)?.conn, &name, author.as_deref())
}

/// The board as the draft would leave it
#[tauri::command]
pub fn get_board_draft(app_handle: tauri::AppHandle, path: String, board_id: String) -> Result<Vec<KanbanColumn>, String> {
    let db = open(&app_handle, &path)?;
    let workspace = super::helpers::get_workspace_id(&db)?;
    board_view(&db.conn, &workspace, &board_id)
}

#[tauri::command]
pub fn move_in_board_draft(app_handle: tauri::AppHandle, path: String, board_id: String, card_id: String, column_id: String, position: f64, author: Option<String>) -> Result<(), String> {
    move_card(&open(&app_handle, &path)?.conn, &board_id, &card_id, &column_id, position, author.as_deref())
}

#[tauri::command]
pub fn preview_board_draft(app_handle: tauri::AppHandle, path: String, board_id: String) -> Result<BoardPreview, String> {
    preview_board(&open(&app_handle, &path)?.conn, &board_id)
}

/// Merges the board draft; returns the ids of the cards that changed, so the caller can send each to collaborators
#[tauri::command]
pub fn merge_board_draft(app_handle: tauri::AppHandle, path: String, board_id: String) -> Result<Vec<String>, String> {
    let db = open(&app_handle, &path)?;
    let workspace = super::helpers::get_workspace_id(&db)?;
    merge_board(&db.conn, &workspace, &board_id)
}

#[tauri::command]
pub fn discard_board_draft(app_handle: tauri::AppHandle, path: String, board_id: String) -> Result<(), String> {
    discard_board(&open(&app_handle, &path)?.conn, &board_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        crate::database::schema::init_schema(&conn).unwrap();
        conn.execute("INSERT INTO workspace (id, name, description, path, created_at, updated_at) VALUES ('w', 'w', '', '/w', 't', 't')", []).unwrap();
        put_task_row(&conn, "w", &task()).unwrap();
        conn
    }

    fn task() -> Task {
        Task { id: "t1".into(), title: "Plan".into(), description: "Old".into(), status: "todo".into(), priority: "medium".into(), created_at: "2026-01-01T00:00:00Z".into(), updated_at: "2026-01-01T00:00:00Z".into(), ..Default::default() }
    }

    /// Someone changes the real record
    fn live_edit(conn: &Connection, who: &str, change: impl Fn(&mut Task)) {
        let mut row = read_task(conn, "t1").unwrap().unwrap();
        crdt::ensure(conn, &row).unwrap();
        let before = row.clone();
        change(&mut row);
        crdt::record_write(conn, &row, Some(who), Some(&before)).unwrap();
        put_task_row(conn, "w", &row).unwrap();
    }

    fn draft_edit(conn: &Connection, id: &str, who: &str, change: impl Fn(&mut Task)) {
        let mut row = view::<Task>(conn, id).unwrap();
        change(&mut row);
        edit(conn, id, &row, Some(who)).unwrap();
    }

    #[test]
    fn a_draft_changes_nothing_in_the_real_record_until_merged() {
        let c = db();
        let d = start::<Task>(&c, "t1", "Try a new plan", Some("Me")).unwrap();
        draft_edit(&c, &d.id, "Me", |t| t.title = "New plan".into());
        assert_eq!(read_task(&c, "t1").unwrap().unwrap().title, "Plan");
        assert_eq!(view::<Task>(&c, &d.id).unwrap().title, "New plan");
        assert_eq!(list(&c, "task", "t1").unwrap().len(), 1);
        merge::<Task>(&c, "w", &d.id).unwrap();
        assert_eq!(read_task(&c, "t1").unwrap().unwrap().title, "New plan");
        assert!(list(&c, "task", "t1").unwrap().is_empty());
    }

    #[test]
    fn the_review_says_what_will_change_and_which_fields_will_collide() {
        let c = db();
        let d = start::<Task>(&c, "t1", "Rework", None).unwrap();
        draft_edit(&c, &d.id, "Me", |t| {
            t.title = "Draft title".into();
            t.description = "Draft description".into();
        });
        // Meanwhile somebody else changes the title, and, separately, the priority
        live_edit(&c, "Ana", |t| {
            t.title = "Ana's title".into();
            t.priority = "high".into();
        });
        let p = preview::<Task>(&c, &d.id).unwrap();
        let paths: Vec<&str> = p.changes.iter().map(|c| c.path.as_str()).collect();
        assert!(paths.contains(&"description"));
        // The title is in dispute, so which value shows is a matter of timing; it is reported as a collision, not a change
        // Priority was changed only by the real record, so the draft does not touch it
        assert!(!paths.contains(&"priority"));
        assert_eq!(p.collisions.iter().map(|c| c.field.as_str()).collect::<Vec<_>>(), ["title"]);
        // Nothing was written by looking
        assert_eq!(read_task(&c, "t1").unwrap().unwrap().description, "Old");

        // Merging keeps both sides' separate changes and the colliding field as a conflict to choose from
        merge::<Task>(&c, "w", &d.id).unwrap();
        let row = read_task(&c, "t1").unwrap().unwrap();
        assert_eq!((row.description.as_str(), row.priority.as_str()), ("Draft description", "high"));
        let state = crdt::load(&c, "task", "t1").unwrap().unwrap();
        let conflict = state.conflicts().into_iter().find(|c| c.field == "title").expect("title is a conflict");
        let mut values: Vec<String> = conflict.options.iter().map(|o| o.value.as_str().unwrap().to_string()).collect();
        values.sort();
        assert_eq!(values, ["Ana's title", "Draft title"]);
    }

    #[test]
    fn drafts_merge_in_either_order_to_the_same_record() {
        let c = db();
        let a = start::<Task>(&c, "t1", "A", None).unwrap();
        let b = start::<Task>(&c, "t1", "B", None).unwrap();
        draft_edit(&c, &a.id, "Me", |t| {
            t.title = "From A".into();
            t.priority = "high".into();
        });
        draft_edit(&c, &b.id, "Me", |t| {
            t.title = "From B".into();
            t.description = "From B".into();
        });

        // The same starting state with the two drafts applied in each order
        let live = crdt::load(&c, "task", "t1").unwrap().unwrap();
        let (state_a, state_b) = (load_draft(&c, &a.id).unwrap().state, load_draft(&c, &b.id).unwrap().state);
        let a_then_b = live.merge(&state_a).merge(&state_b);
        assert_eq!(a_then_b, live.merge(&state_b).merge(&state_a));

        // What merging them through the app does is that same result, with the colliding title kept for someone to choose
        merge::<Task>(&c, "w", &a.id).unwrap();
        merge::<Task>(&c, "w", &b.id).unwrap();
        let merged = crdt::load(&c, "task", "t1").unwrap().unwrap();
        assert_eq!(merged, a_then_b);
        assert_eq!(merged.conflicts().iter().map(|c| c.field.as_str()).collect::<Vec<_>>(), ["title"]);
        let row = read_task(&c, "t1").unwrap().unwrap();
        assert_eq!((row.priority.as_str(), row.description.as_str()), ("high", "From B"));
    }

    #[test]
    fn nothing_is_merged_into_a_deleted_record_or_twice_and_input_is_checked() {
        let c = db();
        let d = start::<Task>(&c, "t1", "Rework", None).unwrap();
        draft_edit(&c, &d.id, "Me", |t| t.title = "New".into());

        let mut empty = view::<Task>(&c, &d.id).unwrap();
        empty.title.clear();
        assert!(edit(&c, &d.id, &empty, None).is_err());
        let mut other = view::<Task>(&c, &d.id).unwrap();
        other.id = "t2".into();
        assert!(edit(&c, &d.id, &other, None).is_err());
        assert!(start::<Task>(&c, "t1", "   ", None).is_err());
        assert!(start::<Task>(&c, "t1", &"x".repeat(MAX_NAME + 1), None).is_err());
        assert!(start::<Task>(&c, "missing", "Name", None).is_err());

        merge::<Task>(&c, "w", &d.id).unwrap();
        assert!(merge::<Task>(&c, "w", &d.id).is_err(), "a draft merges once");
        assert!(edit(&c, &d.id, &view::<Task>(&c, &d.id).unwrap(), None).is_err(), "and cannot be edited after");

        let gone = start::<Task>(&c, "t1", "Again", None).unwrap();
        c.execute("DELETE FROM tasks WHERE id = 't1'", []).unwrap();
        assert!(preview::<Task>(&c, &gone.id).unwrap().deleted);
        assert!(merge::<Task>(&c, "w", &gone.id).is_err());
        discard(&c, &gone.id).unwrap();
        assert!(load_draft(&c, &gone.id).is_err());
    }

    #[test]
    fn a_draft_assigned_to_a_removed_member_says_so_instead_of_failing_obscurely() {
        let c = db();
        c.execute("INSERT INTO members (id, workspace_id, name, role) VALUES ('sam', 'w', 'Sam', 'Editor')", []).unwrap();
        let d = start::<Task>(&c, "t1", "Give to Sam", None).unwrap();
        draft_edit(&c, &d.id, "Me", |t| t.assignee_id = Some("sam".into()));
        c.execute("DELETE FROM members WHERE id = 'sam'", []).unwrap();
        let message = merge::<Task>(&c, "w", &d.id).unwrap_err();
        assert!(message.contains("no longer a member"), "{message}");
        // Nothing was merged, and the draft is still there to fix
        assert!(read_task(&c, "t1").unwrap().unwrap().assignee_id.is_none());
        assert_eq!(list(&c, "task", "t1").unwrap().len(), 1);
    }

    #[test]
    fn the_number_of_open_drafts_is_limited() {
        let c = db();
        for i in 0..MAX_OPEN {
            start::<Task>(&c, "t1", &format!("Draft {i}"), None).unwrap();
        }
        assert!(start::<Task>(&c, "t1", "One too many", None).is_err());
    }

    // A board with two lists and three cards in the first
    fn board_db() -> Connection {
        let c = db();
        for (id, title, position) in [("c1", "Todo", 0), ("c2", "Doing", 1)] {
            c.execute("INSERT INTO kanban_columns (id, workspace_id, title, position, created_at, updated_at) VALUES (?1, 'w', ?2, ?3, 't', 't')", params![id, title, position]).unwrap();
        }
        for (i, id) in ["k1", "k2", "k3"].iter().enumerate() {
            let card = KanbanCard { id: id.to_string(), title: format!("Card {id}"), column_id: "c1".into(), position: i as f64, created_at: "2026-01-01T00:00:00Z".into(), updated_at: "2026-01-01T00:00:00Z".into(), ..Default::default() };
            put_card(&c, "w", &card).unwrap();
        }
        c
    }

    fn ids(columns: &[KanbanColumn], column: &str) -> Vec<String> {
        columns.iter().find(|c| c.id == column).unwrap().cards.iter().map(|c| c.id.clone()).collect()
    }

    fn live_board(c: &Connection) -> Vec<KanbanColumn> {
        super::super::kanban::read_columns(c, "w").unwrap()
    }

    #[test]
    fn a_board_draft_moves_cards_without_touching_the_board_until_merged() {
        let c = board_db();
        let b = start_board(&c, "Reorganise", Some("Me")).unwrap();
        move_card(&c, &b.id, "k1", "c2", 0.0, Some("Me")).unwrap();
        move_card(&c, &b.id, "k3", "c1", -1.0, Some("Me")).unwrap();

        let shown = board_view(&c, "w", &b.id).unwrap();
        assert_eq!((ids(&shown, "c1"), ids(&shown, "c2")), (vec!["k3".to_string(), "k2".to_string()], vec!["k1".to_string()]));
        // The real board is as it was, and the card drafts of a board do not show up as drafts of the card
        assert_eq!(ids(&live_board(&c), "c1"), ["k1", "k2", "k3"]);
        assert!(list(&c, "card", "k1").unwrap().is_empty());

        let mut merged = merge_board(&c, "w", &b.id).unwrap();
        merged.sort();
        assert_eq!(merged, ["k1", "k3"]);
        let after = live_board(&c);
        assert_eq!((ids(&after, "c1"), ids(&after, "c2")), (vec!["k3".to_string(), "k2".to_string()], vec!["k1".to_string()]));
        assert!(list_boards(&c).unwrap().is_empty());
        assert!(merge_board(&c, "w", &b.id).is_err(), "a board draft merges once");
    }

    #[test]
    fn merging_a_board_keeps_what_others_changed_meanwhile_and_drops_cards_deleted_meanwhile() {
        let c = board_db();
        let b = start_board(&c, "Try", None).unwrap();
        move_card(&c, &b.id, "k1", "c2", 0.0, None).unwrap();
        move_card(&c, &b.id, "k2", "c2", 1.0, None).unwrap();

        // Meanwhile someone retitles k1 and someone deletes k2
        let mut row = read_card(&c, "k1").unwrap().unwrap();
        crdt::ensure(&c, &row).unwrap();
        let before = row.clone();
        row.title = "Renamed".into();
        crdt::record_write(&c, &row, Some("Ana"), Some(&before)).unwrap();
        put_card(&c, "w", &row).unwrap();
        c.execute("DELETE FROM kanban_cards WHERE id = 'k2'", []).unwrap();

        let review = preview_board(&c, &b.id).unwrap();
        assert!(review.cards.iter().any(|r| r.id == "k2" && r.deleted));
        assert!(review.cards.iter().any(|r| r.id == "k1" && r.changes.iter().any(|c| c.path == "column_id")));

        let merged = merge_board(&c, "w", &b.id).unwrap();
        assert_eq!(merged, ["k1"]);
        let k1 = read_card(&c, "k1").unwrap().unwrap();
        assert_eq!((k1.title.as_str(), k1.column_id.as_str()), ("Renamed", "c2"));
        assert!(read_card(&c, "k2").unwrap().is_none());
    }

    #[test]
    fn a_board_draft_can_be_thrown_away_and_checks_its_input() {
        let c = board_db();
        let b = start_board(&c, "Idea", None).unwrap();
        move_card(&c, &b.id, "k1", "c2", 0.0, None).unwrap();
        assert!(move_card(&c, &b.id, "k1", "nowhere", 0.0, None).is_err());
        assert!(move_card(&c, &b.id, "k1", "c2", f64::NAN, None).is_err());
        assert!(move_card(&c, &b.id, "missing", "c2", 0.0, None).is_err());
        assert!(start_board(&c, "  ", None).is_err());

        discard_board(&c, &b.id).unwrap();
        assert!(list_boards(&c).unwrap().is_empty());
        assert!(board_view(&c, "w", &b.id).is_err());
        assert_eq!(ids(&live_board(&c), "c1"), ["k1", "k2", "k3"]);

        for i in 0..MAX_BOARDS {
            start_board(&c, &format!("Board {i}"), None).unwrap();
        }
        assert!(start_board(&c, "One too many", None).is_err());
    }

    #[test]
    fn a_card_put_back_where_it_was_is_not_part_of_the_review() {
        let c = board_db();
        let b = start_board(&c, "Undo", None).unwrap();
        move_card(&c, &b.id, "k1", "c2", 0.0, None).unwrap();
        move_card(&c, &b.id, "k1", "c1", 0.0, None).unwrap();
        assert!(preview_board(&c, &b.id).unwrap().cards.is_empty());
    }
}
