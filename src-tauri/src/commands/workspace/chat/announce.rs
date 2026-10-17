//! Announcements, acknowledgements and expiry.
//!
//! An announcement is a one-to-many notice from the Owner or an Admin. Like chat it is an entry of the signed log
//! (`chatlog.rs`), so it is signed by whoever posted it, passes through any linked device, and is checked on every device
//! against the signed member list: only the Owner and Admins may post, edit or withdraw one. Four kinds of entry carry it:
//!
//! - `announce`: a new announcement (no parent) or a new version of one (the parent is the first entry of it);
//! - `announce_end`: withdraws an announcement, which then shows as withdrawn;
//! - `ack`: a member's "Got it", which any member may send, a Viewer included;
//! - `expire`: from the Owner or an Admin, says that an announcement, task, card or file is to be erased for good at a time.
//!
//! The time of a scheduled post (`notBefore`) and of an expiry is read from each device's own corrected clock
//! (`crdt::now_ms`, RESEARCH.md §8h): a device whose clock is wrong shows or erases early or late, and a copy that arrived
//! before its time is already on the disk of the devices that got it.

use std::collections::HashSet;

use rusqlite::Connection;
use serde::{Deserialize, Serialize};

use super::chatlog::{self, Entry};
use crate::commands::workspace::erase;
use crate::commands::workspace::helpers::get_workspace_id;
use crate::commands::config::validate_allowed_root;
use crate::database::WorkspaceDb;

pub const KIND: &str = "announce";
pub const END: &str = "announce_end";
pub const ACK: &str = "ack";
pub const EXPIRE: &str = "expire";
/// Every announcement entry lives in this channel; its comments are in `announcement:<id>`
pub const CHANNEL: &str = "announcements";

