//! Rules about a whole record, checked after merging.
//!
//! Merging field by field keeps everyone's edits, but it can put together a record that no single person ever made:
//! one person marks a task finished while another, at the same time, removes its assignee, and each device was fine on
//! its own. A rule here says what a record must satisfy across fields. A broken rule is not a conflict between two
//! values, so nothing is resolved for the person; the record is flagged until someone fixes it.
//!
//! Rules are off until a workspace turns them on, so existing records are not flagged. The check runs when records are
//! read, from the record as it stands, so a flag can never be out of date. Each device keeps its own choice of rules.

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

use super::models::{KanbanCard, Task};

pub const FINISHED_HAS_OWNER: &str = "finished-has-owner";
pub const SCHEDULED_HAS_OWNER: &str = "scheduled-has-owner";

/// A rule a workspace can turn on
pub struct Rule {
    pub id: &'static str,
    pub text: &'static str,
    pub applies_to: &'static str,
    broken: &'static str,
}

pub const RULES: &[Rule] = &[
    Rule { id: FINISHED_HAS_OWNER, text: "A finished task has an assignee", applies_to: "tasks", broken: "It is finished, but nobody is assigned." },
    Rule { id: SCHEDULED_HAS_OWNER, text: "Anything with a due date has an assignee", applies_to: "tasks and cards", broken: "It has a due date, but nobody is assigned." },
];

/// A rule a record breaks right now
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Violation {
    pub rule: String,
    pub message: String,
}

/// What the rules need to know about a record
pub trait Subject {
    fn finished(&self) -> bool;
    fn scheduled(&self) -> bool;
    fn owned(&self) -> bool;
    fn set_violations(&mut self, violations: Vec<Violation>);
}

fn non_empty(v: &Option<String>) -> bool {
    v.as_deref().is_some_and(|s| !s.is_empty())
}

impl Subject for Task {
    fn finished(&self) -> bool {
        self.status == "done"
    }
    fn scheduled(&self) -> bool {
        non_empty(&self.due_date)
    }
    fn owned(&self) -> bool {
        non_empty(&self.assignee_id)
    }
    fn set_violations(&mut self, violations: Vec<Violation>) {
        self.violations = violations;
    }
}

impl Subject for KanbanCard {
    // A card has no status
    fn finished(&self) -> bool {
        false
    }
    fn scheduled(&self) -> bool {
        non_empty(&self.due_date)
    }
    fn owned(&self) -> bool {
        non_empty(&self.assignee_id)
    }
    fn set_violations(&mut self, violations: Vec<Violation>) {
        self.violations = violations;
    }
}

/// The rules among `enabled` that the record breaks
pub fn check<S: Subject>(subject: &S, enabled: &[String]) -> Vec<Violation> {
    let mut out = Vec::new();
    for rule in RULES.iter().filter(|r| enabled.iter().any(|id| id == r.id)) {
        let broken = match rule.id {
            FINISHED_HAS_OWNER => subject.finished() && !subject.owned(),
            SCHEDULED_HAS_OWNER => subject.scheduled() && !subject.owned(),
            _ => false,
        };
        if broken {
            out.push(Violation { rule: rule.id.to_string(), message: rule.broken.to_string() });
        }
    }
    out
}

pub fn enabled(conn: &Connection) -> Result<Vec<String>, String> {
    let e = |e: rusqlite::Error| e.to_string();
    conn.prepare("SELECT id FROM enabled_rules").map_err(e)?.query_map([], |r| r.get(0)).map_err(e)?.collect::<Result<_, _>>().map_err(e)
}

pub fn set_enabled(conn: &Connection, id: &str, on: bool) -> Result<(), String> {
    if !RULES.iter().any(|r| r.id == id) {
        return Err("Unknown rule.".into());
    }
    let sql = if on { "INSERT OR IGNORE INTO enabled_rules (id) VALUES (?1)" } else { "DELETE FROM enabled_rules WHERE id = ?1" };
    conn.execute(sql, params![id]).map(|_| ()).map_err(|e| e.to_string())
}

