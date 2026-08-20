/// Enums for validating user-provided values. These ensure only allowed
/// values are written to the database, preventing data corruption and
/// reducing the attack surface.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TaskStatus {
	Todo,
	InProgress,
	Done,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TaskPriority {
	Low,
	Medium,
	High,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MemberRole {
	Owner,
	Editor,
	Viewer,
}

/// Validates a task status string. Returns `true` if it's one of the allowed values.
pub fn validate_task_status(status: &str) -> Result<TaskStatus, String> {
	match status.to_lowercase().as_str() {
		"todo" => Ok(TaskStatus::Todo),
		"in_progress" => Ok(TaskStatus::InProgress),
		"done" => Ok(TaskStatus::Done),
		_ => Err(format!("Invalid task status: '{}'. Must be one of: todo, in_progress, done", status)),
	}
}

/// Validates a task priority string. Returns `true` if it's one of the allowed values.
pub fn validate_task_priority(priority: &str) -> Result<TaskPriority, String> {
	match priority.to_lowercase().as_str() {
		"low" => Ok(TaskPriority::Low),
		"medium" => Ok(TaskPriority::Medium),
		"high" => Ok(TaskPriority::High),
		_ => Err(format!("Invalid task priority: '{}'. Must be one of: low, medium, high", priority)),
	}
}

/// Validates a member role string. Returns `true` if it's one of the allowed values.
pub fn validate_member_role(role: &str) -> Result<MemberRole, String> {
	match role.to_lowercase().as_str() {
		"owner" => Ok(MemberRole::Owner),
		"editor" => Ok(MemberRole::Editor),
		"viewer" => Ok(MemberRole::Viewer),
		_ => Err(format!("Invalid member role: '{}'. Must be one of: owner, editor, viewer", role)),
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn test_valid_statuses() {
		assert!(matches!(validate_task_status("todo"), Ok(TaskStatus::Todo)));
		assert!(matches!(validate_task_status("in_progress"), Ok(TaskStatus::InProgress)));
		assert!(matches!(validate_task_status("done"), Ok(TaskStatus::Done)));
	}

	#[test]
	fn test_invalid_status() {
		assert!(validate_task_status("invalid").is_err());
	}

	#[test]
	fn test_valid_priorities() {
		assert!(matches!(validate_task_priority("low"), Ok(TaskPriority::Low)));
		assert!(matches!(validate_task_priority("medium"), Ok(TaskPriority::Medium)));
		assert!(matches!(validate_task_priority("high"), Ok(TaskPriority::High)));
	}

	#[test]
	fn test_invalid_priority() {
		assert!(validate_task_priority("urgent").is_err());
	}

	#[test]
	fn test_valid_roles() {
		assert!(matches!(validate_member_role("owner"), Ok(MemberRole::Owner)));
		assert!(matches!(validate_member_role("editor"), Ok(MemberRole::Editor)));
		assert!(matches!(validate_member_role("viewer"), Ok(MemberRole::Viewer)));
	}

	#[test]
	fn test_invalid_role() {
		assert!(validate_member_role("admin").is_err());
	}
}