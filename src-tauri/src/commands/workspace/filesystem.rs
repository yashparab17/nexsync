use std::fs;
use chrono::{DateTime, Utc};
use base64::prelude::*;
use crate::commands::config::validate_allowed_root;
use super::helpers::validate_workspace_item_name;
use super::models::WorkspaceFile;

/// Maximum file size for text file write and read operations (10 MB)
const MAX_FILE_SIZE: u64 = 10 * 1024 * 1024;

/// Maximum binary asset file size for preview/upload operations (50 MB)
const MAX_BINARY_FILE_SIZE: u64 = 50 * 1024 * 1024;

// ────────────────────────────
// Tauri commands — Filesystem
// ────────────────────────────

/// Lists files and directories in a workspace content subdirectory
#[tauri::command(async)]
pub fn list_workspace_files(
    app_handle: tauri::AppHandle,
    path: String,
    subdir: String,
) -> Result<Vec<WorkspaceFile>, String> {
    validate_allowed_root(&app_handle, &path)?;
    let clean_sub = subdir.trim().trim_matches('/');
    let target_sub = if clean_sub.is_empty() { "." } else { clean_sub };
    let dir = crate::commands::path_utils::resolve_workspace_path(&path, target_sub)?;
    if !dir.exists() {
        return Ok(vec![]);
    }

    let entries = fs::read_dir(&dir).map_err(|_| "Failed to list directory.".to_string())?;
    let mut files = vec![];
    let root = clean_sub.split('/').next().unwrap_or("").to_string();
    let mut rules = super::syncignore::Rules::load(std::path::Path::new(&path));

    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let file_name = entry.file_name().to_string_lossy().to_string();
        
        // Hide the internal .nexsync directory and hidden files; inside a project, dotfiles are part of it (except Git's own folder)
        if super::syncignore::hidden_name_skipped(&root, &file_name) || file_name == ".git" {
            continue;
        }

        let metadata = entry
            .path()
            .symlink_metadata()
            .map_err(|_| format!("Failed to read metadata for {file_name}."))?;
        
        // Skip unsafe symlinks
        if metadata.is_symlink() {
            continue;
        }

        let modified_at = metadata
            .modified()
            .ok()
            .map(|t| {
                let dt: DateTime<Utc> = t.into();
                dt.to_rfc3339()
            })
            .unwrap_or_default();
            
        let item_path = if clean_sub.is_empty() || clean_sub == "." {
            format!("/{}", file_name)
        } else {
            format!("/{}/{}", clean_sub, file_name)
        };

        let ignored = rules.ignored(item_path.trim_start_matches('/'), metadata.is_dir());
        files.push(WorkspaceFile {
            name: file_name.clone(),
            path: item_path,
            is_dir: metadata.is_dir(),
            size: metadata.len(),
            modified_at,
            ignored,
        });
    }

    // Sort folders first, then alphabetically
    files.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then(a.name.cmp(&b.name)));
    Ok(files)
}

