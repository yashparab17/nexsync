//! A signed, append-only log shared by chat and comments, and the notification inbox that is built from it.
//!
//! A chat message, a comment on a note, a reply, an edit, a deletion, a reaction, a channel and a resolved thread are all
//! entries in one table. Nothing is ever changed in place: an edit is a new entry that points at the one it replaces, and
//! what a person sees is worked out from the entries (in `src/lib/chat`). Entries are grow-only, so merging two copies is
//! a union and every device ends with the same set whatever order they arrive in.
//!
//! Each entry is signed with its author's device key over everything in it, so any device can pass one on and any device
//! can check it. Who may write is decided from the signed member list: the author's key must belong to someone who is
//! allowed to post (a Viewer is not), only Admins and the Owner may create channels, and only the author or an Admin may
//! delete an entry. This is the role check on the signing key that RESEARCH.md §8j found missing for task and card writes.
//!
//! The inbox is local only. It records mentions and replies when an entry arrives, and notices the app itself adds.

use std::collections::HashSet;

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::commands::workspace::signing;

/// The longest text of one entry, in characters
pub const MAX_BODY: usize = 20_000;
/// How far past this device's clock an entry may be stamped, in milliseconds; a later stamp would sort after everything
pub const MAX_AHEAD_MS: u64 = 24 * 60 * 60 * 1000;
/// Entries listed to the app at most
pub const LIST_LIMIT: i64 = 20_000;
/// Most entries sent to a device that is catching up, newest first; an older gap is not filled
pub const CATCH_UP_LIMIT: usize = 1_000;
/// Messages and comments per channel a device hands to one that lacks them, unless its person chose another number
pub const HISTORY_DEFAULT: usize = 200;
/// Most ids a device names when it asks for what it is missing
pub const HAVE_LIMIT: usize = 20_000;

const KINDS: &[&str] = &["message", "edit", "delete", "react", "unreact", "channel", "comment", "resolve", "reopen", "dm", "icon", "profile", "devenv", "devrun", "devrepro", super::announce::KIND, super::announce::END, super::announce::ACK, super::announce::EXPIRE, super::moderation::KIND];

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub id: String,
    pub kind: String,
    /// "general", another channel, or a comment thread: "doc:<path>", "task:<id>", "card:<id>"
    pub channel: String,
    /// The entry this one answers, edits, deletes, reacts to or resolves; empty when it is a new message or comment
    #[serde(default)]
    pub parent: String,
    /// The author's device key
    pub author: String,
    /// The name the author used when writing it
    pub name: String,
    pub ts: u64,
    /// The text, or JSON for a comment (its text and where it is anchored)
    pub body: String,
    pub sig: String,
}

impl Entry {
    /// The bytes that are signed. The prefix keeps a signature made for this from being valid for anything else.
    fn payload(&self) -> Vec<u8> {
        format!("nexsync log v1\n{}\n{}\n{}\n{}\n{}\n{}\n{}\n{}", self.id, self.kind, self.channel, self.parent, self.author, self.name, self.ts, self.body).into_bytes()
    }

    /// Whether the signature is the author's over exactly this entry
    pub fn signature_ok(&self) -> bool {
        signing::verify_bytes(&self.author, &self.sig, &self.payload())
    }

    /// An entry signed with a given key; the app signs with the device key (`post`), tests with others
    #[cfg(test)]
    pub(crate) fn signed_with(key: &iroh::SecretKey, kind: &str, channel: &str, parent: &str, body: &str, ts: u64) -> Entry {
        let mut e = Entry { id: uuid::Uuid::new_v4().to_string(), kind: kind.into(), channel: channel.into(), parent: parent.into(), author: key.public().to_string(), name: "Tester".into(), ts, body: body.into(), sig: String::new() };
        e.sig = signing::to_hex(&key.sign(&e.payload()).to_bytes());
        e
    }
}