pub const MAX_TITLE: usize = 120;
pub const MAX_TEXT: usize = 5_000;
const LEVELS: &[&str] = &["info", "important", "urgent"];

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Audience {
    /// Roles it is for ("Admin", "Editor", "Commenter", "Viewer"); empty for everyone, unless members are named
    #[serde(default)]
    pub roles: Vec<String>,
    /// Device keys it is for
    #[serde(default)]
    pub members: Vec<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Body {
    pub title: String,
    /// Markdown
    #[serde(default)]
    pub text: String,
    /// "info", "important" or "urgent"
    #[serde(default)]
    pub level: String,
    /// When it ends and moves to the archive; 0 for never
    #[serde(default)]
    pub ends: u64,
    /// The earliest moment it shows; 0 for at once
    #[serde(default)]
    pub not_before: u64,
    #[serde(default)]
    pub pinned: bool,
    /// Written by the app (an ownership change), not by a person
    #[serde(default)]
    pub system: bool,
    #[serde(default)]
    pub audience: Audience,
}

pub fn parse(body: &str) -> Option<Body> {
    serde_json::from_str(body).ok()
}

/// Whether the body is a well-formed announcement
pub fn valid(b: &Body) -> Result<(), &'static str> {
    if b.title.trim().is_empty() || b.title.chars().count() > MAX_TITLE {
        return Err("an announcement needs a title of up to 120 characters");
    }
    if b.text.chars().count() > MAX_TEXT {
        return Err("the text is too long");
    }
    if !LEVELS.contains(&b.level.as_str()) {
        return Err("the level must be info, important or urgent");
    }
    if b.audience.members.len() > 64 || b.audience.roles.len() > 4 {
        return Err("the audience is too large");
    }
    Ok(())
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct Expiry {
    /// "announcement", "task", "card" or "file"
    pub entity: String,
    /// The announcement's id, the record's id, or the file's path
    pub id: String,
    /// When it is erased, in milliseconds since 1970; 0 cancels an earlier expiry
    pub at: u64,
}

pub fn expiry_of(body: &str) -> Option<Expiry> {
    let e: Expiry = serde_json::from_str(body).ok()?;
    (matches!(e.entity.as_str(), "announcement" | "task" | "card" | "file") && !e.id.is_empty() && e.id.len() <= 300).then_some(e)
}

/// The expiries in force: for each target the newest entry says, and one that says 0 cancels
pub fn current_expiries(conn: &Connection) -> Vec<Expiry> {
    let mut newest: std::collections::HashMap<(String, String), Expiry> = std::collections::HashMap::new();
    for e in chatlog::list_kind(conn, EXPIRE).unwrap_or_default() {
        if let Some(x) = expiry_of(&e.body) {
            newest.insert((x.entity.clone(), x.id.clone()), x);
        }
    }
    newest.into_values().filter(|x| x.at > 0).collect()
}

/// Ids of announcements whose expiry has passed
pub fn expired_announcements(conn: &Connection, now: u64) -> HashSet<String> {
    current_expiries(conn).into_iter().filter(|x| x.entity == "announcement" && x.at <= now).map(|x| x.id).collect()
}

/// Erases what the expiry entries say is due. Returns how many things were erased. Safe to run again and again: what is
/// already gone is skipped, and the expiry entries stay, so a copy that arrives later from a device that was off is
/// refused or erased in turn.
pub fn sweep(db: &WorkspaceDb, workspace: &str, now: u64) -> Result<usize, String> {
    let ws_id = get_workspace_id(db)?;
    let mut count = 0;
    let due: Vec<Expiry> = current_expiries(&db.conn).into_iter().filter(|x| x.at <= now).collect();
    for x in due {
        match x.entity.as_str() {
            "announcement" => {
                let n = erase_announcement(&db.conn, &x.id)?;
                count += usize::from(n > 0);
            }
            "task" | "card" => {
                let table = if x.entity == "task" { "tasks" } else { "kanban_cards" };
                let there: bool = db.conn.query_row(&format!("SELECT COUNT(*) > 0 FROM {table} WHERE id = ?1"), [&x.id], |r| r.get(0)).map_err(|e| e.to_string())?;
                if there {
                    erase::erase_record(&db.conn, &ws_id, &x.entity, &x.id)?;
                    count += 1;
                }
            }
            "file" => {
                let on_disk = crate::commands::path_utils::resolve_workspace_path(workspace, x.id.trim_matches('/')).map(|p| p.exists()).unwrap_or(false);
                if on_disk {
                    erase::erase_file(db, workspace, &x.id, &[])?;
                    count += 1;
                }
            }
            _ => {}
        }
    }
    Ok(count)
}

/// Removes an announcement and everything that points at it (versions, withdrawals, acknowledgements, reactions, comments)
pub fn erase_announcement(conn: &Connection, id: &str) -> Result<usize, String> {
    let ids: Vec<String> = {
        let mut stmt = conn.prepare("SELECT id FROM log_entries WHERE id = ?1 OR parent = ?1").map_err(|e| e.to_string())?;
        let rows = stmt.query_map([id], |r| r.get::<_, String>(0)).map_err(|e| e.to_string())?;
        rows.collect::<Result<_, _>>().map_err(|e| e.to_string())?
    };
    let mut n = 0;
    for entry in &ids {
        conn.execute("DELETE FROM inbox WHERE reference = ?1", [entry]).map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM log_seen WHERE id = ?1", [entry]).ok();
        n += conn.execute("DELETE FROM log_entries WHERE id = ?1", [entry]).map_err(|e| e.to_string())?;
    }
    n += chatlog::erase_channel(conn, &format!("announcement:{id}"))?;
    Ok(n)
}

/// An entry that points at an announcement whose expiry has passed is not taken
pub fn is_expired_target(conn: &Connection, e: &Entry, now: u64) -> bool {
    let target = if e.kind == KIND && e.parent.is_empty() { e.id.as_str() } else { e.parent.as_str() };
    !target.is_empty() && matches!(e.kind.as_str(), KIND | END | ACK) && expired_announcements(conn, now).contains(target)
}

#[tauri::command]
pub fn expiry_sweep(app: tauri::AppHandle, path: String) -> Result<usize, String> {
    validate_allowed_root(&app, &path)?;
    let db = WorkspaceDb::open_existing(&path)?;
    sweep(&db, &path, crate::commands::workspace::crdt::now_ms())
}

/// Entries of kind `ack`, by author (the app reads these from the log itself; kept for the tests)
#[cfg(test)]
pub fn acks_of(conn: &Connection, id: &str) -> Result<Vec<(String, u64)>, String> {
    let mut stmt = conn.prepare("SELECT author, MIN(ts) FROM log_entries WHERE kind = 'ack' AND parent = ?1 GROUP BY author").map_err(|e| e.to_string())?;
    let rows = stmt.query_map(rusqlite::params![id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)? as u64))).map_err(|e| e.to_string())?;
    rows.collect::<Result<_, _>>().map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::params;

    #[test]
    fn a_body_needs_a_title_a_level_and_a_sane_audience() {
        let ok = Body { title: "Release on Friday".into(), level: "important".into(), ..Default::default() };
        assert!(valid(&ok).is_ok());
        assert!(valid(&Body { title: " ".into(), ..ok.clone() }).is_err());
        assert!(valid(&Body { level: "shout".into(), ..ok.clone() }).is_err());
        assert!(valid(&Body { text: "x".repeat(MAX_TEXT + 1), ..ok.clone() }).is_err());
        assert!(parse(r#"{"title":"t","level":"info","notBefore":5,"audience":{"roles":["Editor"]}}"#).is_some_and(|b| b.not_before == 5 && b.audience.roles == ["Editor"]));
        assert!(parse("not json").is_none());
    }

    #[test]
    fn the_newest_expiry_of_a_target_wins_and_zero_cancels_it() {
        use crate::commands::workspace::chat::chatlog::Entry;
        let conn = Connection::open_in_memory().unwrap();
        crate::database::schema::init_schema(&conn).unwrap();
        let key = iroh::SecretKey::from_bytes(&[2; 32]);
        let put = |id: &str, at: u64, ts: u64| {
            let e = Entry::signed_with(&key, EXPIRE, CHANNEL, "", &serde_json::json!({ "entity": "task", "id": id, "at": at }).to_string(), ts);
            conn.execute("INSERT INTO log_entries (id, kind, channel, parent, author, name, ts, body, sig) VALUES (?1, ?2, ?3, '', ?4, ?5, ?6, ?7, ?8)", params![e.id, e.kind, e.channel, e.author, e.name, e.ts as i64, e.body, e.sig]).unwrap();
        };
        put("a", 900, 1);
        put("a", 5_000, 2);
        put("b", 900, 1);
        put("b", 0, 2);
        let now = current_expiries(&conn);
        assert_eq!(now.len(), 1);
        assert_eq!((now[0].id.as_str(), now[0].at), ("a", 5_000));
    }

    #[test]
    fn a_task_and_a_note_whose_expiry_has_passed_are_erased_and_one_still_to_come_is_left() {
        use crate::commands::workspace::{chat::chatlog::Entry, data_sync, models::Task};
        let dir = std::env::temp_dir().join(format!("nexsync-expiry-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(dir.join("notes")).unwrap();
        let path = dir.to_str().unwrap();
        let db = WorkspaceDb::open(path).unwrap();
        db.conn.execute("INSERT INTO workspace (id, name, description, path, created_at, updated_at) VALUES ('w1', 'w', '', ?1, 't', 't')", [path]).unwrap();
        for id in ["due", "later"] {
            let task = Task { id: id.into(), title: id.into(), status: "todo".into(), priority: "medium".into(), created_at: "2026-01-01T00:00:00Z".into(), updated_at: "2026-01-01T00:00:00Z".into(), ..Default::default() };
            data_sync::put_task_row(&db.conn, "w1", &task).unwrap();
        }
        std::fs::write(dir.join("notes/old.md"), "secret").unwrap();
        let key = iroh::SecretKey::from_bytes(&[2; 32]);
        let put = |entity: &str, id: &str, at: u64, ts: u64| {
            let e = Entry::signed_with(&key, EXPIRE, CHANNEL, "", &serde_json::json!({ "entity": entity, "id": id, "at": at }).to_string(), ts);
            db.conn.execute("INSERT INTO log_entries (id, kind, channel, parent, author, name, ts, body, sig) VALUES (?1, ?2, ?3, '', ?4, ?5, ?6, ?7, ?8)", params![e.id, e.kind, e.channel, e.author, e.name, e.ts as i64, e.body, e.sig]).unwrap();
        };
        put("task", "due", 1_000, 1);
        put("task", "later", 9_000, 2);
        put("file", "notes/old.md", 1_000, 3);
        assert_eq!(sweep(&db, path, 5_000).unwrap(), 2);
        assert!(data_sync::read_task(&db.conn, "due").unwrap().is_none());
        assert!(data_sync::read_task(&db.conn, "later").unwrap().is_some());
        assert!(!dir.join("notes/old.md").exists());
        // Running it again changes nothing, and the erased task is marked so devices that were away erase it too
        assert_eq!(sweep(&db, path, 5_000).unwrap(), 0);
        let erased: i64 = db.conn.query_row("SELECT COUNT(*) FROM tombstones WHERE id = 'due' AND erased = 1", [], |r| r.get(0)).unwrap();
        assert_eq!(erased, 1);
        drop(db);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn an_expiry_names_a_kind_a_target_and_a_time() {
        assert_eq!(expiry_of(r#"{"entity":"task","id":"t1","at":9}"#), Some(Expiry { entity: "task".into(), id: "t1".into(), at: 9 }));
        assert!(expiry_of(r#"{"entity":"user","id":"t1","at":9}"#).is_none());
        assert!(expiry_of(r#"{"entity":"file","id":"","at":9}"#).is_none());
    }
}
