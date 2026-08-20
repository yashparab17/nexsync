//! Database layer for Nexsync.
//!
//! Each workspace owns a single SQLite database file at
//! `<workspace>/.nexsync/nexsync.db`.  All structured workspace data —
//! metadata, settings, members, permissions, activity, history, tasks,
//! kanban boards, and (eventually) Yjs binary states — lives in this file.
//!
//! The database directory (`src-tauri/src/database/`) provides:
//!
//! * [`connection`] — helpers to open / initialize a workspace DB connection.
//! * [`schema`] — `CREATE TABLE IF NOT EXISTS` definitions and a lightweight
//!   migration runner.

pub mod connection;
pub mod schema;

// Re-export the most common type so callers can write
// `use crate::database::WorkspaceDb` instead of reaching into sub-modules.
pub use connection::WorkspaceDb;
