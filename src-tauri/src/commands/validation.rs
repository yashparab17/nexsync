//! Helpers for validating user-provided inputs.

/// Validates a task status string
pub fn validate_task_status(status: &str) -> Result<(), String> {
	match status.to_lowercase().as_str() {
		"todo" | "in_progress" | "done" => Ok(()),
		_ => Err(format!("Invalid task status: '{}'. Must be one of: todo, in_progress, done", status)),
	}
}

/// Validates a task priority string
pub fn validate_task_priority(priority: &str) -> Result<(), String> {
	match priority.to_lowercase().as_str() {
		"low" | "medium" | "high" => Ok(()),
		_ => Err(format!("Invalid task priority: '{}'. Must be one of: low, medium, high", priority)),
	}
}

/// Validates a member role string
pub fn validate_member_role(role: &str) -> Result<(), String> {
	match role.to_lowercase().as_str() {
		"owner" | "editor" | "viewer" => Ok(()),
		_ => Err(format!("Invalid member role: '{}'. Must be one of: owner, editor, viewer", role)),
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn test_valid_statuses() {
		assert!(validate_task_status("todo").is_ok());
		assert!(validate_task_status("in_progress").is_ok());
		assert!(validate_task_status("done").is_ok());
	}

	#[test]
	fn test_invalid_status() {
		assert!(validate_task_status("invalid").is_err());
	}

	#[test]
	fn test_valid_priorities() {
		assert!(validate_task_priority("low").is_ok());
		assert!(validate_task_priority("medium").is_ok());
		assert!(validate_task_priority("high").is_ok());
	}

	#[test]
	fn test_invalid_priority() {
		assert!(validate_task_priority("urgent").is_err());
	}

	#[test]
	fn test_valid_roles() {
		assert!(validate_member_role("owner").is_ok());
		assert!(validate_member_role("editor").is_ok());
		assert!(validate_member_role("viewer").is_ok());
	}

	#[test]
	fn test_invalid_role() {
		assert!(validate_member_role("admin").is_err());
	}
}
