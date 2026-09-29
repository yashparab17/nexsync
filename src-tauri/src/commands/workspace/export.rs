//! Export: a zip of workspace folders, and single files such as a note as Markdown or PDF.
//! The destination is a path the person picked in the save dialog, and only ever receives what is asked for.

use std::fs::{self, File};
use std::io;
use std::path::{Path, PathBuf};

use base64::prelude::*;

use crate::commands::config::validate_allowed_root;
use crate::commands::path_utils::resolve_workspace_path;

/// Deepest folder level added to a zip
const MAX_DEPTH: usize = 32;

/// Most files a single export may hold, so a runaway tree cannot fill the disk
const MAX_FILES: usize = 50_000;

/// Largest single file written by `write_export_file`
const MAX_EXPORT_BYTES: usize = 50 * 1024 * 1024;

/// A destination is acceptable when it is an absolute path with the wanted extension in an existing folder,
/// and is not inside the app's own `.nexsync` folder
fn check_destination(workspace: &str, dest: &str, extensions: &[&str]) -> Result<PathBuf, String> {
    let dest = Path::new(dest);
    if !dest.is_absolute() {
        return Err("Choose a full file path to save to.".to_string());
    }
    let ext_ok = dest
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| extensions.iter().any(|allowed| e.eq_ignore_ascii_case(allowed)));
    if !ext_ok {
        return Err(format!("The file must end in .{}.", extensions.join(" or .")));
    }
    if dest.is_dir() {
        return Err("That path is a folder.".to_string());
    }
    let parent = dest.parent().ok_or("Invalid destination.")?;
    let parent = parent.canonicalize().map_err(|_| "The destination folder does not exist.".to_string())?;
    if let Ok(internal) = Path::new(workspace).join(".nexsync").canonicalize() {
        if parent.starts_with(internal) {
            return Err("Choose a folder outside the workspace's .nexsync folder.".to_string());
        }
    }
    Ok(dest.to_path_buf())
}

