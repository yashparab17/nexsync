//! Office documents (Phase 21, step 1): opening a .docx, .odt, .rtf, .md, .html or .txt file as an editable document, writing one
//! back out, and saying what a file holds before it is shared.
//!
//! The reading and writing is done by the format crates of WordCraft (MIT OR Apache-2.0, pinned by commit, see
//! THIRD_PARTY_NOTICES.md). A document lives in the workspace as a shared rich-text document; the file is a copy that goes in
//! and out. Coming in, the file becomes HTML for the editor; going out, the editor's HTML becomes the file. So what is kept is
//! what the editor can hold: text, headings, lists, tables, links, images and character styles. Page layout (margins, columns,
//! headers, footers), styles by name, footnotes, fields and comments are not carried into the editor yet, and `import` lists what it
//! saw and left out so a person is told, not surprised.
//!
//! A file from another person is hostile input. It is size-limited, a zip package is checked for a zip bomb before any part is
//! unpacked, nothing it points at is fetched, a macro is reported and never run, the work runs on its own thread so a panic in a
//! parser shows as an error and not a closed app, and the format crates have their own limits on nesting and element counts.

use std::{
    fs,
    io::Read,
    panic::{catch_unwind, AssertUnwindSafe},
};

use serde::{Deserialize, Serialize};

use crate::commands::{config::validate_allowed_root, path_utils::resolve_workspace_path};

/// A file bigger than this is not opened
pub const MAX_FILE_BYTES: u64 = 64 * 1024 * 1024;
const MAX_ENTRIES: usize = 20_000;
const MAX_UNPACKED: u64 = 512 * 1024 * 1024;
/// A part that is this many times bigger unpacked than packed (and not small) is a bomb
const MAX_RATIO: u64 = 1_000;

pub const IMPORTABLE: &[&str] = &["docx", "docm", "dotx", "dotm", "doc", "dot", "odt", "rtf", "md", "markdown", "html", "htm", "txt", "text"];
pub const EXPORTABLE: &[&str] = &["docx", "odt", "rtf", "md", "html", "txt", "tex", "pdf"];

/// What a file holds that a person should know before sharing it, and what was not carried into the editor
#[derive(Serialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Inspect {
    pub words: usize,
    pub images: usize,
    pub comments: usize,
    pub revisions: usize,
    /// Everyone named in the file's properties, comments and tracked changes
    pub people: Vec<String>,
    pub title: String,
    pub created: String,
    pub modified: String,
    /// The file carries a macro project (it is kept in the file and never run)
    pub macros: bool,
    /// Charts, diagrams (SmartArt), embedded objects
    pub embedded: Vec<String>,
    /// Addresses the file points at outside itself (links, linked pictures); none is fetched
    pub external: Vec<String>,
    /// Parts of the file that did not come into the editor
    pub left_out: Vec<String>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Imported {
    /// The document body as HTML for the editor
    pub html: String,
    pub title: String,
    pub inspect: Inspect,
}

/// How a document sits on paper: what the Layout tab and the page set-up say, written into the file
#[derive(Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Layout {
    /// The page in points, already turned on its side when it is landscape
    pub width: f32,
    pub height: f32,
    pub landscape: bool,
    pub top: f32,
    pub right: f32,
    pub bottom: f32,
    pub left: f32,
    /// 1 to 3
    pub columns: u32,
    /// Line spacing as a multiple of the text size; 0 leaves it as it is
    pub spacing: f32,
    pub header: String,
    pub footer: String,
    /// "Page 1" in the footer
    pub page_numbers: bool,
}

fn line_block(text: &str, page_number: bool, align: wordcraft_doc::Align) -> std::sync::Arc<wordcraft_doc::Block> {
    let mut p = wordcraft_doc::Paragraph::with_text(text, wordcraft_doc::CharProps::default());
    p.props.align = Some(align);
    if page_number {
        if !p.text.is_empty() {
            let end = p.text.len();
            let _ = p.insert_object(end, wordcraft_doc::InlineObject::Field { instr: "PAGE".into(), result: "1".into(), locked: false, dirty: false, code: false, form: String::new() }, &wordcraft_doc::CharProps::default());
        } else {
            let _ = p.insert_object(0, wordcraft_doc::InlineObject::Field { instr: "PAGE".into(), result: "1".into(), locked: false, dirty: false, code: false, form: String::new() }, &wordcraft_doc::CharProps::default());
        }
    }
    wordcraft_doc::para_block(p)
}

