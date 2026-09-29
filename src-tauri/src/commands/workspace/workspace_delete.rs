//! Deleting a workspace from disk by moving it to the operating system recycle bin.
//!
//! Only folders Nexsync created are moved. An imported folder may hold other files, so when it does
//! the individual Nexsync folders go to the bin and everything else is left where it is.

use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::commands::config::validate_allowed_root;

/// Folders and the database directory that Nexsync creates inside a workspace
const OWN_ITEMS: &[&str] = &["notes", "files", "assets", "editor", "tasks", "kanban", ".nexsync"];
/// Files the operating system adds on its own, which do not count as user content
const OS_JUNK: &[&str] = &["desktop.ini", "thumbs.db", ".ds_store"];

/// What ends up in the recycle bin
#[derive(Debug, PartialEq, Eq)]
pub enum DeletePlan {
    /// The workspace folder holds only Nexsync content, so the whole folder goes
    WholeFolder,
    /// The folder also holds other files, so only these Nexsync items go
    Items(Vec<String>),
}

/// What was done, so the UI can tell the user about anything left behind
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteOutcome {
    pub whole_folder: bool,
    pub kept: Vec<String>,
}

pub fn plan_delete(names: &[String]) -> DeletePlan {
    let is_ours = |n: &String| OWN_ITEMS.contains(&n.as_str());
    let is_junk = |n: &String| OS_JUNK.contains(&n.to_lowercase().as_str());
    if names.iter().all(|n| is_ours(n) || is_junk(n)) {
        DeletePlan::WholeFolder
    } else {
        DeletePlan::Items(names.iter().filter(|n| is_ours(n)).cloned().collect())
    }
}

/// Refuses anything that is not clearly a Nexsync workspace or that is a folder users keep other things in.
fn check_deletable(dir: &Path, protected: &[PathBuf]) -> Result<(), String> {
    if dir.parent().is_none() || protected.iter().any(|p| p == dir) {
        return Err("That folder is protected and cannot be deleted.".to_string());
    }
    if !dir.join(".nexsync").join("nexsync.db").is_file() {
        return Err("That folder is not a Nexsync workspace.".to_string());
    }
    Ok(())
}

/// Moves the workspace at `path` to the recycle bin
#[tauri::command]
pub fn delete_workspace(app_handle: tauri::AppHandle, path: String) -> Result<DeleteOutcome, String> {
    validate_allowed_root(&app_handle, &path)?;
    let dir = Path::new(&path).canonicalize().map_err(|_| "The workspace folder no longer exists.".to_string())?;
    let protected: Vec<PathBuf> = [dirs::home_dir(), dirs::document_dir(), dirs::desktop_dir()]
        .into_iter()
        .flatten()
        .filter_map(|p| p.canonicalize().ok())
        .collect();
    delete_at(&dir, &protected)
}

/// Moves the workspace folder `dir` to the recycle bin after the safety checks
fn delete_at(dir: &Path, protected: &[PathBuf]) -> Result<DeleteOutcome, String> {
    check_deletable(dir, protected)?;

    let names: Vec<String> = std::fs::read_dir(dir)
        .map_err(|e| e.to_string())?
        .flatten()
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .collect();

    let whole_folder = match plan_delete(&names) {
        DeletePlan::WholeFolder => {
            trash::delete(dir).map_err(|e| format!("Could not move the workspace to the recycle bin: {e}"))?;
            true
        }
        DeletePlan::Items(items) => {
            trash::delete_all(items.iter().map(|n| dir.join(n)))
                .map_err(|e| format!("Could not move the workspace to the recycle bin: {e}"))?;
            false
        }
    };
    let kept = if whole_folder { vec![] } else { names.into_iter().filter(|n| !OWN_ITEMS.contains(&n.as_str())).collect() };
    Ok(DeleteOutcome { whole_folder, kept })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn test_folder_with_only_nexsync_content_goes_whole() {
        assert_eq!(plan_delete(&names(&["notes", "files", "assets", ".nexsync"])), DeletePlan::WholeFolder);
        assert_eq!(plan_delete(&names(&["notes", ".nexsync", "Desktop.ini", ".DS_Store"])), DeletePlan::WholeFolder);
    }

    #[test]
    fn test_other_files_are_left_alone() {
        let plan = plan_delete(&names(&["notes", ".nexsync", "my-thesis.docx", "photos"]));
        assert_eq!(plan, DeletePlan::Items(names(&["notes", ".nexsync"])));
    }

    #[test]
    fn test_only_real_workspaces_can_be_deleted() {
        let dir = std::env::temp_dir().join(format!("nexsync-del-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        assert!(check_deletable(&dir, &[]).is_err(), "a plain folder is not a workspace");

        std::fs::create_dir_all(dir.join(".nexsync")).unwrap();
        std::fs::write(dir.join(".nexsync").join("nexsync.db"), "").unwrap();
        assert!(check_deletable(&dir, &[]).is_ok());
        assert!(check_deletable(&dir, std::slice::from_ref(&dir)).is_err(), "protected folders are refused");
        let _ = std::fs::remove_dir_all(dir);
    }

    fn make_workspace(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("nexsync-bin-{label}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join(".nexsync")).unwrap();
        std::fs::write(dir.join(".nexsync").join("nexsync.db"), "db").unwrap();
        std::fs::create_dir_all(dir.join("notes")).unwrap();
        std::fs::write(dir.join("notes").join("a.md"), "hello").unwrap();
        dir
    }

    #[test]
    #[ignore = "puts a folder in the real recycle bin"]
    fn test_a_workspace_folder_goes_to_the_recycle_bin() {
        let dir = make_workspace("whole");
        let outcome = delete_at(&dir, &[]).unwrap();
        assert!(outcome.whole_folder && outcome.kept.is_empty());
        assert!(!dir.exists(), "the folder should be gone from disk");
    }

    #[test]
    #[ignore = "puts folders in the real recycle bin"]
    fn test_other_files_stay_when_the_folder_holds_more_than_the_workspace() {
        let dir = make_workspace("mixed");
        std::fs::write(dir.join("thesis.docx"), "mine").unwrap();
        let outcome = delete_at(&dir, &[]).unwrap();
        assert!(!outcome.whole_folder);
        assert_eq!(outcome.kept, vec!["thesis.docx".to_string()]);
        assert!(dir.join("thesis.docx").exists());
        assert!(!dir.join("notes").exists() && !dir.join(".nexsync").exists());
        let _ = std::fs::remove_dir_all(dir);
    }
}