/// What a device is allowed to do, lowest first
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Role {
    Viewer,
    Commenter,
    Editor,
    Admin,
    Owner,
}

impl Role {
    pub fn parse(text: &str) -> Option<Role> {
        match text {
            "Viewer" => Some(Role::Viewer),
            "Commenter" => Some(Role::Commenter),
            "Editor" => Some(Role::Editor),
            "Admin" => Some(Role::Admin),
            "Owner" => Some(Role::Owner),
            _ => None,
        }
    }
}

/// What the receiving device knows when it checks an entry
pub struct Ctx<'a> {
    /// This device's key, so mentions and replies to it can be found
    pub me: &'a str,
    pub now: u64,
    /// The role of a device key in the signed member list, or `None` for a key that is not a member
    pub role_of: &'a dyn Fn(&str) -> Option<Role>,
}

/// The result of merging a batch
#[derive(Debug, Default)]
pub struct Merged {
    /// Entries that were new here, in the order they were stored
    pub added: Vec<Entry>,
    pub refused: usize,
}

fn err(e: rusqlite::Error) -> String {
    e.to_string()
}

/// A mention is written as `<@device key>` so it names exactly one device whatever the display names are
pub fn mention_of(key: &str) -> String {
    format!("<@{key}>")
}

/// The words of an entry, for a snippet: the text of a comment's JSON, or the plain body, with mentions shortened
pub fn plain_text(body: &str) -> String {
    let text = serde_json::from_str::<serde_json::Value>(body).ok().and_then(|v| v.get("text").and_then(|t| t.as_str()).map(str::to_string)).unwrap_or_else(|| body.to_string());
    let mut out = String::new();
    let mut rest = text.as_str();
    while let Some(i) = rest.find("<@") {
        out.push_str(&rest[..i]);
        match rest[i..].find('>') {
            Some(j) => {
                out.push('@');
                rest = &rest[i + j + 1..];
            }
            None => {
                rest = &rest[i..];
                break;
            }
        }
    }
    out.push_str(rest);
    out.chars().take(140).collect()
}

fn find(conn: &Connection, id: &str) -> Result<Option<Entry>, String> {
    conn.query_row("SELECT id, kind, channel, parent, author, name, ts, body, sig FROM log_entries WHERE id = ?1", [id], row_to_entry).optional().map_err(err)
}

fn row_to_entry(r: &rusqlite::Row) -> rusqlite::Result<Entry> {
    Ok(Entry { id: r.get(0)?, kind: r.get(1)?, channel: r.get(2)?, parent: r.get(3)?, author: r.get(4)?, name: r.get(5)?, ts: r.get::<_, i64>(6)? as u64, body: r.get(7)?, sig: r.get(8)? })
}