/// Writes a layout into a document: paper, margins, columns, line spacing, a header and a footer
pub fn apply_layout(doc: &mut wordcraft_doc::Document, l: &Layout) {
    use wordcraft_doc::{Align, PartKind};
    let ok = |v: f32, lo: f32, hi: f32| v.is_finite() && v >= lo && v <= hi;
    let s = &mut doc.last_section;
    if ok(l.width, 72.0, 2000.0) && ok(l.height, 72.0, 2000.0) {
        s.page_w = l.width;
        s.page_h = l.height;
        s.landscape = l.landscape;
    }
    for (slot, v) in [(&mut s.margin_top, l.top), (&mut s.margin_bottom, l.bottom), (&mut s.margin_left, l.left), (&mut s.margin_right, l.right)] {
        if ok(v, 0.0, 500.0) {
            *slot = v;
        }
    }
    if (1..=3).contains(&l.columns) {
        s.columns.count = l.columns;
    }
    if ok(l.spacing, 1.0, 3.0) && l.spacing > 0.0 {
        for b in doc.body.iter_mut() {
            if let wordcraft_doc::Block::Para(p) = std::sync::Arc::make_mut(b) {
                p.props.line_spacing = Some(wordcraft_doc::props::LineSpacing::Multiple(l.spacing));
            }
        }
    }
    let header = l.header.trim();
    if !header.is_empty() {
        let id = doc.add_part(PartKind::Header, vec![line_block(&header.chars().take(200).collect::<String>(), false, Align::Left)]);
        doc.last_section.headers.default = Some(id);
    }
    let footer = l.footer.trim();
    if !footer.is_empty() || l.page_numbers {
        let text: String = footer.chars().take(200).collect();
        let text = if l.page_numbers && !text.is_empty() { format!("{text}  Page ") } else if l.page_numbers { "Page ".to_string() } else { text };
        let id = doc.add_part(PartKind::Footer, vec![line_block(&text, l.page_numbers, if l.page_numbers { Align::Center } else { Align::Left })]);
        doc.last_section.footers.default = Some(id);
    }
}

/// Why a file cannot be opened, in words for a person; `password` is true when a password would open it
#[derive(Debug, PartialEq)]
pub struct Refusal {
    pub message: String,
    pub password: bool,
}

impl Refusal {
    fn text(m: impl Into<String>) -> Self {
        Refusal { message: m.into(), password: false }
    }
}

/// Looks at a zip package without unpacking it: how many parts, how big they say they are, and how much they squeeze
pub fn check_package(bytes: &[u8]) -> Result<Vec<String>, String> {
    let mut zip = zip::ZipArchive::new(std::io::Cursor::new(bytes)).map_err(|_| "This is not a readable Office package.".to_string())?;
    if zip.len() > MAX_ENTRIES {
        return Err("This file has too many parts.".to_string());
    }
    let (mut total, mut names) = (0u64, Vec::with_capacity(zip.len()));
    for i in 0..zip.len() {
        let f = zip.by_index_raw(i).map_err(|_| "This is not a readable Office package.".to_string())?;
        total = total.saturating_add(f.size());
        if f.size() > 1024 * 1024 && f.compressed_size() > 0 && f.size() / f.compressed_size() > MAX_RATIO {
            return Err("This file unpacks to far more than it is. It was not opened.".to_string());
        }
        names.push(f.name().to_string());
    }
    if total > MAX_UNPACKED {
        return Err("This file unpacks to more than 512 MB. It was not opened.".to_string());
    }
    Ok(names)
}

/// The addresses a package's relationship files point outside it
fn external_targets(bytes: &[u8], names: &[String]) -> Vec<String> {
    let Ok(mut zip) = zip::ZipArchive::new(std::io::Cursor::new(bytes)) else { return Vec::new() };
    let mut out: Vec<String> = Vec::new();
    for n in names.iter().filter(|n| n.ends_with(".rels")) {
        let Ok(f) = zip.by_name(n) else { continue };
        let mut text = String::new();
        if f.take(2 * 1024 * 1024).read_to_string(&mut text).is_err() {
            continue;
        }
        // Each Relationship element with TargetMode="External"
        for el in text.split("<Relationship ").skip(1) {
            let el = el.split('>').next().unwrap_or("");
            if !el.contains("TargetMode=\"External\"") {
                continue;
            }
            if let Some(t) = el.split("Target=\"").nth(1).and_then(|r| r.split('"').next()) {
                if !out.iter().any(|o| o == t) && out.len() < 50 {
                    out.push(t.chars().take(200).collect());
                }
            }
        }
    }
    out
}

