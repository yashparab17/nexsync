//! Database layer for Nexsync.
//!
//! Each workspace owns a single SQLite database file at
//! `<workspace>/.nexsync/nexsync.db`. All structured workspace data lives in this file.

pub mod connection;
pub mod schema;

// Re-export WorkspaceDb connection wrapper
pub use connection::WorkspaceDb;