/// Why an entry cannot be taken, or `None` when it can. `conn` is read to look up what it points at.
fn refusal(conn: &Connection, e: &Entry, ctx: &Ctx) -> Result<Option<&'static str>, String> {
    if !KINDS.contains(&e.kind.as_str()) {
        return Ok(Some("unknown kind"));
    }
    if e.id.is_empty() || e.id.len() > 64 || e.channel.is_empty() || e.channel.chars().count() > 300 || e.name.chars().count() > 80 || e.body.chars().count() > MAX_BODY {
        return Ok(Some("too large or empty"));
    }
    if e.ts > ctx.now.saturating_add(MAX_AHEAD_MS) {
        return Ok(Some("stamped more than a day ahead"));
    }
    if !e.signature_ok() {
        return Ok(Some("signature does not match"));
    }
    let Some(role) = (ctx.role_of)(&e.author) else { return Ok(Some("author is not a member")) };
    // A Viewer may only say "Got it" to an announcement, and set how they look to the others (colour and picture)
    if role < Role::Commenter && e.kind != super::announce::ACK && e.kind != "profile" {
        return Ok(Some("a Viewer cannot write"));
    }
    if super::announce::is_expired_target(conn, e, ctx.now) {
        return Ok(Some("the announcement it is about has expired"));
    }
    match e.kind.as_str() {
        // Announcements (announce.rs): posted, edited and withdrawn by the Owner and Admins; anyone acknowledges
        "announce" => {
            if role < Role::Admin {
                return Ok(Some("only Admins and the Owner post announcements"));
            }
            let Some(body) = super::announce::parse(&e.body) else { return Ok(Some("not an announcement")) };
            if let Err(why) = super::announce::valid(&body) {
                return Ok(Some(why));
            }
            if (body.system && role != Role::Owner) || e.channel != super::announce::CHANNEL {
                return Ok(Some("not a valid announcement"));
            }
            if e.parent.is_empty() {
                return Ok(None);
            }
            match find(conn, &e.parent)? {
                Some(t) if t.kind == super::announce::KIND && t.parent.is_empty() && (t.author == e.author || role == Role::Owner) => Ok(None),
                Some(_) => Ok(Some("only the author or the Owner edits an announcement")),
                None => Ok(Some("the announcement it edits is not here")),
            }
        }
        "announce_end" | "ack" => {
            if e.kind == super::announce::END && role < Role::Admin {
                return Ok(Some("only Admins and the Owner withdraw announcements"));
            }
            match find(conn, &e.parent)? {
                Some(t) if t.kind == super::announce::KIND && t.parent.is_empty() => Ok(None),
                _ => Ok(Some("the announcement it is about is not here")),
            }
        }
        "expire" => {
            if role < Role::Admin {
                return Ok(Some("only Admins and the Owner set an expiry"));
            }
            Ok(super::announce::expiry_of(&e.body).is_none().then_some("not an expiry"))
        }
        "channel" if role < Role::Admin => Ok(Some("only Admins make channels")),
        // The workspace's icon, set by the Owner or an Admin (the newest wins): a picture or an emoji, small enough for one entry
        "icon" => {
            if role < Role::Admin {
                return Ok(Some("only Admins and the Owner set the icon"));
            }
            let ok = serde_json::from_str::<serde_json::Value>(&e.body).ok().is_some_and(|v| match v.get("kind").and_then(|k| k.as_str()) {
                Some("image") => v.get("data").and_then(|d| d.as_str()).is_some_and(|d| d.starts_with("data:image/")),
                Some("glyph") => v.get("glyph").and_then(|g| g.as_str()).is_some_and(|g| (1..=2).contains(&g.chars().count())),
                Some("letter") => true,
                Some("none") => true,
                _ => false,
            });
            if !ok || e.channel != "workspace" {
                return Ok(Some("not a valid icon"));
            }
            let newer: bool = conn.query_row("SELECT COUNT(*) > 0 FROM log_entries WHERE kind = 'icon' AND ts > ?1", [e.ts as i64], |r| r.get(0)).map_err(err)?;
            Ok(newer.then_some("a newer icon is already set"))
        }
        // How a member looks to the others: a colour and a small picture, both optional; the newest of each author wins
        "profile" => {
            let ok = serde_json::from_str::<serde_json::Value>(&e.body).ok().is_some_and(|v| {
                v.is_object()
                    && v.get("color").is_none_or(|c| c.as_str().is_some_and(|c| c.len() == 7 && c.starts_with('#') && c[1..].chars().all(|h| h.is_ascii_hexdigit())))
                    && v.get("image").is_none_or(|d| d.as_str().is_some_and(|d| d.starts_with("data:image/")))
            });
            if !ok || e.channel != "profiles" {
                return Ok(Some("not a valid profile"));
            }
            let newer: bool = conn.query_row("SELECT COUNT(*) > 0 FROM log_entries WHERE kind = 'profile' AND author = ?1 AND ts > ?2", params![e.author, e.ts as i64], |r| r.get(0)).map_err(err)?;
            Ok(newer.then_some("a newer profile is already set"))
        }
        // What a member chose to share about a project on their device: the tools it has (`devenv`) or what it is running (`devrun`).
        // The channel names the kind and the project; the newest entry of each author and channel wins.
        "devenv" | "devrun" => {
            let prefix = if e.kind == "devenv" { "devenv:" } else { "devrun:" };
            let ok = e.channel.starts_with(prefix) && e.channel.len() <= 120 && e.body.len() <= 4_000 && serde_json::from_str::<serde_json::Value>(&e.body).is_ok_and(|v| v.is_object());
            if !ok {
                return Ok(Some("not a valid project status"));
            }
            let newer: bool = conn.query_row("SELECT COUNT(*) > 0 FROM log_entries WHERE kind = ?1 AND channel = ?2 AND author = ?3 AND ts > ?4", params![e.kind, e.channel, e.author, e.ts as i64], |r| r.get(0)).map_err(err)?;
            Ok(newer.then_some("a newer status is already set"))
        }
        // A failure a member shared so others can see it (the task, its output, the tools on that device); kept, not replaced
        "devrepro" => {
            let ok = e.channel.starts_with("devrepro:") && e.channel.len() <= 120 && serde_json::from_str::<serde_json::Value>(&e.body).is_ok_and(|v| v.is_object());
            Ok((!ok).then_some("not a valid shared failure"))
        }
        // A direct message names a member it is for; the words are sealed (dm.rs) and cannot be checked here
        "dm" => match super::dm::recipient(&e.body) {
            Some(to) if (ctx.role_of)(&to).is_some() && e.channel == super::dm::channel_of(&e.author, &to) => Ok(None),
            _ => Ok(Some("a direct message must name a member and its own conversation")),
        },
        // A moderation act is checked for who does it and to whom (see moderation.rs)
        "moderation" => match super::moderation::parse(&e.body) {
            Some(a) => Ok(super::moderation::allowed(role, (ctx.role_of)(&a.target), &a, e.ts).err()),
            None => Ok(Some("not a moderation act")),
        },
        // Slow mode: an Editor or below waits between messages. ponytail: checked against the entries held now, so a message
        // that arrives out of order can slip through; the sender's own device always checks in order.
        "message" if role < Role::Admin => {
            let wait = slow_seconds(conn, &e.channel)? * 1000;
            if wait == 0 {
                return Ok(None);
            }
            let last: Option<i64> = conn
                .query_row("SELECT MAX(ts) FROM log_entries WHERE kind = 'message' AND channel = ?1 AND author = ?2 AND ts < ?3", params![e.channel, e.author, e.ts as i64], |r| r.get(0))
                .map_err(err)?;
            Ok(last.filter(|t| e.ts < (*t as u64).saturating_add(wait)).map(|_| "slow mode: wait a little before sending again"))
        }
        "message" | "comment" | "react" | "unreact" | "resolve" | "reopen" | "channel" => Ok(None),
        // An edit changes only the author's own entry; a deletion is the author's or an Admin's
        "edit" | "delete" => {
            let Some(target) = find(conn, &e.parent)? else { return Ok(Some("the entry it points at is not here")) };
            let own = target.author == e.author;
            if e.kind == "edit" && !own {
                Ok(Some("only the author may edit"))
            } else if e.kind == "delete" && !own && role < Role::Admin {
                Ok(Some("only the author or an Admin may delete"))
            } else {
                Ok(None)
            }
        }
        _ => Ok(Some("unknown kind")),
    }
}