/// Flags the records that break an enabled rule, for showing in the app
pub fn attach<S: Subject>(conn: &Connection, rows: &mut [S]) -> Result<(), String> {
    let on = enabled(conn)?;
    if on.is_empty() {
        return Ok(());
    }
    for row in rows {
        let found = check(row, &on);
        row.set_violations(found);
    }
    Ok(())
}

// ────────────────────────────
// Tauri commands
// ────────────────────────────

#[derive(Serialize)]
pub struct RuleInfo {
    pub id: &'static str,
    pub text: &'static str,
    pub applies_to: &'static str,
    pub enabled: bool,
}

fn open(app_handle: &tauri::AppHandle, path: &str) -> Result<crate::database::WorkspaceDb, String> {
    super::data_sync::checked(app_handle, path)?;
    crate::database::WorkspaceDb::open_existing(path)
}

#[tauri::command]
pub fn get_rules(app_handle: tauri::AppHandle, path: String) -> Result<Vec<RuleInfo>, String> {
    let on = enabled(&open(&app_handle, &path)?.conn)?;
    Ok(RULES.iter().map(|r| RuleInfo { id: r.id, text: r.text, applies_to: r.applies_to, enabled: on.iter().any(|id| id == r.id) }).collect())
}

#[tauri::command]
pub fn set_rule(app_handle: tauri::AppHandle, path: String, id: String, enabled: bool) -> Result<(), String> {
    set_enabled(&open(&app_handle, &path)?.conn, &id, enabled)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn task(status: &str, assignee: Option<&str>, due: Option<&str>) -> Task {
        Task { id: "t".into(), status: status.into(), assignee_id: assignee.map(Into::into), due_date: due.map(Into::into), ..Default::default() }
    }

    fn both() -> Vec<String> {
        RULES.iter().map(|r| r.id.to_string()).collect()
    }

    #[test]
    fn a_record_is_flagged_only_for_enabled_rules_it_breaks() {
        let finished_alone = task("done", None, None);
        let ids = |t: &Task, on: &[String]| check(t, on).into_iter().map(|v| v.rule).collect::<Vec<_>>();
        assert_eq!(ids(&finished_alone, &both()), [FINISHED_HAS_OWNER]);
        assert_eq!(ids(&task("todo", None, Some("2026-03-01")), &both()), [SCHEDULED_HAS_OWNER]);
        assert_eq!(ids(&task("done", None, Some("2026-03-01")), &both()).len(), 2);
        assert!(check(&task("done", Some("sam"), Some("2026-03-01")), &both()).is_empty());
        assert!(check(&task("todo", None, None), &both()).is_empty());
        // Nothing is flagged until a rule is turned on
        assert!(check(&finished_alone, &[]).is_empty());
        assert!(check(&finished_alone, &[SCHEDULED_HAS_OWNER.to_string()]).is_empty());
    }

    #[test]
    fn an_empty_assignee_counts_as_none_and_cards_have_no_status() {
        assert_eq!(check(&task("done", Some(""), None), &both()).len(), 1);
        let card = KanbanCard { due_date: Some("2026-03-01".into()), ..Default::default() };
        assert_eq!(check(&card, &both()).len(), 1);
        assert!(check(&KanbanCard::default(), &both()).is_empty());
    }

    #[test]
    fn choices_are_stored_and_unknown_rules_refused() {
        let conn = Connection::open_in_memory().unwrap();
        crate::database::schema::init_schema(&conn).unwrap();
        assert!(enabled(&conn).unwrap().is_empty());
        set_enabled(&conn, FINISHED_HAS_OWNER, true).unwrap();
        set_enabled(&conn, FINISHED_HAS_OWNER, true).unwrap();
        assert_eq!(enabled(&conn).unwrap(), [FINISHED_HAS_OWNER]);
        let mut rows = vec![task("done", None, None), task("todo", None, None)];
        attach(&conn, &mut rows).unwrap();
        assert_eq!((rows[0].violations.len(), rows[1].violations.len()), (1, 0));
        set_enabled(&conn, FINISHED_HAS_OWNER, false).unwrap();
        assert!(enabled(&conn).unwrap().is_empty());
        assert!(set_enabled(&conn, "nonsense", true).is_err());
    }
}
