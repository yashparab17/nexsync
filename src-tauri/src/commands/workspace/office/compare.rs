//! Compare for documents: the lines of a saved version of a file (a paragraph, or a table row with a tab between its cells, as the editor's
//! own text lists them), for the editor to compare with the open text. Only reads; the version is opened like any other file.

use std::sync::Arc;
use wordcraft_doc::Block;

use super::documents::lines_of;
use crate::commands::config::validate_allowed_root;
use crate::commands::workspace::helpers::get_workspace_id;
use crate::commands::workspace::versions::{blob_dir, version_row};
use crate::database::WorkspaceDb;

fn text_of(blocks: &[Arc<Block>], out: &mut Vec<String>) {
    for b in blocks {
        match &**b {
            Block::Para(p) => out.push(p.text.replace('\u{fffc}', "")),
            Block::Table(t) => {
                for row in &t.rows {
                    let cells: Vec<String> = row
                        .cells
                        .iter()
                        .map(|c| {
                            let mut lines = Vec::new();
                            text_of(&c.blocks, &mut lines);
                            lines.join(" ")
                        })
                        .collect();
                    out.push(cells.join("\t"));
                }
            }
        }
    }
}

/// The lines of a document, one per paragraph and one per table row
pub fn document_lines(doc: &wordcraft_doc::Document) -> Vec<String> {
    let mut out = Vec::new();
    text_of(&doc.body, &mut out);
    out
}

/// The lines of a kept version of a file, `ext` being the file's own extension
#[tauri::command(async)]
pub fn office_version_lines(app_handle: tauri::AppHandle, path: String, id: i64, ext: String) -> Result<Vec<String>, String> {
    validate_allowed_root(&app_handle, &path)?;
    let db = WorkspaceDb::open_existing(&path)?;
    let ws_id = get_workspace_id(&db)?;
    let version = version_row(&db, &ws_id, id)?;
    let bytes = std::fs::read(blob_dir(&path).join(&version.hash)).map_err(|_| "The saved copy is missing.".to_string())?;
    lines_of(&format!("v.{ext}"), &bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_documents_lines_are_its_paragraphs_and_table_rows() {
        let html = "<p>One</p><table><tr><td>A</td><td>B</td></tr></table><p>Two</p>";
        let doc = wordcraft_formats::import("html", html.as_bytes()).unwrap().unwrap();
        let lines = document_lines(&doc);
        assert!(lines.contains(&"One".to_string()) && lines.contains(&"A\tB".to_string()) && lines.contains(&"Two".to_string()), "{lines:?}");
    }
}
