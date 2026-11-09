//! Per-field merging for tasks and cards, with conflicts that are kept and shown instead of silently lost.
//!
//! A record is a flat map from a path ("title", "tags/urgent", "comments/<id>", "checklist/<id>/done") to a
//! multi-value register. Each write gets a dot (replica id, counter) and the record carries one version vector
//! saying which writes it has seen. Merging two copies of a record keeps, for every path, the writes the other copy
//! has not already seen and overwritten, so two people changing different fields never lose an edit, and two
//! people changing the same field keep both values until one of them chooses.
//!
//! How a path with several surviving values is shown depends on what it is:
//! - a set member (a tag, a comment, a checklist item): present wins over removed, so concurrent adds all survive;
//! - a field a person would want to be told about (title, status, assignee ...): the latest write is shown and the
//!   other values are reported as a conflict until someone resolves it;
//! - anything else (a card's position, a checklist item's text): the latest write wins quietly.
//!
//! Merging is commutative, associative and idempotent, so replicas converge whatever order they exchange state in.

use std::collections::{BTreeMap, HashMap};

use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::models::{ChecklistItem, Comment, KanbanCard, Task};

/// Replica id used for the state made from a record that predates this module
pub const LEGACY: &str = "legacy";

/// One write: which replica made it and that replica's running count
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Dot {
    pub r: String,
    pub c: u64,
}

/// One value a path currently holds; a path holds several only while writes were concurrent
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Sibling {
    pub dot: Dot,
    /// Milliseconds since 1970, forced above every time the record has seen so later writes sort later
    pub ts: u64,
    pub value: Value,
    /// Who made the write, when known; a name the writing device chose, not proof of anything
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub who: Option<String>,
    /// The device key that signed the write, and its signature (see `signing`); absent on writes from before signing
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub by: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sig: Option<String>,
    /// The version of the signed member list the writer held, and a second signature that covers it. Older apps keep both
    /// as unknown fields and pass them on; a write without them is judged by the newest list alone.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ep: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sig2: Option<String>,
    /// Anything a newer version of the app added to a write: kept and passed on untouched, so an older app never drops it
    #[serde(flatten, default, skip_serializing_if = "BTreeMap::is_empty")]
    pub extra: BTreeMap<String, Value>,
}

/// Everything a replica knows about one record
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct RecordState {
    pub vv: BTreeMap<String, u64>,
    pub fields: BTreeMap<String, Vec<Sibling>>,
    /// Anything a newer version of the app added to the record itself; see `Sibling::extra`
    #[serde(flatten, default, skip_serializing_if = "BTreeMap::is_empty")]
    pub extra: BTreeMap<String, Value>,
}

/// The paths this version of the app reads and writes. A path outside this set came from a newer version: it is kept in
/// the record and merged like any other, but it is never removed by an edit made from a view that could not show it.
fn is_known_path(path: &str) -> bool {
    const FIELDS: &[&str] = &["title", "description", "status", "priority", "due_date", "assignee_id", "column_id", "position", "tags", "comments", "checklist"];
    FIELDS.contains(&path) || path.starts_with("tags/") || path.starts_with("comments/") || path.starts_with("checklist/")
}

/// Combines the extra fields of two copies; where both hold the same key, the larger text wins, so the result does
/// not depend on which copy is first
fn merge_extra(a: &BTreeMap<String, Value>, b: &BTreeMap<String, Value>) -> BTreeMap<String, Value> {
    let mut out = a.clone();
    for (k, v) in b {
        let as_text = |value: &Value| value.to_string();
        let keep_mine = out.get(k).is_some_and(|mine| as_text(mine) >= as_text(v));
        if !keep_mine {
            out.insert(k.clone(), v.clone());
        }
    }
    out
}

/// A value another person wrote to the same field at the same time
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct ConflictOption {
    pub value: Value,
    pub ts: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub who: Option<String>,
    /// The device key that signed this value, when it was signed
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub by: Option<String>,
}