fn inspect_of(doc: &wordcraft_doc::Document) -> Inspect {
    let mut people: Vec<String> = Vec::new();
    let mut add = |p: &str| {
        let p = p.trim();
        if !p.is_empty() && !people.iter().any(|x| x == p) {
            people.push(p.to_string());
        }
    };
    add(&doc.core.creator);
    add(&doc.core.last_modified_by);
    doc.comments.values().for_each(|c| add(&c.author));
    doc.revisions.iter().for_each(|r| add(&r.author));
    Inspect {
        words: doc.word_count(),
        images: doc.media.len(),
        comments: doc.comments.len(),
        revisions: doc.revisions.len(),
        people,
        title: doc.core.title.clone(),
        created: doc.core.created.clone(),
        modified: doc.core.modified.clone(),
        ..Default::default()
    }
}

/// The inside of `<body>` of the HTML a document exports
fn body_of(html: &str) -> String {
    let start = html.find("<body").and_then(|i| html[i..].find('>').map(|j| i + j + 1)).unwrap_or(0);
    let end = html.rfind("</body>").unwrap_or(html.len());
    html[start..end.max(start)].trim().to_string()
}

fn ext_of(name: &str) -> String {
    name.rsplit('.').next().unwrap_or("").to_ascii_lowercase()
}

/// Opens a file's bytes as an editable document. `name` gives the format by its extension.
pub fn import(name: &str, bytes: &[u8], password: Option<&str>) -> Result<Imported, Refusal> {
    if bytes.len() as u64 > MAX_FILE_BYTES {
        return Err(Refusal::text("This file is bigger than 64 MB. It was not opened."));
    }
    let ext = ext_of(name);
    if !IMPORTABLE.contains(&ext.as_str()) {
        return Err(Refusal::text(format!("Nexsync cannot open .{ext} files as documents yet. It opens {}.", IMPORTABLE.join(", "))));
    }
    let package = matches!(ext.as_str(), "docx" | "docm" | "dotx" | "dotm" | "odt");
    let names = if package && !bytes.starts_with(&[0xD0, 0xCF, 0x11, 0xE0]) { check_package(bytes).map_err(Refusal::text)? } else { Vec::new() };
    // A parser that panics on a hostile file must not take the app with it
    let parsed = catch_unwind(AssertUnwindSafe(|| -> Result<wordcraft_doc::Document, Refusal> {
        match ext.as_str() {
            "docx" | "docm" | "dotx" | "dotm" => wordcraft_docx::read_with_password(bytes, password).map_err(|e| match e {
                wordcraft_docx::DocxError::PasswordRequired => Refusal { message: e.to_string(), password: true },
                wordcraft_docx::DocxError::WrongPassword => Refusal { message: e.to_string(), password: true },
                other => Refusal::text(format!("This document could not be read: {other}")),
            }),
            "doc" | "dot" => wordcraft_docbin::read_with_password(bytes, password).map_err(|e| match e {
                wordcraft_docbin::DocbinError::PasswordRequired | wordcraft_docbin::DocbinError::WrongPassword => Refusal { message: e.to_string(), password: true },
                other => Refusal::text(format!("This document could not be read: {other}")),
            }),
            other => match wordcraft_formats::import(other, bytes) {
                Some(Ok(d)) => Ok(d),
                Some(Err(e)) => Err(Refusal::text(format!("This document could not be read: {e}"))),
                None => Err(Refusal::text("This kind of file is not supported.")),
            },
        }
    }));
    let doc = match parsed {
        Ok(r) => r?,
        Err(_) => return Err(Refusal::text("This file could not be read safely, so it was not opened.")),
    };
    let html = catch_unwind(AssertUnwindSafe(|| wordcraft_formats::export("html", &doc)))
        .ok()
        .flatten()
        .and_then(Result::ok)
        .map(|b| String::from_utf8_lossy(&b).into_owned())
        .ok_or_else(|| Refusal::text("This document could not be shown."))?;
    let mut inspect = inspect_of(&doc);
    if package {
        inspect.macros = names.iter().any(|n| n.ends_with("vbaProject.bin"));
        for (prefix, what) in [("word/charts/", "charts"), ("word/diagrams/", "diagrams (SmartArt)"), ("word/embeddings/", "embedded objects"), ("ppt/", "slides")] {
            let n = names.iter().filter(|x| x.starts_with(prefix) && !x.ends_with('/') && !x.contains("/_rels/")).count();
            if n > 0 {
                inspect.embedded.push(format!("{n} {what}"));
            }
        }
        inspect.external = external_targets(bytes, &names);
        if inspect.macros {
            inspect.left_out.push("A macro project. It stays in the original file and is never run.".into());
        }
        inspect.left_out.extend(inspect.embedded.iter().map(|e| format!("{e}: the editor shows no chart, diagram or object.")));
    }
    if inspect.comments > 0 {
        inspect.left_out.push(format!("{} comment{} (they are not shown in the editor yet).", inspect.comments, if inspect.comments == 1 { "" } else { "s" }));
    }
    if inspect.revisions > 0 {
        inspect.left_out.push(format!("{} tracked change{}: the text is shown as it reads with them accepted.", inspect.revisions, if inspect.revisions == 1 { "" } else { "s" }));
    }
    if package || ext == "rtf" {
        inspect.left_out.push("Page layout (margins, columns, headers, footers), named styles, footnotes and fields.".into());
    }
    let title = if doc.core.title.trim().is_empty() { name.rsplit(['/', '\\']).next().unwrap_or(name).rsplit_once('.').map(|(s, _)| s.to_string()).unwrap_or_else(|| name.to_string()) } else { doc.core.title.clone() };
    Ok(Imported { html: body_of(&html), title, inspect })
}

