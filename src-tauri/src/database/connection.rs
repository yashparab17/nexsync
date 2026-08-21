//! Workspace database connection and path helpers.
//!
//! All workspace structured data lives in a single SQLite file at
//! `<workspace_path>/.nexsync/nexsync.db`.  The [`WorkspaceDb`] type is a
//! thin wrapper around `rusqlite::Connection` that is created per-command
//! invocation.  Because Tauri commands run on a thread-pool we open a fresh
//! connection each time — SQLite's WAL mode makes this cheap and safe.

use std::path::Path;

use rusqlite::{Connection, OpenFlags};

/// Returns the path to the workspace SQLite database file:
/// `<workspace_path>/.nexsync/nexsync.db`
pub fn db_path(workspace_path: &Path) -> std::path::PathBuf {
	workspace_path.join(".nexsync").join("nexsync.db")
}

/// A connection scoped to a single workspace database.
///
/// The connection is configured with:
/// * `journal_mode = WAL` — concurrent reads while a write is in progress.
/// * `foreign_keys = ON` — enforce referential integrity.
/// * `synchronous = NORMAL` — good durability / performance trade-off.
///
/// After construction the schema is guaranteed to exist (created via
/// `CREATE TABLE IF NOT EXISTS` in [`crate::database::schema::init_schema`]).
#[allow(dead_code)]
pub struct WorkspaceDb {
	pub conn: Connection,
	/// Absolute path to the workspace root directory.
	pub workspace_path: std::path::PathBuf,
}

impl WorkspaceDb {
	/// Opens (or creates) the workspace database at the given path.
	///
	/// If the `.nexsync` directory or `nexsync.db` does not yet exist the
	/// directory is created and the database is initialised with the full
	/// schema.
	pub fn open(workspace_path: &str) -> Result<Self, String> {
		let workspace = std::path::Path::new(workspace_path);

		// Ensure the `.nexsync` directory exists.
		let meta_dir = workspace.join(".nexsync");
		std::fs::create_dir_all(&meta_dir).map_err(|e| e.to_string())?;

		let db_file = db_path(workspace);

		// Use read/write create flags so the file is created if missing.
		let flags = OpenFlags::SQLITE_OPEN_READ_WRITE
			| OpenFlags::SQLITE_OPEN_CREATE
			| OpenFlags::SQLITE_OPEN_FULL_MUTEX;

		let conn =
			Connection::open_with_flags(&db_file, flags).map_err(|e| e.to_string())?;

		// Pragmas — apply once on every open.
		conn.execute_batch(
			"PRAGMA journal_mode = WAL;
			 PRAGMA foreign_keys = ON;
			 PRAGMA synchronous = NORMAL;",
		)
		.map_err(|e| e.to_string())?;

		let db = Self {
			conn,
			workspace_path: workspace.to_path_buf(),
		};

		// Initialise tables if they don't exist yet.
		crate::database::schema::init_schema(&db.conn).map_err(|e| e.to_string())?;

		Ok(db)
	}

	/// Opens an existing workspace database without creating missing files or directories.
	/// Fails if the database file does not already exist.
	pub fn open_existing(workspace_path: &str) -> Result<Self, String> {
		let workspace = std::path::Path::new(workspace_path);
		let db_file = db_path(workspace);

		if !db_file.is_file() {
			return Err(format!("Workspace database not found at {}", db_file.display()));
		}

		let flags = OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_FULL_MUTEX;
		let conn = Connection::open_with_flags(&db_file, flags).map_err(|e| e.to_string())?;

		conn.execute_batch(
			"PRAGMA journal_mode = WAL;
			 PRAGMA foreign_keys = ON;
			 PRAGMA synchronous = NORMAL;",
		)
		.map_err(|e| e.to_string())?;

		let db = Self {
			conn,
			workspace_path: workspace.to_path_buf(),
		};

		// Ensure schema is up to date
		crate::database::schema::init_schema(&db.conn).map_err(|e| e.to_string())?;

		Ok(db)
	}
}