fn add_tree(
    zip: &mut zip::ZipWriter<File>,
    workspace: &Path,
    dir: &Path,
    depth: usize,
    skip: &Path,
    count: &mut usize,
) -> Result<(), String> {
    if depth > MAX_DEPTH {
        return Ok(());
    }
    let options = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    let name_of = |path: &Path| -> String {
        path.strip_prefix(workspace)
            .unwrap_or(path)
            .components()
            .map(|c| c.as_os_str().to_string_lossy().into_owned())
            .collect::<Vec<_>>()
            .join("/")
    };
    let mut entries: Vec<_> = fs::read_dir(dir).map_err(|e| e.to_string())?.filter_map(Result::ok).collect();
    entries.sort_by_key(|e| e.file_name());
    if entries.is_empty() {
        zip.add_directory(format!("{}/", name_of(dir)), options).map_err(|e| e.to_string())?;
    }
    for entry in entries {
        if entry.file_name().to_string_lossy().starts_with('.') {
            continue;
        }
        let path = entry.path();
        let Ok(kind) = entry.file_type() else { continue };
        if kind.is_dir() {
            add_tree(zip, workspace, &path, depth + 1, skip, count)?;
        } else if kind.is_file() && path != skip {
            *count += 1;
            if *count > MAX_FILES {
                return Err(format!("More than {MAX_FILES} files: too many to export at once."));
            }
            zip.start_file(name_of(&path), options).map_err(|e| e.to_string())?;
            io::copy(&mut File::open(&path).map_err(|e| e.to_string())?, zip).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// Writes the workspace folders `roots` into a zip at `dest` and returns how many files it holds.
/// Hidden files and symlinks are left out, and so is everything under `.nexsync`.
pub fn write_zip(workspace: &str, roots: &[String], dest: &Path) -> Result<usize, String> {
    let canonical = Path::new(workspace).canonicalize().map_err(|e| e.to_string())?;
    let mut targets = Vec::new();
    for root in roots {
        let rel = root.trim_matches('/');
        if rel.is_empty() || rel.split('/').any(|part| part.starts_with('.')) {
            return Err(format!("Cannot export {root}."));
        }
        let path = resolve_workspace_path(workspace, rel)?;
        if path.is_dir() {
            targets.push(path);
        }
    }
    if targets.is_empty() {
        return Err("There is nothing to export yet.".to_string());
    }

    let file = File::create(dest).map_err(|e| format!("Could not create the file: {e}"))?;
    let mut zip = zip::ZipWriter::new(file);
    let skip = dest.canonicalize().unwrap_or_else(|_| dest.to_path_buf());
    let mut count = 0;
    let result = targets
        .iter()
        .try_for_each(|dir| add_tree(&mut zip, &canonical, dir, 0, &skip, &mut count))
        .and_then(|_| zip.finish().map(|_| ()).map_err(|e| e.to_string()));
    if let Err(err) = result {
        let _ = fs::remove_file(dest);
        return Err(err);
    }
    Ok(count)
}

// ────────────────────────────
// Tauri commands — Export
// ────────────────────────────

/// Exports workspace folders as a zip, for a workspace backup or a snapshot of the code in `editor`
#[tauri::command]
pub fn export_zip(app_handle: tauri::AppHandle, path: String, roots: Vec<String>, dest: String) -> Result<usize, String> {
    validate_allowed_root(&app_handle, &path)?;
    if roots.is_empty() || roots.len() > 32 {
        return Err("Choose what to export.".to_string());
    }
    let dest = check_destination(&path, &dest, &["zip"])?;
    write_zip(&path, &roots, &dest)
}

/// Saves a finished export, such as a note as Markdown or PDF, to the place the person chose
#[tauri::command]
pub fn write_export_file(app_handle: tauri::AppHandle, path: String, dest: String, content_base64: String) -> Result<(), String> {
    validate_allowed_root(&app_handle, &path)?;
    let dest = check_destination(&path, &dest, &["md", "pdf", "txt"])?;
    let bytes = BASE64_STANDARD.decode(content_base64).map_err(|e| format!("Invalid export data: {e}"))?;
    if bytes.len() > MAX_EXPORT_BYTES {
        return Err("This export is too large.".to_string());
    }
    fs::write(dest, bytes).map_err(|e| format!("Could not save the file: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;
    use uuid::Uuid;

    fn names(zip_path: &Path) -> Vec<String> {
        let mut archive = zip::ZipArchive::new(File::open(zip_path).unwrap()).unwrap();
        let mut names: Vec<String> = (0..archive.len()).map(|i| archive.by_index(i).unwrap().name().to_string()).collect();
        names.sort();
        names
    }

    #[test]
    fn zips_nested_folders_without_hidden_files_or_itself() {
        let dir = std::env::temp_dir().join(format!("nexsync-export-{}", Uuid::new_v4()));
        fs::create_dir_all(dir.join("editor/src")).unwrap();
        fs::create_dir_all(dir.join("editor/empty")).unwrap();
        fs::create_dir_all(dir.join(".nexsync")).unwrap();
        for file in ["editor/main.py", "editor/src/app.py", "editor/.env", ".nexsync/nexsync.db"] {
            fs::write(dir.join(file), file).unwrap();
        }
        let ws = dir.to_string_lossy().to_string();
        let dest = dir.join("editor").join("snapshot.zip");

        let count = write_zip(&ws, &["editor".to_string()], &dest).unwrap();
        assert_eq!(count, 2);
        assert_eq!(names(&dest), ["editor/empty/", "editor/main.py", "editor/src/app.py"]);

        let mut archive = zip::ZipArchive::new(File::open(&dest).unwrap()).unwrap();
        let mut text = String::new();
        archive.by_name("editor/src/app.py").unwrap().read_to_string(&mut text).unwrap();
        assert_eq!(text, "editor/src/app.py");

        // Hidden folders and the internal folder cannot be requested, and a missing folder is an error
        assert!(write_zip(&ws, &[".nexsync".to_string()], &dest).is_err());
        assert!(write_zip(&ws, &["nothing".to_string()], &dest).is_err());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn destinations_are_checked() {
        let dir = std::env::temp_dir().join(format!("nexsync-dest-{}", Uuid::new_v4()));
        fs::create_dir_all(dir.join(".nexsync")).unwrap();
        let ws = dir.to_string_lossy().to_string();
        assert!(check_destination(&ws, dir.join("a.zip").to_str().unwrap(), &["zip"]).is_ok());
        assert!(check_destination(&ws, "relative.zip", &["zip"]).is_err());
        assert!(check_destination(&ws, dir.join("a.exe").to_str().unwrap(), &["zip"]).is_err());
        assert!(check_destination(&ws, dir.join("missing").join("a.zip").to_str().unwrap(), &["zip"]).is_err());
        assert!(check_destination(&ws, dir.join(".nexsync").join("a.zip").to_str().unwrap(), &["zip"]).is_err());
        let _ = fs::remove_dir_all(&dir);
    }
}