/// Writes the editor's HTML as a file of the format `ext`. `author` becomes the file's author; empty leaves it unnamed.
pub fn export(ext: &str, html: &str, title: &str, author: &str, layout: Option<&Layout>) -> Result<Vec<u8>, String> {
    let ext = ext.trim_start_matches('.').to_ascii_lowercase();
    if !EXPORTABLE.contains(&ext.as_str()) {
        return Err(format!("Nexsync writes {} files.", EXPORTABLE.join(", ")));
    }
    if html.len() > 64 * 1024 * 1024 {
        return Err("This document is too large to export.".to_string());
    }
    let page = format!("<!doctype html><html><head><meta charset=\"utf-8\"><title>{}</title></head><body>{html}</body></html>", escape(title));
    catch_unwind(AssertUnwindSafe(|| -> Result<Vec<u8>, String> {
        let mut doc = wordcraft_formats::import("html", page.as_bytes()).ok_or("The document could not be read.")??;
        doc.core.title = title.chars().take(200).collect();
        doc.core.creator = author.chars().take(100).collect();
        doc.core.last_modified_by = doc.core.creator.clone();
        if let Some(l) = layout {
            apply_layout(&mut doc, l);
        }
        if ext == "docx" {
            wordcraft_docx::write(&doc).map_err(|e| format!("The file could not be written: {e}"))
        } else if ext == "pdf" {
            let opts = wordcraft_pdf::PdfOptions { title: Some(doc.core.title.clone()).filter(|t| !t.is_empty()), author: Some(doc.core.creator.clone()).filter(|t| !t.is_empty()), ..Default::default() };
            wordcraft_pdf::export(&doc, &opts).map_err(|e| format!("The PDF could not be written: {e}"))
        } else {
            wordcraft_formats::export(&ext, &doc).ok_or_else(|| "That format is not supported.".to_string())?
        }
    }))
    .map_err(|_| "The file could not be written safely.".to_string())?
}

fn escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}

// ────────────────────────────
// Commands
// ────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportAnswer {
    pub imported: Option<Imported>,
    pub error: Option<String>,
    /// A password would open it
    pub password: bool,
}

/// Opens a file of the workspace as a document
#[tauri::command]
pub async fn office_import(app_handle: tauri::AppHandle, path: String, rel: String, password: Option<String>) -> Result<ImportAnswer, String> {
    validate_allowed_root(&app_handle, &path)?;
    let file = resolve_workspace_path(&path, rel.trim_start_matches('/'))?;
    let meta = fs::metadata(&file).map_err(|_| "That file is gone.".to_string())?;
    if !meta.is_file() || meta.len() > MAX_FILE_BYTES {
        return Err("That file is not one Nexsync can open as a document.".to_string());
    }
    let name = rel.clone();
    let answer = tokio::task::spawn_blocking(move || {
        let bytes = fs::read(&file).map_err(|e| e.to_string())?;
        Ok::<_, String>(import(&name, &bytes, password.as_deref()))
    })
    .await
    .map_err(|e| e.to_string())??;
    Ok(match answer {
        Ok(imported) => ImportAnswer { imported: Some(imported), error: None, password: false },
        Err(r) => ImportAnswer { imported: None, error: Some(r.message), password: r.password },
    })
}