/// Stores one entry that has already been checked. Returns whether it was new.
fn store(conn: &Connection, e: &Entry) -> Result<bool, String> {
    let n = conn
        .execute(
            "INSERT OR IGNORE INTO log_entries (id, kind, channel, parent, author, name, ts, body, sig) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![e.id, e.kind, e.channel, e.parent, e.author, e.name, e.ts as i64, e.body, e.sig],
        )
        .map_err(err)?;
    if n > 0 && matches!(e.kind.as_str(), "icon" | "profile") {
        // What a newer one replaces is not kept: the icon of the workspace, and the profile of each author
        conn.execute("DELETE FROM log_entries WHERE kind = ?1 AND id != ?2 AND ts <= ?3 AND (?1 = 'icon' OR author = ?4)", params![e.kind, e.id, e.ts as i64, e.author]).map_err(err)?;
    }
    if n > 0 && matches!(e.kind.as_str(), "devenv" | "devrun") {
        conn.execute("DELETE FROM log_entries WHERE kind = ?1 AND channel = ?2 AND author = ?3 AND id != ?4 AND ts <= ?5", params![e.kind, e.channel, e.author, e.id, e.ts as i64]).map_err(err)?;
    }
    if n > 0 {
        conn.execute("INSERT OR IGNORE INTO log_seen (id, at) VALUES (?1, ?2)", params![e.id, crate::commands::workspace::crdt::now_ms() as i64]).map_err(err)?;
    }
    Ok(n > 0)
}