/// A field with more than one value; the first option is the one being shown
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Conflict {
    pub field: String,
    pub options: Vec<ConflictOption>,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Kind {
    /// Add wins over remove
    Set,
    /// Latest wins, and the others are reported
    Surfaced,
    /// Latest wins
    Quiet,
}

/// Fields worth telling the person about when two values collide
const SURFACED: &[&str] = &["title", "description", "status", "priority", "due_date", "assignee_id", "column_id"];

fn kind(path: &str) -> Kind {
    if path.starts_with("tags/") || path.starts_with("comments/") {
        return Kind::Set;
    }
    if let Some(rest) = path.strip_prefix("checklist/") {
        // "checklist/<id>" is whether the item exists; "checklist/<id>/text" and ".../done" are its contents
        return if rest.contains('/') { Kind::Quiet } else { Kind::Set };
    }
    if SURFACED.contains(&path) { Kind::Surfaced } else { Kind::Quiet }
}

fn covers(vv: &BTreeMap<String, u64>, dot: &Dot) -> bool {
    vv.get(&dot.r).is_some_and(|c| *c >= dot.c)
}

fn rank(s: &Sibling) -> (u64, &str, u64) {
    (s.ts, s.dot.r.as_str(), s.dot.c)
}

fn winner<'a>(path: &str, siblings: &'a [Sibling]) -> Option<&'a Sibling> {
    if kind(path) == Kind::Set {
        if let Some(best) = siblings.iter().filter(|s| !s.value.is_null()).max_by_key(|s| rank(s)) {
            return Some(best);
        }
    }
    siblings.iter().max_by_key(|s| rank(s))
}

fn merge_siblings(a: &[Sibling], a_vv: &BTreeMap<String, u64>, b: &[Sibling], b_vv: &BTreeMap<String, u64>) -> Vec<Sibling> {
    let mut out: Vec<Sibling> = Vec::new();
    for s in a {
        match b.iter().find(|x| x.dot == s.dot) {
            // The same write on both sides; the two only differ when two devices each made up the same legacy dot
            Some(x) => {
                let x_wins = (rank(x), x.value.to_string()) > (rank(s), s.value.to_string());
                out.push(if x_wins { x.clone() } else { s.clone() })
            }
            // Only here: keep it unless the other side saw it and has since replaced it
            None if !covers(b_vv, &s.dot) => out.push(s.clone()),
            None => {}
        }
    }
    for s in b {
        if a.iter().all(|x| x.dot != s.dot) && !covers(a_vv, &s.dot) {
            out.push(s.clone());
        }
    }
    out.sort_by(|x, y| x.dot.cmp(&y.dot));
    out
}

impl RecordState {
    /// False if any write is stamped more than a day later than `now`
    pub fn stamps_sane(&self, now: u64) -> bool {
        self.max_ts() <= now.saturating_add(MAX_AHEAD_MS)
    }

    /// The newest write time in the record
    pub fn max_ts(&self) -> u64 {
        self.fields.values().flatten().map(|s| s.ts).max().unwrap_or(0)
    }

    /// State for a record that has none: every field written once, by the legacy replica, at `ts`
    pub fn from_legacy(values: BTreeMap<String, Value>, ts: u64) -> Self {
        let mut state = RecordState::default();
        state.vv.insert(LEGACY.to_string(), 0);
        for (path, value) in values {
            state.fields.insert(path, vec![Sibling { dot: Dot { r: LEGACY.to_string(), c: 0 }, ts, value, who: None, by: None, sig: None, ep: None, sig2: None, extra: BTreeMap::new() }]);
        }
        state
    }

    /// Writes one value, replacing everything the path held (so it settles any conflict there)
    pub fn write(&mut self, replica: &str, path: &str, value: Value, now: u64, who: Option<&str>) {
        let c = self.vv.get(replica).copied().unwrap_or(0) + 1;
        self.vv.insert(replica.to_string(), c);
        let ts = now.max(self.max_ts() + 1);
        self.fields.insert(path.to_string(), vec![Sibling { dot: Dot { r: replica.to_string(), c }, ts, value, who: who.map(str::to_string), by: None, sig: None, ep: None, sig2: None, extra: BTreeMap::new() }]);
    }

    /// Makes the record read as `desired`, writing only the paths that differ; returns whether anything was written.
    /// A path the record holds that `desired` leaves out is removed. Used by the tests and the simulation.
    #[cfg(test)]
    pub fn diff_write(&mut self, replica: &str, desired: &BTreeMap<String, Value>, now: u64, who: Option<&str>) -> bool {
        self.diff_write_from(replica, desired, None, now, who)
    }

    /// Like `diff_write`, for an edit made on a copy of the record that may be out of date: with `base`, the copy the
    /// editor started from, only what the editor changed is written, so a collaborator's newer change to something the
    /// editor did not touch is not undone by the editor's stale view of it.
    pub fn diff_write_from(&mut self, replica: &str, desired: &BTreeMap<String, Value>, base: Option<&BTreeMap<String, Value>>, now: u64, who: Option<&str>) -> bool {
        let current = self.resolved();
        let mut changed = false;
        for (path, value) in desired {
            if current.get(path) == Some(value) || base.is_some_and(|b| b.get(path) == Some(value)) {
                continue;
            }
            self.write(replica, path, value.clone(), now, who);
            changed = true;
        }
        for (path, value) in &current {
            // Not in the editor's copy at all means someone else added it since: it is theirs to keep
            if desired.contains_key(path) || !is_known_path(path) || value.is_null() || base.is_some_and(|b| !b.contains_key(path)) {
                continue;
            }
            self.write(replica, path, Value::Null, now, who);
            changed = true;
        }
        changed
    }