/// Creates a new empty file or folder in a workspace directory
#[tauri::command(async)]
pub fn create_workspace_item(
    app_handle: tauri::AppHandle,
    path: String,
    rel_path: String,
    name: String,
    is_dir: bool,
) -> Result<(), String> {
    validate_allowed_root(&app_handle, &path)?;
    validate_workspace_item_name(&name)?;
    
    let base = crate::commands::path_utils::resolve_workspace_path(&path, &rel_path)?;
    let target = base.join(&name);
    
    if target.exists() {
        return Err(format!("An item named `{name}` already exists here."));
    }
    
    if is_dir {
        fs::create_dir_all(&target).map_err(|e| e.to_string())?;
    } else {
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        if target.metadata().map(|m| m.len()).unwrap_or(0) > MAX_FILE_SIZE {
            return Err("File size too large for pre-creation check.".to_string());
        }
        fs::write(&target, "").map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Reads text contents from a workspace file
#[tauri::command(async)]
pub fn read_workspace_file(app_handle: tauri::AppHandle, path: String, rel_path: String) -> Result<String, String> {
    validate_allowed_root(&app_handle, &path)?;

    let target = crate::commands::path_utils::resolve_workspace_path(&path, &rel_path)?;
    
    if !target.exists() {
        return Err(format!("File not found: /{rel_path}"));
    }
    if target.is_dir() {
        return Err(format!("Path is a directory, not a file: /{rel_path}"));
    }

    let file_len = target.metadata().map(|m| m.len()).unwrap_or(0);
    if file_len > MAX_FILE_SIZE {
        return Err(format!("File too large to read ({} bytes), maximum is {} bytes.", file_len, MAX_FILE_SIZE));
    }

    fs::read_to_string(&target).map_err(|e| e.to_string())
}

/// Writes text contents to a workspace file
#[tauri::command(async)]
pub fn write_workspace_file(app_handle: tauri::AppHandle, path: String, rel_path: String, content: String) -> Result<(), String> {
    validate_allowed_root(&app_handle, &path)?;

    let target = crate::commands::path_utils::resolve_workspace_path(&path, &rel_path)?;
    
    if content.len() as u64 > MAX_FILE_SIZE {
        return Err(format!("File too large ({} bytes), maximum is {} bytes.", content.len(), MAX_FILE_SIZE));
    }

    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    fs::write(&target, content.as_bytes()).map_err(|e| e.to_string())?;
    // History is a convenience; a save never fails because of it
    let _ = super::versions::record_bytes(&path, &rel_path, content.as_bytes(), "save", None);
    Ok(())
}

/// Renames a workspace file or directory
#[tauri::command(async)]
pub fn rename_workspace_item(
    app_handle: tauri::AppHandle,
    path: String,
    rel_path: String,
    new_name: String,
) -> Result<(), String> {
    validate_allowed_root(&app_handle, &path)?;
    validate_workspace_item_name(&new_name)?;
    
    let target = crate::commands::path_utils::resolve_workspace_path(&path, &rel_path)?;
    let parent = target.parent().ok_or("Invalid item path.")?;
    let new_path = parent.join(&new_name);

    let canonical_workspace = std::path::Path::new(&path)
        .canonicalize()
        .map_err(|e| format!("Failed to canonicalize workspace path: {}", e))?;
    if !parent.starts_with(&canonical_workspace) && parent != canonical_workspace {
        return Err("Path traversal detected: renamed item escapes workspace directory".to_string());
    }

    if !target.exists() {
        return Err(format!("Item not found: /{rel_path}"));
    }
    if new_path.exists() {
        return Err(format!("An item named `{new_name}` already exists here."));
    }
    fs::rename(&target, &new_path).map_err(|e| e.to_string())?;
    let new_rel = match rel_path.trim_matches('/').rsplit_once('/') {
        Some((dir, _)) => format!("{dir}/{new_name}"),
        None => new_name.clone(),
    };
    let _ = super::versions::rename_path(&path, &rel_path, &new_rel);
    Ok(())
}

/// Moves a file or directory into the workspace trash
#[tauri::command(async)]
pub fn delete_workspace_item(app_handle: tauri::AppHandle, path: String, rel_path: String) -> Result<(), String> {
    validate_allowed_root(&app_handle, &path)?;

    let target = crate::commands::path_utils::resolve_workspace_path(&path, &rel_path)?;
    if !target.exists() {
        return Err(format!("Item not found: /{rel_path}"));
    }
    super::trash::move_to_trash(&path, &target, rel_path.trim_matches('/')).map_err(|e| e.to_string())
}

/// Reads a workspace binary file and returns its base64-encoded string
#[tauri::command(async)]
pub fn read_workspace_binary_file(
    app_handle: tauri::AppHandle,
    path: String,
    rel_path: String,
) -> Result<String, String> {
    validate_allowed_root(&app_handle, &path)?;

    let target = crate::commands::path_utils::resolve_workspace_path(&path, &rel_path)?;
    if !target.exists() || target.is_dir() {
        return Err(format!("File not found: /{rel_path}"));
    }

    let file_len = target.metadata().map(|m| m.len()).unwrap_or(0);
    if file_len > MAX_BINARY_FILE_SIZE {
        return Err(format!(
            "File size exceeds maximum allowed size ({} MB).",
            MAX_BINARY_FILE_SIZE / (1024 * 1024)
        ));
    }

    let bytes = fs::read(&target).map_err(|e| e.to_string())?;
    Ok(BASE64_STANDARD.encode(&bytes))
}

/// Writes binary base64 data to a workspace file
#[tauri::command(async)]
pub fn write_workspace_binary_file(
    app_handle: tauri::AppHandle,
    path: String,
    rel_path: String,
    base64_data: String,
) -> Result<(), String> {
    validate_allowed_root(&app_handle, &path)?;

    let bytes = BASE64_STANDARD
        .decode(&base64_data)
        .map_err(|e| format!("Invalid base64 payload: {}", e))?;

    if bytes.len() as u64 > MAX_BINARY_FILE_SIZE {
        return Err(format!(
            "Payload exceeds maximum allowed size ({} MB).",
            MAX_BINARY_FILE_SIZE / (1024 * 1024)
        ));
    }

    let target = crate::commands::path_utils::resolve_workspace_path(&path, &rel_path)?;
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    fs::write(&target, &bytes).map_err(|e| e.to_string())?;
    let _ = super::versions::record_bytes(&path, &rel_path, &bytes, "save", None);
    Ok(())
}

/// Imports an external file from disk into the workspace assets/ folder
#[tauri::command(async)]
pub fn import_asset_from_path(
    app_handle: tauri::AppHandle,
    workspace_path: String,
    source_path: String,
) -> Result<WorkspaceFile, String> {
    validate_allowed_root(&app_handle, &workspace_path)?;

    let src = std::path::Path::new(&source_path);
    if !src.exists() || !src.is_file() {
        return Err("Source file does not exist or is not a file.".to_string());
    }

    let src_len = src.metadata().map(|m| m.len()).unwrap_or(0);
    if src_len > MAX_BINARY_FILE_SIZE {
        return Err(format!(
            "File size ({} MB) exceeds maximum allowed upload size ({} MB).",
            src_len / (1024 * 1024),
            MAX_BINARY_FILE_SIZE / (1024 * 1024)
        ));
    }

    let file_stem = src
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("asset");
    let extension = src
        .extension()
        .and_then(|s| s.to_str())
        .map(|e| format!(".{}", e))
        .unwrap_or_default();

    let assets_dir = crate::commands::path_utils::resolve_workspace_path(&workspace_path, "assets")?;
    if !assets_dir.exists() {
        fs::create_dir_all(&assets_dir).map_err(|e| e.to_string())?;
    }

    // Sanitize file stem and avoid collisions
    let sanitized_stem: String = file_stem
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect();

    let mut final_name = format!("{}{}", sanitized_stem, extension);
    let mut counter = 1;
    while assets_dir.join(&final_name).exists() {
        final_name = format!("{}_{}{}", sanitized_stem, counter, extension);
        counter += 1;
    }

    let dest = assets_dir.join(&final_name);
    fs::copy(src, &dest).map_err(|e| format!("Failed to copy file: {}", e))?;
    let _ = super::versions::record_file(&workspace_path, &format!("assets/{final_name}"), &dest, "import");

    let metadata = dest.metadata().map_err(|e| e.to_string())?;
    let modified_at = metadata
        .modified()
        .ok()
        .map(|t| {
            let dt: DateTime<Utc> = t.into();
            dt.to_rfc3339()
        })
        .unwrap_or_default();

    Ok(WorkspaceFile {
        name: final_name.clone(),
        path: format!("/assets/{}", final_name),
        is_dir: false,
        ignored: false,
        size: metadata.len(),
        modified_at,
    })
}

// ────────────────────────────
// Search
// ────────────────────────────

/// A workspace file with its text, for the header search
#[derive(serde::Serialize)]
pub struct SearchFile {
    pub name: String,
    /// Like list_workspace_files: starts with `/`
    pub path: String,
    pub size: u64,
    /// Lower-case text of small text files, otherwise empty
    pub body: String,
}

const SEARCH_MAX_DEPTH: usize = 5;
const SEARCH_MAX_FILES: usize = 20_000;
const SEARCH_MAX_TEXT_FILES: usize = 300;
const SEARCH_MAX_TEXT_BYTES: u64 = 256 * 1024;
/// Office files whose text the search reads (unzipped once, then kept until the file changes)
const SEARCH_MAX_OFFICE_FILES: usize = 500;
const SEARCH_MAX_OFFICE_BYTES: u64 = 50 * 1024 * 1024;
const SEARCH_MAX_PART_BYTES: u64 = 8 * 1024 * 1024;
const SEARCH_OFFICE_EXTENSIONS: &[&str] = &["docx", "xlsx", "pptx"];

type OfficeKey = (u64, Option<std::time::SystemTime>);
static OFFICE_TEXT: std::sync::Mutex<Option<std::collections::HashMap<std::path::PathBuf, (OfficeKey, String)>>> = std::sync::Mutex::new(None);

/// The words of the XML of one part: tags are dropped, and the ends of paragraphs, cells and strings become spaces
fn xml_text(xml: &str, out: &mut String) {
    let mut rest = xml;
    while let Some(open) = rest.find('<') {
        push_unescaped(&rest[..open], out);
        let Some(close) = rest[open..].find('>') else { return };
        let tag = &rest[open + 1..open + close];
        if matches!(tag, "/w:p" | "/a:p" | "/si" | "/w:tc" | "/a:tc") || tag.starts_with("w:br") || tag.starts_with("w:tab") {
            out.push(' ');
        }
        rest = &rest[open + close + 1..];
    }
    push_unescaped(rest, out);
}

fn push_unescaped(text: &str, out: &mut String) {
    out.push_str(&text.replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&apos;", "'").replace("&amp;", "&"));
}

/// The lower-case text of a .docx, .xlsx or .pptx: the body, the shared strings, or the slides; empty when it cannot be read
fn office_text(path: &std::path::Path, ext: &str) -> String {
    let Ok(file) = fs::File::open(path) else { return String::new() };
    let Ok(mut zip) = zip::ZipArchive::new(file) else { return String::new() };
    let wanted = |name: &str| match ext {
        "docx" => name == "word/document.xml",
        "xlsx" => name == "xl/sharedStrings.xml",
        _ => name.starts_with("ppt/slides/slide") && name.ends_with(".xml"),
    };
    let mut text = String::new();
    for i in 0..zip.len().min(2_000) {
        let Ok(part) = zip.by_index(i) else { continue };
        if !wanted(part.name()) || part.size() > SEARCH_MAX_PART_BYTES {
            continue;
        }
        let mut xml = String::new();
        // Read no more than the limit, whatever the part says it holds
        if std::io::Read::read_to_string(&mut std::io::Read::take(part, SEARCH_MAX_PART_BYTES), &mut xml).is_ok() {
            xml_text(&xml, &mut text);
        }
        if text.len() >= SEARCH_MAX_TEXT_BYTES as usize {
            break;
        }
    }
    let mut text = text.to_lowercase();
    let mut cut = (SEARCH_MAX_TEXT_BYTES as usize).min(text.len());
    while !text.is_char_boundary(cut) {
        cut -= 1;
    }
    text.truncate(cut);
    text
}

/// `office_text`, from the cache while the file's size and time are the same
fn cached_office_text(path: &std::path::Path, ext: &str, meta: &fs::Metadata) -> String {
    let key: OfficeKey = (meta.len(), meta.modified().ok());
    let mut guard = OFFICE_TEXT.lock().unwrap_or_else(|e| e.into_inner());
    let cache = guard.get_or_insert_with(Default::default);
    if let Some((k, text)) = cache.get(path) {
        if *k == key {
            return text.clone();
        }
    }
    let text = office_text(path, ext);
    cache.insert(path.to_path_buf(), (key, text.clone()));
    text
}

const SEARCH_TEXT_EXTENSIONS: &[&str] = &[
    "md", "markdown", "txt", "json", "csv", "toml", "yml", "yaml", "html", "htm", "css", "js", "ts", "tsx", "jsx", "rs",
];

fn search_walk(dir: &std::path::Path, rel: &str, depth: usize, out: &mut Vec<SearchFile>, text_files: &mut usize, office_files: &mut usize, rules: &mut super::syncignore::Rules) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        if out.len() >= SEARCH_MAX_FILES {
            return;
        }
        let Some(name) = entry.file_name().to_str().map(str::to_owned) else { continue };
        let Ok(meta) = entry.path().symlink_metadata() else { continue };
        let path = format!("{rel}/{name}");
        let root = path.split('/').nth(1).unwrap_or("");
        if super::syncignore::hidden_name_skipped(root, &name) || meta.is_symlink() || rules.ignored(path.trim_start_matches('/'), meta.is_dir()) {
            continue;
        }
        if meta.is_dir() {
            if depth < SEARCH_MAX_DEPTH {
                search_walk(&entry.path(), &path, depth + 1, out, text_files, office_files, rules);
            }
            continue;
        }
        let is_text = std::path::Path::new(&name)
            .extension()
            .and_then(|e| e.to_str())
            .is_some_and(|e| SEARCH_TEXT_EXTENSIONS.contains(&e.to_ascii_lowercase().as_str()));
        let ext = std::path::Path::new(&name).extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase).unwrap_or_default();
        let body = if SEARCH_OFFICE_EXTENSIONS.contains(&ext.as_str()) && meta.len() <= SEARCH_MAX_OFFICE_BYTES && *office_files < SEARCH_MAX_OFFICE_FILES {
            *office_files += 1;
            cached_office_text(&entry.path(), &ext, &meta)
        } else if is_text && meta.len() <= SEARCH_MAX_TEXT_BYTES && *text_files < SEARCH_MAX_TEXT_FILES {
            *text_files += 1;
            fs::read_to_string(entry.path()).map(|t| t.to_lowercase()).unwrap_or_default()
        } else {
            String::new()
        };
        out.push(SearchFile { name, path, size: meta.len(), body });
    }
}