/// When this device first held each entry, by id. Entries it held before this was recorded are left out.
pub fn seen(conn: &Connection) -> Result<std::collections::HashMap<String, u64>, String> {
    let mut stmt = conn.prepare("SELECT id, at FROM log_seen").map_err(err)?;
    let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)? as u64))).map_err(err)?;
    rows.collect::<Result<_, _>>().map_err(err)
}

/// Seconds an author must wait between messages in a channel, set by its newest "channel" entry (`slowSeconds`); 0 when none
fn slow_seconds(conn: &Connection, channel: &str) -> Result<u64, String> {
    let body: Option<String> = conn
        .query_row("SELECT body FROM log_entries WHERE kind = 'channel' AND channel = ?1 ORDER BY ts DESC, id DESC LIMIT 1", [channel], |r| r.get(0))
        .optional()
        .map_err(err)?;
    Ok(body.and_then(|b| serde_json::from_str::<serde_json::Value>(&b).ok()).and_then(|v| v.get("slowSeconds").and_then(|s| s.as_u64())).unwrap_or(0).min(21_600))
}

/// Writes an inbox line for a mention of this device, or a reply to its entry, when an entry from someone else arrives
fn note_for_me(conn: &Connection, e: &Entry, me: &str) -> Result<(), String> {
    // Being timed out, kicked, banned or let back in is told to the one it is about
    if e.kind == super::moderation::KIND {
        if let Some(a) = super::moderation::parse(&e.body) {
            if a.target == me && matches!(a.action.as_str(), "timeout" | "untimeout" | "kick" | "ban" | "unban") {
                let detail = serde_json::json!({ "until": a.until, "reason": a.reason }).to_string();
                return inbox_add(conn, "moderation", &e.id, &a.action, &e.name, &detail, e.ts);
            }
        }
        return Ok(());
    }
    // A direct message for this device: told by who, never by what (the words are sealed)
    if e.kind == "dm" {
        if e.author != me && super::dm::recipient(&e.body).as_deref() == Some(me) {
            return inbox_add(conn, "dm", &e.id, &e.channel, &e.name, "", e.ts);
        }
        return Ok(());
    }
    if e.author == me || !matches!(e.kind.as_str(), "message" | "comment") {
        return Ok(());
    }
    let kind = if e.body.contains(&mention_of(me)) {
        "mention"
    } else if !e.parent.is_empty() && find(conn, &e.parent)?.is_some_and(|p| p.author == me) {
        "reply"
    } else {
        return Ok(());
    };
    inbox_add(conn, kind, &e.id, &e.channel, &e.name, &plain_text(&e.body), e.ts)
}