    /// Takes one write into the record as it is, without asking whether this device has already seen it: for a write that was
    /// held and is now accepted (see `held.rs`). It sits beside whatever the path holds, so a concurrent write shows as a conflict.
    pub fn adopt(&mut self, path: &str, sibling: Sibling) {
        let list = self.fields.entry(path.to_string()).or_default();
        if list.iter().any(|s| s.dot == sibling.dot) {
            return;
        }
        let seen = self.vv.entry(sibling.dot.r.clone()).or_insert(0);
        *seen = (*seen).max(sibling.dot.c);
        list.push(sibling);
        list.sort_by(|x, y| x.dot.cmp(&y.dot));
    }

    /// Combines two copies of the same record
    pub fn merge(&self, other: &RecordState) -> RecordState {
        let mut vv = self.vv.clone();
        for (r, c) in &other.vv {
            let slot = vv.entry(r.clone()).or_insert(0);
            *slot = (*slot).max(*c);
        }
        let mut fields = BTreeMap::new();
        for path in self.fields.keys().chain(other.fields.keys()) {
            if fields.contains_key(path) {
                continue;
            }
            let none: Vec<Sibling> = Vec::new();
            let merged = merge_siblings(
                self.fields.get(path).unwrap_or(&none),
                &self.vv,
                other.fields.get(path).unwrap_or(&none),
                &other.vv,
            );
            if !merged.is_empty() {
                fields.insert(path.clone(), merged);
            }
        }
        RecordState { vv, fields, extra: merge_extra(&self.extra, &other.extra) }
    }

    /// Who wrote the value a path shows, when that is known
    pub fn writer_of(&self, path: &str) -> Option<String> {
        self.fields.get(path).and_then(|s| winner(path, s)).and_then(|w| w.who.clone())
    }

    /// The device key that signed the value a path shows, when it was signed
    pub fn signer_of(&self, path: &str) -> Option<String> {
        self.fields.get(path).and_then(|s| winner(path, s)).and_then(|w| w.by.clone())
    }

    fn write_of<'a>(entity: &'a str, id: &'a str, path: &'a str, s: &'a Sibling) -> super::signing::Write<'a> {
        super::signing::Write { entity, record: id, path, replica: &s.dot.r, counter: s.dot.c, ts: s.ts, who: s.who.as_deref(), value: &s.value }
    }

    /// Signs the writes this replica has made that are not signed yet, with this device's key
    /// `epoch` is the version of the member list this device holds (0 when it holds none); it is signed into the write.
    pub fn sign_own(&mut self, entity: &str, id: &str, replica: &str, epoch: u64) {
        for (path, siblings) in self.fields.iter_mut() {
            for s in siblings.iter_mut().filter(|s| s.dot.r == replica && s.sig.is_none()) {
                if let Some((by, sig)) = super::signing::sign(&Self::write_of(entity, id, path, s)) {
                    if epoch > 0 {
                        s.sig2 = super::signing::sign_under(&Self::write_of(entity, id, path, s), epoch);
                        s.ep = s.sig2.as_ref().map(|_| epoch);
                    }
                    s.by = Some(by);
                    s.sig = Some(sig);
                }
            }
        }
    }

    /// False if any write carries a signature that does not check out for this record. A write with none is not
    /// refused: it is from before signing, or from a device that does not sign, and simply cannot be vouched for.
    pub fn signatures_ok(&self, entity: &str, id: &str) -> bool {
        self.fields.iter().all(|(path, siblings)| {
            siblings.iter().all(|s| match (&s.by, &s.sig) {
                (None, None) => true,
                (Some(by), Some(sig)) => {
                    let w = Self::write_of(entity, id, path, s);
                    super::signing::verify(by, sig, &w)
                        && match (s.ep, &s.sig2) {
                            (None, None) => true,
                            (Some(ep), Some(sig2)) => super::signing::verify_under(by, sig2, &w, ep),
                            // A version without its signature, or a signature without its version, was tampered with
                            _ => false,
                        }
                }
                _ => false,
            })
        })
    }

    /// The value each path shows
    pub fn resolved(&self) -> BTreeMap<String, Value> {
        self.fields.iter().filter_map(|(p, s)| winner(p, s).map(|w| (p.clone(), w.value.clone()))).collect()
    }