/// Saves the editor's document as a file in the format its name ends in, at a place the person chose
#[tauri::command]
pub async fn office_export(app_handle: tauri::AppHandle, path: String, dest: String, html: String, title: String, author: String, layout: Option<Layout>) -> Result<usize, String> {
    validate_allowed_root(&app_handle, &path)?;
    let dest = super::export::check_destination(&path, &dest, EXPORTABLE)?;
    let ext = ext_of(&dest.to_string_lossy());
    let bytes = tokio::task::spawn_blocking(move || export(&ext, &html, &title, &author, layout.as_ref())).await.map_err(|e| e.to_string())??;
    fs::write(&dest, &bytes).map_err(|e| format!("Could not save the file: {e}"))?;
    Ok(bytes.len())
}

/// What a file holds, without opening it as a document
#[tauri::command]
pub async fn office_inspect(app_handle: tauri::AppHandle, path: String, rel: String) -> Result<Inspect, String> {
    let a = office_import(app_handle, path, rel, None).await?;
    match a.imported {
        Some(i) => Ok(i.inspect),
        None => Err(a.error.unwrap_or_else(|| "That file could not be read.".to_string())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const HTML: &str = "<h1>Report</h1><p>Hello <strong>bold</strong> and <em>italic</em> with a <a href=\"https://example.com/x\">link</a>.</p><ul><li>one</li><li>two</li></ul><table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>";

    #[test]
    fn a_document_goes_out_as_a_pdf_and_a_broken_doc_file_is_refused_without_a_panic() {
        let pdf = export("pdf", HTML, "Report", "Ana", None).unwrap();
        assert!(pdf.starts_with(b"%PDF") && pdf.len() > 1000, "{}", pdf.len());
        assert!(import("old.doc", &[0xD0, 0xCF, 0x11, 0xE0, 1, 2, 3, 4], None).is_err());
        assert!(import("old.doc", b"plain text", None).is_err());
    }

    #[test]
    fn a_document_goes_out_as_each_format_and_comes_back_with_its_text_and_structure() {
        for ext in ["docx", "odt", "rtf", "md", "html"] {
            let bytes = export(ext, HTML, "Report", "Ana", None).unwrap_or_else(|e| panic!("{ext}: {e}"));
            let back = import(&format!("report.{ext}"), &bytes, None).unwrap_or_else(|e| panic!("{ext}: {}", e.message));
            let h = back.html.to_lowercase();
            assert!(h.contains("report") && h.contains("hello") && h.contains("bold") && h.contains("one") && h.contains("two"), "{ext}: {h}");
            if ext != "md" && ext != "rtf" {
                assert!(h.contains("<table") || h.contains("<td"), "{ext} lost its table: {h}");
            }
        }
    }

    /// What the editor's ribbon makes (a size, a font, a colour, an alignment, underline) has to survive a file
    #[test]
    fn character_and_paragraph_formatting_from_the_editor_survives_a_docx() {
        let html = concat!(
            "<p style=\"text-align: center;\"><strong><u><span style=\"color: rgb(224, 62, 62);\"><span style=\"font-size: 24pt;\"><span style=\"font-family: Georgia;\">Big</span></span></span></u></strong></p>",
            "<h2 style=\"text-align: right;\">Head</h2>",
            "<p><span style=\"background-color: rgb(255, 255, 0);\">marked</span> and <s>struck</s></p>",
        );
        let back = import("f.docx", &export("docx", html, "T", "", None).unwrap(), None).unwrap().html.to_lowercase();
        assert!(back.contains("24pt"), "size: {back}");
        assert!(back.contains("georgia"), "font: {back}");
        assert!(back.contains("center"), "alignment: {back}");
        assert!(back.contains("right"), "alignment: {back}");
        assert!(back.contains("<u>") || back.contains("underline"), "underline: {back}");
        assert!(back.contains("<s>") || back.contains("line-through") || back.contains("<del>") || back.contains("<strike>"), "strike: {back}");
        assert!(back.contains("e03e3e") || back.contains("224, 62, 62") || back.contains("rgb"), "colour: {back}");
        assert!(back.contains("<h2"), "heading: {back}");
    }

    #[test]
    fn the_page_set_up_and_the_header_and_footer_are_written_into_the_file() {
        let layout = Layout { width: 595.3, height: 841.9, top: 36.0, bottom: 36.0, left: 54.0, right: 54.0, columns: 2, spacing: 1.5, header: "Quarterly report".into(), footer: "Confidential".into(), page_numbers: true, ..Default::default() };
        let bytes = export("docx", HTML, "Report", "Ana", Some(&layout)).unwrap();
        let doc = wordcraft_docx::read_with_password(&bytes, None).unwrap();
        let s = &doc.last_section;
        assert!((s.page_w - 595.3).abs() < 0.5 && (s.page_h - 841.9).abs() < 0.5, "{} x {}", s.page_w, s.page_h);
        assert!((s.margin_left - 54.0).abs() < 0.5 && (s.margin_top - 36.0).abs() < 0.5);
        assert_eq!(s.columns.count, 2);
        let text = |id: Option<u32>| id.and_then(|i| doc.parts.get(&i)).map(|p| p.blocks.iter().filter_map(|b| b.as_para().map(|p| p.text.clone())).collect::<String>()).unwrap_or_default();
        assert!(text(s.headers.default).contains("Quarterly report"));
        let footer = doc.parts.get(&s.footers.default.unwrap()).unwrap().blocks.iter().filter_map(|b| b.as_para().cloned()).next().unwrap();
        assert!(footer.text.contains("Confidential") && footer.objects.iter().any(|o| matches!(o, wordcraft_doc::InlineObject::Field { instr, .. } if instr == "PAGE")));
        // Landscape keeps the page as given, turned
        let wide = Layout { width: 792.0, height: 612.0, landscape: true, ..Default::default() };
        let back = wordcraft_docx::read_with_password(&export("docx", HTML, "R", "", Some(&wide)).unwrap(), None).unwrap();
        assert!(back.last_section.landscape && back.last_section.page_w > back.last_section.page_h);
        // Nonsense is ignored
        let bad = Layout { width: f32::NAN, height: -4.0, top: 9999.0, columns: 9, spacing: 7.0, ..Default::default() };
        assert!(export("docx", HTML, "R", "", Some(&bad)).is_ok());
    }

    #[test]
    fn a_docx_keeps_headings_bold_links_and_names_its_author_unless_asked_not_to() {
        let bytes = export("docx", HTML, "Report", "Ana", None).unwrap();
        let back = import("r.docx", &bytes, None).unwrap();
        let h = back.html.to_lowercase();
        assert!(h.contains("<h1") && h.contains("<strong>bold</strong>") && h.contains("href=\"https://example.com/x\""), "{h}");
        assert_eq!(back.inspect.people, ["Ana"]);
        assert_eq!(back.title, "Report");
        let anon = import("r.docx", &export("docx", HTML, "Report", "", None).unwrap(), None).unwrap();
        assert!(anon.inspect.people.is_empty());
        assert!(anon.inspect.words >= 8);
    }

    #[test]
    fn a_zip_bomb_junk_and_oversized_input_are_refused_before_anything_is_parsed() {
        assert!(import("a.docx", b"not a zip at all", None).is_err());
        assert!(import("a.docx", b"", None).is_err());
        assert!(import("a.exe", b"MZ", None).unwrap_err().message.contains("cannot open"));
        // A part that says it is huge and squeezes a thousand to one
        let mut buf = std::io::Cursor::new(Vec::new());
        {
            use std::io::Write;
            let mut w = zip::ZipWriter::new(&mut buf);
            let opts = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
            w.start_file("word/document.xml", opts).unwrap();
            w.write_all(&vec![b'a'; 20 * 1024 * 1024]).unwrap();
            w.finish().unwrap();
        }
        let e = import("bomb.docx", buf.get_ref(), None).unwrap_err();
        assert!(e.message.contains("unpacks to far more"), "{}", e.message);
        assert!(export("exe", "<p>x</p>", "t", "a", None).is_err());
    }

    #[test]
    fn plain_formats_open_and_markdown_headings_become_headings() {
        let md = import("n.md", b"# Title\n\nSome *text*\n\n- a\n- b\n", None).unwrap();
        let h = md.html.to_lowercase();
        assert!(h.contains("<h1") && h.contains("<em>text</em>") && h.contains("<li>a"), "{h}");
        assert_eq!(import("n.txt", b"line one\n\nline two", None).unwrap().inspect.words, 4);
    }

    #[test]
    fn the_body_is_cut_out_of_a_whole_page_of_html() {
        assert_eq!(body_of("<html><head><title>x</title></head><body class=\"a\">\n<p>hi</p>\n</body></html>"), "<p>hi</p>");
        assert_eq!(body_of("<p>no body</p>"), "<p>no body</p>");
    }
}