/// Takes the entries of a batch that pass every check, in the order given (so an entry comes after the one it points at)
pub fn merge(conn: &Connection, entries: Vec<Entry>, ctx: &Ctx) -> Result<Merged, String> {
    let mut out = Merged::default();
    for e in entries {
        if find(conn, &e.id)?.is_some() {
            continue;
        }
        if let Some(why) = refusal(conn, &e, ctx)? {
            eprintln!("[log] Refused an entry from {}: {why}", e.author.chars().take(8).collect::<String>());
            out.refused += 1;
            continue;
        }
        if store(conn, &e)? {
            note_for_me(conn, &e, ctx.me)?;
            out.added.push(e);
        }
    }
    Ok(out)
}

#[allow(clippy::too_many_arguments)]
/// Writes an entry of this device: builds it, signs it with the device key and stores it. The caller sends it on.
pub fn post(conn: &Connection, kind: &str, channel: &str, parent: &str, body: &str, name: &str, now: u64, role_of: &dyn Fn(&str) -> Option<Role>) -> Result<Entry, String> {
    let Some(me) = signing::device_key() else { return Err("This device has no key yet.".into()) };
    // Messages are ordered by their time, and two devices' clocks differ: a message written after another was read must not be placed before it
    // because this clock is a little behind. So it is stamped after the newest entry of the channel this device holds, as far as the clock
    // limit for entries allows.
    let newest: Option<i64> = conn.query_row("SELECT MAX(ts) FROM log_entries WHERE channel = ?1", [channel], |r| r.get(0)).map_err(err)?;
    let ts = newest.map_or(now, |n| now.max(u64::try_from(n).unwrap_or(0).saturating_add(1))).min(now.saturating_add(MAX_AHEAD_MS));
    let mut e = Entry { id: uuid::Uuid::new_v4().to_string(), kind: kind.into(), channel: channel.into(), parent: parent.into(), author: me.clone(), name: name.trim().to_string(), ts, body: body.into(), sig: String::new() };
    let Some((_, sig)) = signing::sign_bytes(&e.payload()) else { return Err("This device has no key yet.".into()) };
    e.sig = sig;
    let ctx = Ctx { me: &me, now, role_of };
    match refusal(conn, &e, &ctx)? {
        Some(why) => Err(format!("That cannot be posted: {why}.")),
        None => {
            store(conn, &e)?;
            Ok(e)
        }
    }
}

/// Every entry, oldest first, up to the limit (the newest ones when there are more)
pub fn list(conn: &Connection) -> Result<Vec<Entry>, String> {
    let mut stmt = conn
        .prepare("SELECT id, kind, channel, parent, author, name, ts, body, sig FROM log_entries WHERE kind IN ('profile', 'icon') OR id IN (SELECT id FROM log_entries ORDER BY ts DESC, id DESC LIMIT ?1) ORDER BY ts ASC, id ASC")
        .map_err(err)?;
    let rows = stmt.query_map([LIST_LIMIT], row_to_entry).map_err(err)?;
    rows.collect::<rusqlite::Result<Vec<_>>>().map_err(err)
}

/// Every entry of one kind, oldest first
pub fn list_kind(conn: &Connection, kind: &str) -> Result<Vec<Entry>, String> {
    let mut stmt = conn.prepare("SELECT id, kind, channel, parent, author, name, ts, body, sig FROM log_entries WHERE kind = ?1 ORDER BY ts ASC, id ASC").map_err(err)?;
    let rows = stmt.query_map([kind], row_to_entry).map_err(err)?;
    rows.collect::<rusqlite::Result<Vec<_>>>().map_err(err)
}

/// The ids this device holds, newest first, for asking a peer what it is missing
pub fn have(conn: &Connection) -> Result<Vec<String>, String> {
    let mut stmt = conn.prepare("SELECT id FROM log_entries ORDER BY ts DESC, id DESC LIMIT ?1").map_err(err)?;
    let rows = stmt.query_map([HAVE_LIMIT as i64], |r| r.get::<_, String>(0)).map_err(err)?;
    rows.collect::<rusqlite::Result<Vec<_>>>().map_err(err)
}