    /// The fields where different values are waiting for someone to choose
    pub fn conflicts(&self) -> Vec<Conflict> {
        let mut out = Vec::new();
        for (path, siblings) in &self.fields {
            if kind(path) != Kind::Surfaced || siblings.len() < 2 {
                continue;
            }
            let mut ordered: Vec<&Sibling> = siblings.iter().collect();
            ordered.sort_by_key(|s| std::cmp::Reverse(rank(s)));
            let mut options: Vec<ConflictOption> = Vec::new();
            for s in ordered {
                if options.iter().all(|o| o.value != s.value) {
                    options.push(ConflictOption { value: s.value.clone(), ts: s.ts, who: s.who.clone(), by: s.by.clone() });
                }
            }
            if options.len() > 1 {
                out.push(Conflict { field: path.clone(), options });
            }
        }
        out
    }
}

// ────────────────────────────
// Tasks and cards as paths
// ────────────────────────────

/// A record kept in this scheme
pub trait Crdt: Sized + Clone {
    const ENTITY: &'static str;
    fn id(&self) -> &str;
    fn updated_at(&self) -> &str;
    fn set_updated_at(&mut self, at: String);
    fn crdt(&self) -> Option<&RecordState>;
    fn set_crdt(&mut self, state: Option<RecordState>);
    fn set_conflicts(&mut self, conflicts: Vec<Conflict>);
    /// The record as paths. With `whole_lists`, tags, comments and checklists are one value each, like a plain register.
    fn paths(&self, whole_lists: bool) -> BTreeMap<String, Value>;
    /// The record read back from paths, starting from `base` for what the paths do not carry
    fn materialize(base: &Self, resolved: &BTreeMap<String, Value>) -> Self;
}

fn text(resolved: &BTreeMap<String, Value>, key: &str, fallback: &str) -> String {
    resolved.get(key).and_then(Value::as_str).unwrap_or(fallback).to_string()
}

fn optional(resolved: &BTreeMap<String, Value>, key: &str, fallback: &Option<String>) -> Option<String> {
    match resolved.get(key) {
        Some(Value::String(s)) => Some(s.clone()),
        Some(Value::Null) => None,
        _ => fallback.clone(),
    }
}

fn opt_value(v: &Option<String>) -> Value {
    v.as_ref().map_or(Value::Null, |s| json!(s))
}

fn tag_paths(tags: &[String], whole: bool, out: &mut BTreeMap<String, Value>) {
    if whole {
        out.insert("tags".into(), json!(tags));
    } else {
        for t in tags {
            out.insert(format!("tags/{t}"), json!(true));
        }
    }
}

fn comment_paths(comments: &[Comment], whole: bool, out: &mut BTreeMap<String, Value>) {
    if whole {
        out.insert("comments".into(), json!(comments));
    } else {
        for c in comments {
            out.insert(format!("comments/{}", c.id), json!(c));
        }
    }
}

fn tags_from(resolved: &BTreeMap<String, Value>) -> Vec<String> {
    if let Some(Value::Array(list)) = resolved.get("tags") {
        return list.iter().filter_map(|v| v.as_str().map(str::to_string)).collect();
    }
    // BTreeMap order, so every replica lists the same tags in the same order
    resolved.iter().filter(|(k, v)| k.starts_with("tags/") && !v.is_null()).map(|(k, _)| k["tags/".len()..].to_string()).collect()
}

fn comments_from(resolved: &BTreeMap<String, Value>) -> Vec<Comment> {
    if let Some(list) = resolved.get("comments") {
        return serde_json::from_value(list.clone()).unwrap_or_default();
    }
    let mut out: Vec<Comment> = resolved
        .iter()
        .filter(|(k, v)| k.starts_with("comments/") && !v.is_null())
        .filter_map(|(_, v)| serde_json::from_value(v.clone()).ok())
        .collect();
    out.sort_by(|a, b| (&a.at, &a.id).cmp(&(&b.at, &b.id)));
    out
}

impl Crdt for Task {
    const ENTITY: &'static str = "task";
    fn id(&self) -> &str {
        &self.id
    }
    fn updated_at(&self) -> &str {
        &self.updated_at
    }
    fn set_updated_at(&mut self, at: String) {
        self.updated_at = at;
    }
    fn crdt(&self) -> Option<&RecordState> {
        self.crdt.as_ref()
    }
    fn set_crdt(&mut self, state: Option<RecordState>) {
        self.crdt = state;
    }
    fn set_conflicts(&mut self, conflicts: Vec<Conflict>) {
        self.conflicts = conflicts;
    }