/// Every file in the workspace with the text of the small text ones (and, with `with_office`, of .docx, .xlsx and .pptx files), in one call
#[tauri::command(async)]
pub fn search_workspace_files(app_handle: tauri::AppHandle, path: String, with_office: Option<bool>) -> Result<Vec<SearchFile>, String> {
    validate_allowed_root(&app_handle, &path)?;
    let root = crate::commands::path_utils::resolve_workspace_path(&path, ".")?;
    let mut files = Vec::new();
    let mut rules = super::syncignore::Rules::load(&root);
    // The pages that only list files do not pay for unzipping the Office ones
    let mut office_files = if with_office == Some(true) { 0 } else { SEARCH_MAX_OFFICE_FILES };
    search_walk(&root, "", 0, &mut files, &mut 0, &mut office_files, &mut rules);
    Ok(files)
}

#[cfg(test)]
mod office_search_tests {
    use super::*;
    use std::io::Write;

    fn docx(dir: &std::path::Path, body: &str) -> std::path::PathBuf {
        let path = dir.join("a.docx");
        let mut z = zip::ZipWriter::new(fs::File::create(&path).unwrap());
        z.start_file("word/document.xml", zip::write::SimpleFileOptions::default()).unwrap();
        z.write_all(body.as_bytes()).unwrap();
        z.finish().unwrap();
        path
    }

    #[test]
    fn the_words_of_a_docx_are_found_and_kept_until_the_file_changes() {
        let dir = std::env::temp_dir().join(format!("nx-search-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = docx(&dir, "<w:p><w:r><w:t>Hel</w:t></w:r><w:r><w:t>lo &amp; Wor</w:t></w:r></w:p><w:p><w:t>ld</w:t></w:p>");
        let meta = fs::metadata(&path).unwrap();
        assert_eq!(cached_office_text(&path, "docx", &meta), "hello & wor ld ");
        // Not a zip: nothing, and no panic
        fs::write(&path, b"nope").unwrap();
        assert_eq!(office_text(&path, "docx"), "");
        fs::remove_dir_all(&dir).ok();
    }
}