/// What this device has that the peer named no id for: the newest ones first, up to the catch-up limit, oldest first
pub fn missing(conn: &Connection, they_have: &HashSet<String>) -> Result<Vec<Entry>, String> {
    let per_channel = history_limit(conn)?;
    let mut stmt = conn
        .prepare("SELECT id, kind, channel, parent, author, name, ts, body, sig FROM log_entries ORDER BY ts DESC, id DESC")
        .map_err(err)?;
    let rows = stmt.query_map([], row_to_entry).map_err(err)?;
    let lacking: Vec<Entry> = rows.collect::<Result<Vec<_>, _>>().map_err(err)?.into_iter().filter(|e| !they_have.contains(&e.id)).collect();
    // The newest messages and comments of each channel, up to the limit; whatever points at one that was left out goes with it
    let mut counts: std::collections::HashMap<&str, usize> = std::collections::HashMap::new();
    let mut kept: HashSet<&str> = HashSet::new();
    for e in &lacking {
        if matches!(e.kind.as_str(), "message" | "comment") {
            let n = counts.entry(e.channel.as_str()).or_insert(0);
            if *n < per_channel {
                *n += 1;
                kept.insert(e.id.as_str());
            }
        }
    }
    let mut out: Vec<Entry> = Vec::new();
    // How people look (one small entry each) and the workspace icon always go, however old: a busy workspace would otherwise push them
    // past the limit and a new device would never learn anyone's picture
    out.extend(lacking.iter().filter(|e| matches!(e.kind.as_str(), "profile" | "icon")).cloned());
    for e in &lacking {
        let wanted = match e.kind.as_str() {
            "profile" | "icon" => false,
            "message" | "comment" => kept.contains(e.id.as_str()),
            "edit" | "delete" | "react" | "unreact" | "resolve" | "reopen" => e.parent.is_empty() || kept.contains(e.parent.as_str()) || they_have.contains(&e.parent),
            _ => true,
        };
        if wanted {
            out.push(e.clone());
            if out.len() >= CATCH_UP_LIMIT + 64 {
                break;
            }
        }
    }
    out.reverse();
    Ok(out)
}

/// How many messages and comments per channel this device gives to a device that lacks them
pub fn history_limit(conn: &Connection) -> Result<usize, String> {
    let v: Option<String> = conn.query_row("SELECT value FROM log_settings WHERE key = 'history'", [], |r| r.get(0)).optional().map_err(err)?;
    Ok(v.and_then(|v| v.parse::<usize>().ok()).unwrap_or(HISTORY_DEFAULT).clamp(10, 100_000))
}

pub fn set_history_limit(conn: &Connection, n: usize) -> Result<(), String> {
    conn.execute("INSERT INTO log_settings (key, value) VALUES ('history', ?1) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [n.clamp(10, 100_000).to_string()]).map(|_| ()).map_err(err)
}

/// Removes every entry of a thread or channel, and what the inbox says about them. Used when a file, task or card is
/// erased for good, so comments on it do not outlive it. A channel ending in `/` also takes everything under it.
pub fn erase_channel(conn: &Connection, channel: &str) -> Result<usize, String> {
    let (exact, prefix) = (channel.to_string(), format!("{}/%", channel.trim_end_matches('/')));
    conn.execute("DELETE FROM inbox WHERE reference IN (SELECT id FROM log_entries WHERE channel = ?1 OR channel LIKE ?2)", params![exact, prefix]).map_err(err)?;
    conn.execute("DELETE FROM log_entries WHERE channel = ?1 OR channel LIKE ?2", params![exact, prefix]).map_err(err)
}

// ────────────────────────────
// Read markers
// ────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadState {
    pub channel: String,
    pub last_ts: u64,
    pub muted: bool,
}