    fn paths(&self, whole: bool) -> BTreeMap<String, Value> {
        let mut p = BTreeMap::new();
        p.insert("title".into(), json!(self.title));
        p.insert("description".into(), json!(self.description));
        p.insert("status".into(), json!(self.status));
        p.insert("priority".into(), json!(self.priority));
        p.insert("due_date".into(), opt_value(&self.due_date));
        p.insert("assignee_id".into(), opt_value(&self.assignee_id));
        tag_paths(&self.tags, whole, &mut p);
        comment_paths(&self.comments, whole, &mut p);
        p
    }

    fn materialize(base: &Self, r: &BTreeMap<String, Value>) -> Self {
        Task {
            id: base.id.clone(),
            title: text(r, "title", &base.title),
            description: text(r, "description", &base.description),
            status: text(r, "status", &base.status),
            priority: text(r, "priority", &base.priority),
            due_date: optional(r, "due_date", &base.due_date),
            assignee_id: optional(r, "assignee_id", &base.assignee_id),
            tags: tags_from(r),
            comments: comments_from(r),
            created_at: base.created_at.clone(),
            updated_at: base.updated_at.clone(),
            crdt: None,
            conflicts: Vec::new(),
            violations: Vec::new(),
        }
    }
}

impl Crdt for KanbanCard {
    const ENTITY: &'static str = "card";
    fn id(&self) -> &str {
        &self.id
    }
    fn updated_at(&self) -> &str {
        &self.updated_at
    }
    fn set_updated_at(&mut self, at: String) {
        self.updated_at = at;
    }
    fn crdt(&self) -> Option<&RecordState> {
        self.crdt.as_ref()
    }
    fn set_crdt(&mut self, state: Option<RecordState>) {
        self.crdt = state;
    }
    fn set_conflicts(&mut self, conflicts: Vec<Conflict>) {
        self.conflicts = conflicts;
    }

    fn paths(&self, whole: bool) -> BTreeMap<String, Value> {
        let mut p = BTreeMap::new();
        p.insert("title".into(), json!(self.title));
        p.insert("description".into(), json!(self.description));
        p.insert("column_id".into(), json!(self.column_id));
        // A whole position stays an integer, so cards written before positions could be fractions still compare equal
        let position = if self.position.fract() == 0.0 && self.position.abs() < 1e15 { json!(self.position as i64) } else { json!(self.position) };
        p.insert("position".into(), position);
        p.insert("due_date".into(), opt_value(&self.due_date));
        p.insert("assignee_id".into(), opt_value(&self.assignee_id));
        tag_paths(&self.tags, whole, &mut p);
        comment_paths(&self.comments, whole, &mut p);
        if whole {
            p.insert("checklist".into(), json!(self.checklist));
        } else {
            for (i, item) in self.checklist.iter().enumerate() {
                p.insert(format!("checklist/{}", item.id), json!(i));
                p.insert(format!("checklist/{}/text", item.id), json!(item.text));
                p.insert(format!("checklist/{}/done", item.id), json!(item.done));
            }
        }
        p
    }

    fn materialize(base: &Self, r: &BTreeMap<String, Value>) -> Self {
        let checklist = if let Some(list) = r.get("checklist") {
            serde_json::from_value(list.clone()).unwrap_or_default()
        } else {
            let mut items: Vec<(i64, ChecklistItem)> = r
                .iter()
                .filter(|(k, v)| k.starts_with("checklist/") && !k["checklist/".len()..].contains('/') && !v.is_null())
                .map(|(k, v)| {
                    let id = k["checklist/".len()..].to_string();
                    let item = ChecklistItem {
                        text: r.get(&format!("checklist/{id}/text")).and_then(Value::as_str).unwrap_or("").to_string(),
                        done: r.get(&format!("checklist/{id}/done")).and_then(Value::as_bool).unwrap_or(false),
                        id,
                    };
                    (v.as_i64().unwrap_or(0), item)
                })
                .collect();
            items.sort_by(|a, b| (a.0, &a.1.id).cmp(&(b.0, &b.1.id)));
            items.into_iter().map(|(_, i)| i).collect()
        };
        KanbanCard {
            id: base.id.clone(),
            title: text(r, "title", &base.title),
            description: text(r, "description", &base.description),
            column_id: text(r, "column_id", &base.column_id),
            position: r.get("position").and_then(Value::as_f64).unwrap_or(base.position),
            tags: tags_from(r),
            due_date: optional(r, "due_date", &base.due_date),
            assignee_id: optional(r, "assignee_id", &base.assignee_id),
            checklist,
            comments: comments_from(r),
            created_at: base.created_at.clone(),
            updated_at: base.updated_at.clone(),
            crdt: None,
            conflicts: Vec::new(),
            violations: Vec::new(),
        }
    }
}

