//! SQLite schema definitions and migration runner.

use rusqlite::Connection;
use rusqlite::Result as SqlResult;

/// Current schema version.
#[allow(dead_code)]
pub const SCHEMA_VERSION: usize = 1;

/// Database migration entry
struct Migration {
	version: usize,
	description: &'static str,
	up: &'static str,
}

/// Migration catalog
const MIGRATIONS: &[Migration] = &[Migration {
	version: 1,
	description: "initial schema",
	up: r##"
CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    description TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS workspace (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    path        TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
    workspace_id TEXT PRIMARY KEY REFERENCES workspace(id) ON DELETE CASCADE,
    theme        TEXT NOT NULL DEFAULT 'dark',
    autosave     INTEGER NOT NULL DEFAULT 1,
    sync         INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS members (
    id          TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    role        TEXT NOT NULL,
    UNIQUE(workspace_id, name)
);

CREATE TABLE IF NOT EXISTS permissions (
    workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    role         TEXT NOT NULL,
    permission   TEXT NOT NULL,
    PRIMARY KEY (workspace_id, role, permission)
);

CREATE TABLE IF NOT EXISTS activity_events (
    id           TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    timestamp    TEXT NOT NULL,
    action       TEXT NOT NULL,
    detail       TEXT NOT NULL,
    target       TEXT,
    target_type  TEXT
);

CREATE TABLE IF NOT EXISTS history (
    workspace_id  TEXT PRIMARY KEY REFERENCES workspace(id) ON DELETE CASCADE,
    last_opened   TEXT NOT NULL,
    recent_files  TEXT NOT NULL DEFAULT '[]'
);

-- Tasks (feature-scoped structured data)
CREATE TABLE IF NOT EXISTS tasks (
    id           TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    title        TEXT NOT NULL,
    description  TEXT NOT NULL DEFAULT '',
    status       TEXT NOT NULL DEFAULT 'todo',
    priority     TEXT NOT NULL DEFAULT 'medium',
    due_date     TEXT,
    assignee_id  TEXT REFERENCES members(id) ON DELETE SET NULL,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tags (
    id           TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    color        TEXT NOT NULL DEFAULT '#6b7280',
    UNIQUE(workspace_id, name)
);

CREATE TABLE IF NOT EXISTS task_tags (
    task_id     TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    tag_id      TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (task_id, tag_id)
);

-- Kanban board
CREATE TABLE IF NOT EXISTS kanban_columns (
    id           TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    title        TEXT NOT NULL,
    position     INTEGER NOT NULL,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS kanban_cards (
    id           TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    column_id    TEXT NOT NULL REFERENCES kanban_columns(id) ON DELETE CASCADE,
    title        TEXT NOT NULL,
    description  TEXT NOT NULL DEFAULT '',
    position     INTEGER NOT NULL,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS kanban_card_tags (
    card_id TEXT NOT NULL REFERENCES kanban_cards(id) ON DELETE CASCADE,
    tag_id  TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (card_id, tag_id)
);

-- Yjs binary state snapshots
CREATE TABLE IF NOT EXISTS yjs_documents (
    workspace_id  TEXT PRIMARY KEY REFERENCES workspace(id) ON DELETE CASCADE,
    doc_id        TEXT NOT NULL,
    binary_state  BLOB NOT NULL,
    updated_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tasks_workspace   ON tasks(workspace_id);
CREATE INDEX IF NOT EXISTS idx_tasks_due_date    ON tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee    ON tasks(assignee_id);
CREATE INDEX IF NOT EXISTS idx_columns_workspace ON kanban_columns(workspace_id);
CREATE INDEX IF NOT EXISTS idx_cards_column      ON kanban_cards(column_id);
CREATE INDEX IF NOT EXISTS idx_cards_workspace   ON kanban_cards(workspace_id);
CREATE INDEX IF NOT EXISTS idx_activity_workspace ON activity_events(workspace_id);
CREATE INDEX IF NOT EXISTS idx_activity_ts        ON activity_events(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_members_workspace  ON members(workspace_id);
"##,
}];

/// Initialises the schema on a fresh database, running pending migrations
pub fn init_schema(conn: &Connection) -> SqlResult<()> {
	let tx = conn.unchecked_transaction()?;

	// Apply initial schema DDL
	tx.execute_batch(MIGRATIONS[0].up)?;

	// Record applied migrations idempotently
	for mig in MIGRATIONS {
		tx.execute(
			"INSERT OR IGNORE INTO schema_migrations (version, description) VALUES (?1, ?2)",
			rusqlite::params![mig.version, mig.description],
		)?;
	}

	tx.commit()?;
	Ok(())
}

/// Returns the current schema version recorded in the database
#[allow(dead_code)]
pub fn current_version(conn: &Connection) -> SqlResult<usize> {
	let result: SqlResult<i64> = conn.query_row(
		"SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1",
		[],
		|r| r.get(0),
	);

	match result {
		Ok(v) => Ok(v as usize),
		Err(rusqlite::Error::QueryReturnedNoRows) => Ok(0),
		Err(e) => Err(e),
	}
}
