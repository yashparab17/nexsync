use rusqlite::Transaction;

use super::models::{Activity, ActivityEvent, History, Permissions};

/// Load permissions from the database.
pub(crate) fn load_permissions(
    tx: &Transaction,
    workspace_id: &str,
) -> Result<Permissions, String> {
    let mut perms = Permissions::default();
    let rows: Vec<(String, String)> = tx
        .prepare("SELECT role, permission FROM permissions WHERE workspace_id = ?1")
        .map_err(|e| e.to_string())?
        .query_map([workspace_id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    for (role, permission) in rows {
        match role.as_str() {
            "owner" => perms.owner.push(permission),
            "editor" => perms.editor.push(permission),
            "viewer" => perms.viewer.push(permission),
            _ => {}
        }
    }
    Ok(perms)
}

/// Load history from the database.
pub(crate) fn load_history(tx: &Transaction, workspace_id: &str) -> Result<History, String> {
    let row: Result<(String, String), rusqlite::Error> = tx.query_row(
        "SELECT last_opened, recent_files FROM history WHERE workspace_id = ?1",
        [workspace_id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    );
    let (last_opened, recent_files_json) = row.unwrap_or_else(|_| {
        (chrono::Utc::now().to_rfc3339(), "[]".to_string())
    });
    let recent_files: Vec<String> = serde_json::from_str(&recent_files_json).unwrap_or_default();
    Ok(History { last_opened, recent_files })
}

/// Load activity events from the database.
pub(crate) fn load_activity(tx: &Transaction, workspace_id: &str) -> Result<Activity, String> {
    let mut stmt = tx
        .prepare(
            "SELECT id, timestamp, action, detail, target, target_type
             FROM activity_events WHERE workspace_id = ?1
             ORDER BY timestamp DESC
             LIMIT 500",
        )
        .map_err(|e| e.to_string())?;
    let events: Vec<ActivityEvent> = stmt
        .query_map([workspace_id], |r| {
            Ok(ActivityEvent {
                id: r.get(0)?,
                timestamp: r.get(1)?,
                action: r.get(2)?,
                detail: r.get(3)?,
                target: r.get(4).ok(),
                target_type: r.get(5).ok(),
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    Ok(Activity { events })
}