pub fn ts_of(rfc3339: &str) -> u64 {
    DateTime::parse_from_rfc3339(rfc3339).map(|t| t.timestamp_millis().max(0) as u64).unwrap_or(0)
}

pub fn rfc3339_of(ts: u64) -> String {
    DateTime::<Utc>::from_timestamp_millis(ts as i64).unwrap_or_default().to_rfc3339()
}

/// How far this device's clock is moved before it stamps a write, set from what the linked devices say the time is
/// (see `p2p::clock`). Zero when there is nothing to correct.
static CLOCK_CORRECTION: std::sync::atomic::AtomicI64 = std::sync::atomic::AtomicI64::new(0);

pub fn set_clock_correction(ms: i64) {
    CLOCK_CORRECTION.store(ms, std::sync::atomic::Ordering::Relaxed);
}

/// The time to stamp a write with: the device's clock, moved to the middle of the clocks of the devices it is linked to
pub fn now_ms() -> u64 {
    (Utc::now().timestamp_millis() + CLOCK_CORRECTION.load(std::sync::atomic::Ordering::Relaxed)).max(0) as u64
}

/// How far ahead of this device's clock a stamp may be and still be taken. A write stamped further out would win every
/// contest it was ever in, whether from a clock set wrong or from a device that meant it.
pub const MAX_AHEAD_MS: u64 = 24 * 60 * 60 * 1000;

// ────────────────────────────
// Storage
// ────────────────────────────

fn db_err(e: rusqlite::Error) -> String {
    e.to_string()
}

/// This copy of the workspace's id as a replica; made once, and kept in the database so it moves with the copy
pub fn replica_id(conn: &Connection) -> Result<String, String> {
    if let Some(id) = conn.query_row("SELECT id FROM replica LIMIT 1", [], |r| r.get::<_, String>(0)).optional().map_err(db_err)? {
        return Ok(id);
    }
    let id = uuid::Uuid::new_v4().simple().to_string()[..16].to_string();
    conn.execute("INSERT INTO replica (id) VALUES (?1)", [&id]).map_err(db_err)?;
    Ok(id)
}

pub fn load(conn: &Connection, entity: &str, id: &str) -> Result<Option<RecordState>, String> {
    let text: Option<String> = conn
        .query_row("SELECT state FROM crdt_meta WHERE entity = ?1 AND id = ?2", params![entity, id], |r| r.get(0))
        .optional()
        .map_err(db_err)?;
    Ok(text.and_then(|t| serde_json::from_str(&t).ok()))
}

/// Most writes kept in the replay log of one record
const WRITE_LOG_KEEP: i64 = 600;

pub fn save(conn: &Connection, entity: &str, id: &str, state: &RecordState) -> Result<(), String> {
    let text = serde_json::to_string(state).map_err(|e| e.to_string())?;
    conn.execute("INSERT OR REPLACE INTO crdt_meta (entity, id, state) VALUES (?1, ?2, ?3)", params![entity, id, text]).map_err(db_err)?;
    log_writes(conn, entity, id, state)
}

/// Remembers every write the state holds, so that the values a field had before it was overwritten can be replayed
fn log_writes(conn: &Connection, entity: &str, id: &str, state: &RecordState) -> Result<(), String> {
    let now = now_ms() as i64;
    let mut stmt = conn
        .prepare_cached("INSERT OR IGNORE INTO write_log (entity, record, path, replica, counter, ts, who, by_key, value, seen_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)")
        .map_err(db_err)?;
    for (path, siblings) in &state.fields {
        for s in siblings {
            stmt.execute(params![entity, id, path, s.dot.r, s.dot.c as i64, s.ts as i64, s.who.clone().unwrap_or_default(), s.by.clone().unwrap_or_default(), s.value.to_string(), now]).map_err(db_err)?;
        }
    }
    conn.execute(
        "DELETE FROM write_log WHERE entity = ?1 AND record = ?2 AND rowid NOT IN (SELECT rowid FROM write_log WHERE entity = ?1 AND record = ?2 ORDER BY ts DESC, rowid DESC LIMIT ?3)",
        params![entity, id, WRITE_LOG_KEEP],
    )
    .map(|_| ())
    .map_err(db_err)
}

/// One value a field held, for the replay of a record
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoggedWrite {
    pub path: String,
    pub ts: u64,
    pub who: String,
    pub by: String,
    pub replica: String,
    /// The value, as JSON text
    pub value: String,
    /// When this device first held the write: a write held long after its stamp was made while apart
    pub seen_at: u64,
}