pub fn read_states(conn: &Connection) -> Result<Vec<ReadState>, String> {
    let mut stmt = conn.prepare("SELECT channel, last_ts, muted FROM log_read").map_err(err)?;
    let rows = stmt.query_map([], |r| Ok(ReadState { channel: r.get(0)?, last_ts: r.get::<_, i64>(1)? as u64, muted: r.get::<_, i64>(2)? != 0 })).map_err(err)?;
    rows.collect::<rusqlite::Result<Vec<_>>>().map_err(err)
}

/// Marks a channel read up to `ts`; a marker never moves back
pub fn mark_read(conn: &Connection, channel: &str, ts: u64) -> Result<(), String> {
    conn.execute(
        "INSERT INTO log_read (channel, last_ts) VALUES (?1, ?2) ON CONFLICT(channel) DO UPDATE SET last_ts = MAX(last_ts, excluded.last_ts)",
        params![channel, ts as i64],
    )
    .map(|_| ())
    .map_err(err)
}

pub fn set_muted(conn: &Connection, channel: &str, muted: bool) -> Result<(), String> {
    conn.execute("INSERT INTO log_read (channel, muted) VALUES (?1, ?2) ON CONFLICT(channel) DO UPDATE SET muted = excluded.muted", params![channel, i64::from(muted)])
        .map(|_| ())
        .map_err(err)
}

// ────────────────────────────
// Inbox
// ────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InboxItem {
    pub id: i64,
    /// "mention", "reply", or a notice the app wrote ("joined", "assigned", "due", "notice")
    pub kind: String,
    /// The entry it is about, when it is about one
    pub reference: String,
    pub channel: String,
    pub author: String,
    pub snippet: String,
    pub at: u64,
    pub read: bool,
}

/// The most items kept; the oldest go first
const INBOX_KEEP: i64 = 300;

pub fn inbox_add(conn: &Connection, kind: &str, reference: &str, channel: &str, author: &str, snippet: &str, at: u64) -> Result<(), String> {
    conn.execute(
        "INSERT OR IGNORE INTO inbox (kind, reference, channel, author, snippet, at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![kind, reference, channel, author, snippet, at as i64],
    )
    .map_err(err)?;
    conn.execute("DELETE FROM inbox WHERE id NOT IN (SELECT id FROM inbox ORDER BY at DESC, id DESC LIMIT ?1)", [INBOX_KEEP]).map(|_| ()).map_err(err)
}

pub fn inbox_list(conn: &Connection) -> Result<Vec<InboxItem>, String> {
    let mut stmt = conn.prepare("SELECT id, kind, reference, channel, author, snippet, at, read FROM inbox ORDER BY at DESC, id DESC").map_err(err)?;
    let rows = stmt
        .query_map([], |r| Ok(InboxItem { id: r.get(0)?, kind: r.get(1)?, reference: r.get(2)?, channel: r.get(3)?, author: r.get(4)?, snippet: r.get(5)?, at: r.get::<_, i64>(6)? as u64, read: r.get::<_, i64>(7)? != 0 }))
        .map_err(err)?;
    rows.collect::<rusqlite::Result<Vec<_>>>().map_err(err)
}

/// Marks the given items read, or every item when `ids` is empty
pub fn inbox_mark_read(conn: &Connection, ids: &[i64]) -> Result<(), String> {
    if ids.is_empty() {
        return conn.execute("UPDATE inbox SET read = 1 WHERE read = 0", []).map(|_| ()).map_err(err);
    }
    for id in ids {
        conn.execute("UPDATE inbox SET read = 1 WHERE id = ?1", [id]).map_err(err)?;
    }
    Ok(())
}

pub fn inbox_clear(conn: &Connection) -> Result<(), String> {
    conn.execute("DELETE FROM inbox", []).map(|_| ()).map_err(err)
}

#[cfg(test)]
mod tests;
