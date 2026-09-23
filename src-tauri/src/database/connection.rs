//! Workspace database connection and path helpers.

use std::path::Path;
use rusqlite::{Connection, OpenFlags};

/// Returns the path to the workspace SQLite database file: `<workspace_path>/.nexsync/nexsync.db`
pub fn db_path(workspace_path: &Path) -> std::path::PathBuf {
	workspace_path.join(".nexsync").join("nexsync.db")
}

/// A connection scoped to a single workspace database
pub struct WorkspaceDb {
	pub conn: Connection,
}

impl WorkspaceDb {
	/// Opens or creates the workspace database, initializing schema if missing
	pub fn open(workspace_path: &str) -> Result<Self, String> {
		let workspace = std::path::Path::new(workspace_path);

		// Ensure the .nexsync metadata directory exists
		let meta_dir = workspace.join(".nexsync");
		std::fs::create_dir_all(&meta_dir).map_err(|e| e.to_string())?;

		let db_file = db_path(workspace);

		// Open connection with create flags
		let flags = OpenFlags::SQLITE_OPEN_READ_WRITE
			| OpenFlags::SQLITE_OPEN_CREATE
			| OpenFlags::SQLITE_OPEN_FULL_MUTEX;

		let conn =
			Connection::open_with_flags(&db_file, flags).map_err(|e| e.to_string())?;

		// Configure SQLite pragmas
		conn.execute_batch(
			"PRAGMA journal_mode = WAL;
			 PRAGMA foreign_keys = ON;
			 PRAGMA synchronous = NORMAL;
			 PRAGMA temp_store = MEMORY;
			 PRAGMA cache_size = -2000;",
		)
		.map_err(|e| e.to_string())?;

		let db = Self { conn };

		// Initialise tables if they don't exist yet
		crate::database::schema::init_schema(&db.conn).map_err(|e| e.to_string())?;

		Ok(db)
	}

	/// Opens an existing workspace database, failing if missing
	pub fn open_existing(workspace_path: &str) -> Result<Self, String> {
		let workspace = std::path::Path::new(workspace_path);
		let db_file = db_path(workspace);

		if !db_file.is_file() {
			return Err(format!("Workspace database not found at {}", db_file.display()));
		}

		let flags = OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_FULL_MUTEX;
		let conn = Connection::open_with_flags(&db_file, flags).map_err(|e| e.to_string())?;

		// Configure SQLite pragmas
		conn.execute_batch(
			"PRAGMA journal_mode = WAL;
			 PRAGMA foreign_keys = ON;
			 PRAGMA synchronous = NORMAL;
			 PRAGMA temp_store = MEMORY;
			 PRAGMA cache_size = -2000;",
		)
		.map_err(|e| e.to_string())?;

		let db = Self { conn };

		// Ensure schema is up to date
		crate::database::schema::init_schema(&db.conn).map_err(|e| e.to_string())?;

		Ok(db)
	}
}