/// Every write kept for a record, oldest first
pub fn write_history(conn: &Connection, entity: &str, id: &str) -> Result<Vec<LoggedWrite>, String> {
    let mut stmt = conn.prepare("SELECT path, ts, who, by_key, replica, value, seen_at FROM write_log WHERE entity = ?1 AND record = ?2 ORDER BY ts ASC, counter ASC").map_err(db_err)?;
    let rows = stmt
        .query_map(params![entity, id], |r| Ok(LoggedWrite { path: r.get(0)?, ts: r.get::<_, i64>(1)? as u64, who: r.get(2)?, by: r.get(3)?, replica: r.get(4)?, value: r.get(5)?, seen_at: r.get::<_, i64>(6)? as u64 }))
        .map_err(db_err)?;
    rows.collect::<Result<_, _>>().map_err(db_err)
}

#[tauri::command(async)]
pub fn record_history(app: tauri::AppHandle, path: String, entity: String, id: String) -> Result<Vec<LoggedWrite>, String> {
    crate::commands::config::validate_allowed_root(&app, &path)?;
    write_history(&crate::database::WorkspaceDb::open_existing(&path)?.conn, &entity, &id)
}

pub fn forget(conn: &Connection, entity: &str, id: &str) -> Result<(), String> {
    conn.execute("DELETE FROM write_log WHERE entity = ?1 AND record = ?2", params![entity, id]).map_err(db_err)?;
    conn.execute("DELETE FROM crdt_meta WHERE entity = ?1 AND id = ?2", params![entity, id]).map(|_| ()).map_err(db_err)
}

/// Gives a record that has no state one, from what its row holds now. Call before changing the row, so that what the
/// record held before the change is what other devices will see as the earlier value.
pub fn ensure<T: Crdt>(conn: &Connection, row: &T) -> Result<(), String> {
    if load(conn, T::ENTITY, row.id())?.is_none() {
        save(conn, T::ENTITY, row.id(), &RecordState::from_legacy(row.paths(false), ts_of(row.updated_at())))?;
    }
    Ok(())
}

/// Records that the row now holds `row`, writing only what changed since the record's state.
/// `base` is the copy the editor started from, when it may be out of date (see `diff_write_from`).
pub fn record_write<T: Crdt>(conn: &Connection, row: &T, who: Option<&str>, base: Option<&T>) -> Result<(), String> {
    apply_local(conn, row, None, base, who).map(|_| ())
}

/// A local edit: writes what the editor changed into the record's state and returns the record as it now reads,
/// built on `existing` (the row as it was) for what the paths do not carry.
pub fn apply_local<T: Crdt>(conn: &Connection, row: &T, existing: Option<&T>, base: Option<&T>, who: Option<&str>) -> Result<T, String> {
    let replica = replica_id(conn)?;
    let mut state = match load(conn, T::ENTITY, row.id())? {
        Some(s) => s,
        None => existing.map(|e| RecordState::from_legacy(e.paths(false), ts_of(e.updated_at()))).unwrap_or_default(),
    };
    state.diff_write_from(&replica, &row.paths(false), base.map(|b| b.paths(false)).as_ref(), now_ms(), who);
    state.sign_own(T::ENTITY, row.id(), &replica, super::held::list_epoch(conn));
    save(conn, T::ENTITY, row.id(), &state)?;
    let mut out = T::materialize(existing.unwrap_or(row), &state.resolved());
    out.set_updated_at(rfc3339_of(state.max_ts()));
    Ok(out)
}

/// Settles a conflict by choosing a value for the field, even when it is the one already shown.
/// Returns the record as it now reads, built on `base`.
pub fn resolve_field<T: Crdt>(conn: &Connection, base: &T, field: &str, value: Value, who: Option<&str>) -> Result<Option<T>, String> {
    let Some(mut state) = load(conn, T::ENTITY, base.id())? else { return Ok(None) };
    let replica = replica_id(conn)?;
    state.write(&replica, field, value, now_ms(), who);
    state.sign_own(T::ENTITY, base.id(), &replica, super::held::list_epoch(conn));
    save(conn, T::ENTITY, base.id(), &state)?;
    let mut row = T::materialize(base, &state.resolved());
    row.set_updated_at(rfc3339_of(state.max_ts()));
    Ok(Some(row))
}

/// The record a peer's copy turns this device's copy into, or `None` if the peer has nothing this device lacks.
/// The state is saved; the caller writes the returned record into the row.
pub fn merge_remote<T: Crdt>(conn: &Connection, remote: &T, local: Option<&T>, valid: impl Fn(&T) -> bool) -> Result<Option<T>, String> {
    let mut theirs = remote.crdt().cloned().unwrap_or_else(|| RecordState::from_legacy(remote.paths(false), ts_of(remote.updated_at())));
    // A write whose signature does not check out was altered, or never made by the key it names: the record is refused
    if !theirs.signatures_ok(T::ENTITY, remote.id()) {
        eprintln!("[sync] Refused {} {}: a write in it is not signed by the device it names", T::ENTITY, remote.id());
        return Ok(None);
    }
    // A stamp days in the future would win every contest the field was ever in: refused like an unsigned alteration
    if !theirs.stamps_sane(now_ms()) {
        eprintln!("[sync] Refused {} {}: a write in it is stamped more than a day ahead of this device's clock", T::ENTITY, remote.id());
        return Ok(None);
    }
    // A write signed by a key that may not write is kept apart for an Admin, not merged (see `held.rs`)
    let gate = super::held::Gate::load(conn, now_ms());
    if gate.listed || gate.review {
        // With review on, a write this device has not seen is also kept apart (the ones it already holds are not)
        let known: std::collections::HashSet<(String, u64)> = if gate.review {
            match load(conn, T::ENTITY, remote.id())? {
                Some(s) => s,
                None => local.map(|l| RecordState::from_legacy(l.paths(false), ts_of(l.updated_at()))).unwrap_or_default(),
            }
            .fields
            .values()
            .flatten()
            .map(|s| (s.dot.r.clone(), s.dot.c))
            .collect()
        } else {
            Default::default()
        };
        let mut held = Vec::new();
        for (path, siblings) in theirs.fields.iter_mut() {
            siblings.retain(|s| match if gate.listed { gate.verdict_of(s) } else { super::held::Verdict::Allow }.or_review(gate.review && !known.contains(&(s.dot.r.clone(), s.dot.c))) {
                super::held::Verdict::Hold(why) => {
                    held.push((path.clone(), s.clone(), why));
                    false
                }
                // The write names a version of the member list under which its key could not write: nothing to keep
                super::held::Verdict::Refuse(why) => {
                    eprintln!("[sync] Dropped a write to {} {}: {why}", T::ENTITY, remote.id());
                    false
                }
                super::held::Verdict::Allow => true,
            });
        }
        theirs.fields.retain(|_, siblings| !siblings.is_empty());
        for (path, sibling, why) in &held {
            super::held::hold(conn, T::ENTITY, remote.id(), path, sibling, why, now_ms())?;
        }
        if !held.is_empty() && theirs.fields.is_empty() && local.is_none() {
            return Ok(None);
        }
    }
    let ours = match load(conn, T::ENTITY, remote.id())? {
        Some(s) => Some(s),
        None => local.map(|l| RecordState::from_legacy(l.paths(false), ts_of(l.updated_at()))),
    };
    let merged = match &ours {
        Some(o) => o.merge(&theirs),
        None => theirs,
    };
    if local.is_some() && ours.as_ref() == Some(&merged) {
        return Ok(None);
    }
    let mut row = T::materialize(local.unwrap_or(remote), &merged.resolved());
    row.set_updated_at(rfc3339_of(merged.max_ts()));
    // The merged record can show a value that only a hidden sibling carried, so it is checked as well as the peer's copy
    if !valid(&row) {
        return Ok(None);
    }
    save(conn, T::ENTITY, remote.id(), &merged)?;
    Ok(Some(row))
}

/// Attaches what other devices need to merge this record
pub fn attach<T: Crdt>(conn: &Connection, row: &mut T) -> Result<(), String> {
    let state = match load(conn, T::ENTITY, row.id())? {
        Some(s) => s,
        None => RecordState::from_legacy(row.paths(false), ts_of(row.updated_at())),
    };
    row.set_crdt(Some(state));
    Ok(())
}

/// Attaches the conflicts waiting on each record, for showing in the app
pub fn attach_conflicts<T: Crdt>(conn: &Connection, rows: &mut [T]) -> Result<(), String> {
    let mut stmt = conn.prepare("SELECT id, state FROM crdt_meta WHERE entity = ?1").map_err(db_err)?;
    let states: HashMap<String, RecordState> = stmt
        .query_map([T::ENTITY], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        .map_err(db_err)?
        .filter_map(|r| r.ok())
        .filter_map(|(id, text)| serde_json::from_str(&text).ok().map(|s| (id, s)))
        .collect();
    for row in rows {
        if let Some(state) = states.get(row.id()) {
            row.set_conflicts(state.conflicts());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests;
