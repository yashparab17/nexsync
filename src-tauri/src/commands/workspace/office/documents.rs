//! Office documents (Phase 21, step 1): opening a .docx, .odt, .rtf, .md, .html or .txt file as an editable document, writing one
//! back out, and saying what a file holds before it is shared.
//!
//! The reading and writing is done by the format crates of WordCraft (MIT OR Apache-2.0, pinned by commit, see
//! THIRD_PARTY_NOTICES.md). A document lives in the workspace as a shared rich-text document; the file is a copy that goes in
//! and out. Coming in, the file becomes the editor's blocks directly (`blocks`), every paragraph and run carrying its Word formatting:
//! spacing, indents, line spacing, keeps, page breaks, list numbering, fonts, colours. Going out, the editor's HTML is merged into
//! the file it came from (`merge`), so what the editor does not hold (style names, sections, headers and footers) stays. Footnotes,
//! fields and comments are not carried into the editor yet, and `import` lists what it saw and left out so a person is told.
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
    /// Words of text that the file marks as hidden (Word's Hidden font effect): the editor does not show them, and they travel with the file
    pub hidden_words: usize,
    /// The start of some of that text, for the person to see what it is
    pub hidden: Vec<String>,
    /// Fonts the document uses that this computer does not have, each with the font it is laid out in instead ("Aptos → Carlito")
    pub stand_ins: Vec<String>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Imported {
    /// The footnotes and endnotes of the file, which the blocks refer to with a marker in the text (see `notes`)
    pub notes: Vec<super::notes::NoteOut>,
    /// The document body as the editor's blocks, every paragraph and run carrying its Word formatting (see `blocks`)
    pub blocks: Vec<serde_json::Value>,
    /// The line height of each font the blocks use, as Word measures single spacing (a multiple of the font's size)
    pub fonts: std::collections::BTreeMap<String, f32>,
    /// The definitions of the lists the blocks belong to, for numbering them as they change (`num:level`)
    pub lists: std::collections::BTreeMap<String, super::blocks::ListLevel>,
    pub title: String,
    pub inspect: Inspect,
    /// The paragraph styles the file has that the Styles gallery should offer, each with the look it gives
    pub styles: Vec<super::styles::StyleOut>,
    /// The page set-up the file has, for the editor's page and header settings to start from
    pub layout: Layout,
    /// The file as it was read, kept so that drawing or saving can bring back what the editor does not hold (see `merge`)
    pub source_id: Option<String>,
}

/// How a document sits on paper: what the Layout tab and the page set-up say, written into the file
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Layout {
    /// The notes the editor holds; `None` from a client that does not know notes, which leaves the document's notes as they are
    pub notes: Option<Vec<super::notes::NoteIn>>,
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
    /// The header and footer of the first page, and of even pages, when they differ (empty: the same as the others)
    pub first_header: String,
    pub first_footer: String,
    pub even_header: String,
    pub even_footer: String,
    /// "Page 1" in the footer
    pub page_numbers: bool,
    /// Where the text sits between the top and bottom margins of each page: `top`, `center`, `bottom` or `justify`
    pub valign: String,
    /// The font and size of the file's ordinary text (its Normal style), which the editor's page starts from; empty and 0 when unknown
    pub font: String,
    pub size: f32,
    /// The comments on the text, each on the words it was made on (written as the file format's own comments)
    pub comments: Vec<CommentIn>,
    /// Paragraph styles made or changed in the editor, written into the file's styles
    pub styles: Vec<super::styles::StyleIn>,
}

/// A comment thread: the words it is on, who said what, and whether it was settled
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct CommentIn {
    pub quote: String,
    pub author: String,
    pub text: String,
    /// ISO 8601
    pub date: String,
    pub resolved: bool,
    pub replies: Vec<ReplyIn>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct ReplyIn {
    pub author: String,
    pub text: String,
    pub date: String,
}

/// Puts each comment on the first place its words stand in the body, with a reply on the same words; a comment whose words are
/// not there is left out (the caller says so)
pub fn add_comments(doc: &mut wordcraft_doc::Document, comments: &[CommentIn]) -> usize {
    use wordcraft_doc::{Block, CharProps, Comment, InlineObject, PartKind};
    let mut placed = 0;
    for c in comments.iter().take(500) {
        let quote = c.quote.trim();
        if quote.is_empty() || c.text.trim().is_empty() {
            continue;
        }
        // Where the words are: the first paragraph holding them
        let Some((bi, off)) = doc.body.iter().enumerate().find_map(|(i, b)| match &**b {
            Block::Para(p) => p.text.find(quote).map(|o| (i, o)),
            _ => None,
        }) else {
            continue;
        };
        let mut thread: Vec<(Option<u32>, &str, &str, &str)> = vec![(None, &c.author, &c.date, &c.text)];
        thread.extend(c.replies.iter().map(|r| (Some(0), r.author.as_str(), r.date.as_str(), r.text.as_str())));
        let first_id = doc.comments.keys().next_back().map_or(1, |k| k + 1);
        let mut ids = Vec::new();
        for (n, (parent, author, date, text)) in thread.iter().enumerate() {
            let id = first_id + n as u32;
            let part = doc.add_part(PartKind::Comment, vec![line_block(&text.chars().take(4000).collect::<String>(), false, wordcraft_doc::Align::Left)]);
            let author: String = author.chars().take(100).collect();
            doc.comments.insert(id, Comment { initials: author.chars().next().map(|c| c.to_string()).unwrap_or_default(), author, date: date.to_string(), parent: parent.map(|_| first_id), resolved: c.resolved, part, ..Default::default() });
            ids.push(id);
        }
        if let Block::Para(p) = std::sync::Arc::make_mut(&mut doc.body[bi]) {
            let props = CharProps::default();
            let end = off + quote.len();
            for id in ids.iter().rev() {
                let _ = p.insert_object(end, InlineObject::CommentEnd { id: *id }, &props);
            }
            for id in ids.iter().rev() {
                let _ = p.insert_object(off, InlineObject::CommentStart { id: *id }, &props);
            }
        }
        placed += 1;
    }
    placed
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
    s.valign = match l.valign.as_str() {
        "center" => wordcraft_doc::section::PageVAlign::Center,
        "bottom" => wordcraft_doc::section::PageVAlign::Bottom,
        "justify" => wordcraft_doc::section::PageVAlign::Justify,
        _ => wordcraft_doc::section::PageVAlign::Top,
    };
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
    // Different first page, and different odd and even pages: each part is a line of text like the ordinary header or footer
    let mut part = |kind: PartKind, text: &str| -> Option<u32> {
        let t: String = text.trim().chars().take(200).collect();
        (!t.is_empty()).then(|| doc.add_part(kind, vec![line_block(&t, false, Align::Left)]))
    };
    let first = (part(PartKind::Header, &l.first_header), part(PartKind::Footer, &l.first_footer));
    let even = (part(PartKind::Header, &l.even_header), part(PartKind::Footer, &l.even_footer));
    if first.0.is_some() || first.1.is_some() {
        doc.last_section.title_page = true;
        doc.last_section.headers.first = first.0;
        doc.last_section.footers.first = first.1;
    }
    if even.0.is_some() || even.1.is_some() {
        doc.settings.even_odd_headers = true;
        doc.last_section.headers.even = even.0;
        doc.last_section.footers.even = even.1;
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

/// The text that is marked hidden, run by run (formatting set on the run itself; hidden text that comes from a character style is not found):
/// how many words, and the start of the first few stretches
fn hidden_text_of(blocks: &[std::sync::Arc<wordcraft_doc::Block>], words: &mut usize, previews: &mut Vec<String>) {
    for b in blocks {
        match &**b {
            wordcraft_doc::Block::Para(p) => {
                let mut at = 0;
                for run in &p.runs {
                    let end = (at + run.len).min(p.text.len());
                    if run.props.hidden == Some(true) {
                        if let Some(t) = p.text.get(at..end) {
                            *words += t.split_whitespace().count();
                            let t = t.trim();
                            if !t.is_empty() && previews.len() < 10 {
                                previews.push(t.chars().take(80).collect());
                            }
                        }
                    }
                    at = end;
                }
            }
            wordcraft_doc::Block::Table(t) => {
                for row in &t.rows {
                    for cell in &row.cells {
                        hidden_text_of(&cell.blocks, words, previews);
                    }
                }
            }
        }
    }
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
    let (mut hidden_words, mut hidden) = (0, Vec::new());
    hidden_text_of(&doc.body, &mut hidden_words, &mut hidden);
    Inspect {
        words: doc.word_count(),
        images: doc.media.len(),
        comments: doc.comments.len(),
        revisions: doc.revisions.len(),
        people,
        title: doc.core.title.clone(),
        created: doc.core.created.clone(),
        modified: doc.core.modified.clone(),
        hidden_words,
        hidden,
        ..Default::default()
    }
}

fn ext_of(name: &str) -> String {
    name.rsplit('.').next().unwrap_or("").to_ascii_lowercase()
}

/// Reads a file's bytes as a document, by its extension
fn read_document(ext: &str, bytes: &[u8], password: Option<&str>) -> Result<wordcraft_doc::Document, Refusal> {
    // A parser that panics on a hostile file must not take the app with it
    let parsed = catch_unwind(AssertUnwindSafe(|| -> Result<wordcraft_doc::Document, Refusal> {
        match ext {
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
    match parsed {
        Ok(r) => r,
        Err(_) => Err(Refusal::text("This file could not be read safely, so it was not opened.")),
    }
}

/// The lines of a file as a document (see `compare`), read under the same limits as opening it
pub fn lines_of(name: &str, bytes: &[u8]) -> Result<Vec<String>, String> {
    if bytes.len() as u64 > MAX_FILE_BYTES {
        return Err("This version is bigger than 64 MB.".to_string());
    }
    let ext = ext_of(name);
    if !IMPORTABLE.contains(&ext.as_str()) {
        return Err(format!("A .{ext} file cannot be compared."));
    }
    if matches!(ext.as_str(), "docx" | "docm" | "dotx" | "dotm" | "odt") {
        check_package(bytes)?;
    }
    let doc = read_document(&ext, bytes, None).map_err(|e| e.message)?;
    catch_unwind(AssertUnwindSafe(|| super::compare::document_lines(&doc))).map_err(|_| "This version could not be read.".to_string())
}

/// What a file holds that a person should know before sharing it, and what the editor does not take from it
fn inspect_file(ext: &str, package: bool, names: &[String], bytes: &[u8], doc: &wordcraft_doc::Document) -> Inspect {
    let mut inspect = inspect_of(doc);
    if package {
        inspect.macros = names.iter().any(|n| n.ends_with("vbaProject.bin"));
        for (prefix, what) in [("word/charts/", "charts"), ("word/diagrams/", "diagrams (SmartArt)"), ("word/embeddings/", "embedded objects"), ("ppt/", "slides")] {
            let n = names.iter().filter(|x| x.starts_with(prefix) && !x.ends_with('/') && !x.contains("/_rels/")).count();
            if n > 0 {
                inspect.embedded.push(format!("{n} {what}"));
            }
        }
        inspect.external = external_targets(bytes, names);
        if inspect.macros {
            inspect.left_out.push("A macro project. It stays in the original file and is never run.".into());
        }
        inspect.left_out.extend(inspect.embedded.iter().map(|e| format!("{e}: the editor shows no chart, diagram or object.")));
    }
    if inspect.hidden_words > 0 {
        inspect.left_out.push(format!("{} word{} of hidden text. The editor does not show it; the original file keeps it until Update the File replaces it.", inspect.hidden_words, if inspect.hidden_words == 1 { "" } else { "s" }));
    }
    if inspect.comments > 0 {
        inspect.left_out.push(format!("{} comment{} (they are not shown in the editor yet).", inspect.comments, if inspect.comments == 1 { "" } else { "s" }));
    }
    if inspect.revisions > 0 {
        inspect.left_out.push(format!("{} tracked change{}: the text is shown as it reads with them accepted.", inspect.revisions, if inspect.revisions == 1 { "" } else { "s" }));
    }
    if package || ext == "rtf" {
        inspect.left_out.push("Fields other than page numbers and the fields the editor can update.".into());
    }
    inspect
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
    let doc = read_document(&ext, bytes, password)?;
    let layout = super::merge::layout_of(&doc);
    let source_id = Some(super::merge::keep(bytes, &ext, &doc));
    // Headers and footers with shapes WordCraft draws as boxes are drawn from a copy with those shapes written out
    if let (true, Some(id)) = (matches!(ext.as_str(), "docx" | "docm" | "dotx" | "dotm"), &source_id) {
        if let Some(Ok(drawn)) = super::presets::drawn_copy(bytes).map(|copy| read_document(&ext, &copy, password)) {
            super::merge::keep_drawn(id, drawn);
        }
    }
    let converted = catch_unwind(AssertUnwindSafe(|| super::blocks::convert(&doc))).map_err(|_| Refusal::text("This document could not be shown."))?;
    let mut inspect = inspect_file(&ext, package, &names, bytes, &doc);
    inspect.stand_ins = super::fonts::stand_ins(converted.fonts.keys());
    let title = if doc.core.title.trim().is_empty() { name.rsplit(['/', '\\']).next().unwrap_or(name).rsplit_once('.').map(|(s, _)| s.to_string()).unwrap_or_else(|| name.to_string()) } else { doc.core.title.clone() };
    let styles = super::styles::styles_of(&doc);
    Ok(Imported { notes: super::notes::notes_of(&doc), blocks: converted.blocks, fonts: converted.fonts, lists: converted.lists, title, inspect, styles, layout, source_id })
}

/// A file's bytes read as a document under the limits of opening one (size, kind, package checks, password)
fn open_bytes(name: &str, bytes: &[u8], password: Option<&str>) -> Result<(wordcraft_doc::Document, String, bool, Vec<String>), String> {
    if bytes.len() as u64 > MAX_FILE_BYTES {
        return Err("This file is bigger than 64 MB.".to_string());
    }
    let ext = ext_of(name);
    if !IMPORTABLE.contains(&ext.as_str()) {
        return Err(format!("Nexsync cannot open .{ext} files as documents. It opens {}.", IMPORTABLE.join(", ")));
    }
    let package = matches!(ext.as_str(), "docx" | "docm" | "dotx" | "dotm" | "odt");
    let names = if package && !bytes.starts_with(&[0xD0, 0xCF, 0x11, 0xE0]) { check_package(bytes)? } else { Vec::new() };
    let doc = read_document(&ext, bytes, password).map_err(|e| e.message)?;
    Ok((doc, ext, package, names))
}

/// A file converted to another format, from bytes to bytes (the format is the extension of `to`: docx, odt, rtf, md, html, txt, tex, pdf), for the command line;
/// `markup` and `comments` are for a PDF (see `write_document`)
pub fn convert_bytes(name: &str, bytes: &[u8], to: &str, password: Option<&str>, markup: bool, comments: bool) -> Result<Vec<u8>, String> {
    let to = to.trim_start_matches('.').to_ascii_lowercase();
    if !EXPORTABLE.contains(&to.as_str()) {
        return Err(format!("Nexsync writes {} files.", EXPORTABLE.join(", ")));
    }
    if (markup || comments) && to != "pdf" {
        return Err("Showing changes and comments is for PDF files only.".to_string());
    }
    let (doc, ..) = open_bytes(name, bytes, password)?;
    catch_unwind(AssertUnwindSafe(|| write_document(&doc, &to, markup, comments))).map_err(|_| "The file could not be written safely.".to_string())?
}

/// The text of a file, one line for each paragraph and each table row (cells separated by a tab), for the command line
pub fn text_bytes(name: &str, bytes: &[u8], password: Option<&str>) -> Result<String, String> {
    let (doc, ..) = open_bytes(name, bytes, password)?;
    catch_unwind(AssertUnwindSafe(|| super::compare::document_lines(&doc).join("\n"))).map_err(|_| "The file could not be read.".to_string())
}

/// What a file holds, as the inspector shows it, for the command line
pub fn inspect_bytes(name: &str, bytes: &[u8], password: Option<&str>) -> Result<Inspect, String> {
    let (doc, ext, package, names) = open_bytes(name, bytes, password)?;
    catch_unwind(AssertUnwindSafe(|| inspect_file(&ext, package, &names, bytes, &doc))).map_err(|_| "The file could not be read.".to_string())
}

/// The document the editor's HTML stands for. With the file it came from (`source`), that file is brought up to date with the text, so
/// the styles, sections, headers and footers the editor does not hold are still there; without one it is made from the HTML alone.
fn build_document(html: &str, title: &str, author: &str, layout: Option<&Layout>, source: Option<&str>) -> Result<wordcraft_doc::Document, String> {
    let page = format!("<!doctype html><html><head><meta charset=\"utf-8\"><title>{}</title></head><body>{html}</body></html>", escape(title));
    let mut edited = wordcraft_formats::import("html", page.as_bytes()).ok_or("The document could not be read.")??;
    // The style each paragraph was given in the editor (see `styles`)
    let chosen = super::styles::take_markers(&mut edited);
    let (note_at, note_ids) = super::notes::take_markers(&mut edited);
    let breaks = super::sections::take_markers(&mut edited);
    let original = source.and_then(super::merge::get);
    let mut doc = match &original {
        Some(o) => super::merge::merge(o, edited),
        None => edited,
    };
    doc.core.title = title.chars().take(200).collect();
    doc.core.creator = author.chars().take(100).collect();
    doc.core.last_modified_by = doc.core.creator.clone();
    if let Some(l) = layout {
        match &original {
            // Page set-up the person did not touch stays as the file has it, headers and footers included
            Some(o) if super::merge::same_page(l, &super::merge::layout_of(o)) => {}
            Some(_) => apply_layout(&mut doc, &Layout { spacing: if (l.spacing - 1.15).abs() < 0.001 { 0.0 } else { l.spacing }, ..l.clone() }),
            None => apply_layout(&mut doc, l),
        }
        add_comments(&mut doc, &l.comments);
        super::styles::apply(&mut doc, &l.styles);
    }
    super::styles::settle(&mut doc, &chosen);
    super::sections::settle(&mut doc, &breaks);
    super::notes::settle(&mut doc, &note_at, &note_ids, layout.and_then(|l| l.notes.as_deref()));
    Ok(doc)
}

/// Writes the editor's HTML as a file of the format `ext`. `author` becomes the file's author; empty leaves it unnamed.
pub fn export(ext: &str, html: &str, title: &str, author: &str, layout: Option<&Layout>) -> Result<Vec<u8>, String> {
    export_with(ext, html, title, author, layout, None)
}

/// [`export`], bringing the file the document came from up to date instead of writing the HTML alone
pub fn export_with(ext: &str, html: &str, title: &str, author: &str, layout: Option<&Layout>, source: Option<&str>) -> Result<Vec<u8>, String> {
    let ext = ext.trim_start_matches('.').to_ascii_lowercase();
    if !EXPORTABLE.contains(&ext.as_str()) {
        return Err(format!("Nexsync writes {} files.", EXPORTABLE.join(", ")));
    }
    if html.len() > 64 * 1024 * 1024 {
        return Err("This document is too large to export.".to_string());
    }
    catch_unwind(AssertUnwindSafe(|| -> Result<Vec<u8>, String> {
        let doc = build_document(html, title, author, layout, source)?;
        write_document(&doc, &ext, false, false)
    }))
    .map_err(|_| "The file could not be written safely.".to_string())?
}

/// A document written in one of the formats in `EXPORTABLE` (`ext` lower case, no dot). For a PDF, `markup` shows tracked changes as coloured
/// insertions and struck-out deletions and `comments` prints the comments in balloons beside the page; every PDF is tagged and has links and bookmarks.
fn write_document(doc: &wordcraft_doc::Document, ext: &str, markup: bool, comments: bool) -> Result<Vec<u8>, String> {
    if ext == "docx" {
        wordcraft_docx::write(doc).map_err(|e| format!("The file could not be written: {e}"))
    } else if ext == "pdf" {
        let opts = wordcraft_pdf::PdfOptions { title: Some(doc.core.title.clone()).filter(|t| !t.is_empty()), author: Some(doc.core.creator.clone()).filter(|t| !t.is_empty()), include_markup: markup, comments, ..Default::default() };
        wordcraft_pdf::export(doc, &opts).map_err(|e| format!("The PDF could not be written: {e}"))
    } else {
        wordcraft_formats::export(ext, doc).ok_or_else(|| "That format is not supported.".to_string())?
    }
}

/// A document laid out once, kept so its pages can be drawn one at a time as they come into view
struct Laid {
    doc: wordcraft_doc::Document,
    pages: Vec<wordcraft_layout::Page>,
}

static LAID: std::sync::Mutex<Vec<(u64, std::sync::Arc<Laid>)>> = std::sync::Mutex::new(Vec::new());
static NEXT_SESSION: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
const KEEP_LAID: usize = 3;

/// How many pages a document has and how big each is, with the id to ask for them by
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PageList {
    pub session: u64,
    /// Width and height of each page in points
    pub sizes: Vec<(f32, f32)>,
}

/// Lays the document out (the slow part) and keeps the result; no page is drawn yet
pub fn lay_out(html: &str, title: &str, layout: Option<&Layout>, source: Option<&str>) -> Result<PageList, String> {
    if html.len() > 16 * 1024 * 1024 {
        return Err("This document is too large to show as pages.".to_string());
    }
    catch_unwind(AssertUnwindSafe(|| -> Result<PageList, String> {
        let doc = build_document(html, title, "", layout, source)?;
        let laid = wordcraft_layout::layout(&doc, &mut wordcraft_layout::LayoutCache::new(), &wordcraft_layout::LayoutOptions::default());
        let sizes = laid.pages.iter().take(MAX_PAGES).map(|p| (p.w, p.h)).collect();
        let pages = laid.pages.into_iter().take(MAX_PAGES).collect();
        let session = NEXT_SESSION.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let mut all = LAID.lock().unwrap_or_else(|p| p.into_inner());
        all.push((session, std::sync::Arc::new(Laid { doc, pages })));
        if all.len() > KEEP_LAID {
            all.remove(0);
        }
        Ok(PageList { session, sizes })
    }))
    .map_err(|_| "The pages could not be laid out safely.".to_string())?
}

/// One page of a laid-out document, drawn
pub fn draw_page(session: u64, index: usize, scale: f32) -> Result<PageImage, String> {
    use base64::prelude::{Engine, BASE64_STANDARD};
    let laid = LAID.lock().unwrap_or_else(|p| p.into_inner()).iter().find(|(k, _)| *k == session).map(|(_, l)| l.clone()).ok_or("These pages are no longer kept. Open the view again.")?;
    let page = laid.pages.get(index).ok_or("There is no such page.")?;
    let scale = scale.clamp(0.5, 2.0);
    catch_unwind(AssertUnwindSafe(|| PageImage { png: BASE64_STANDARD.encode(wordcraft_render::render_page(&laid.doc, page, scale, &wordcraft_render::RenderOptions::default()).to_png()), width_pt: page.w, height_pt: page.h, body_top_pt: page.body.y, body_height_pt: page.body.h }))
        .map_err(|_| "That page could not be drawn safely.".to_string())
}

/// One page of a document as a picture, with its size in points
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PageImage {
    pub png: String,
    pub width_pt: f32,
    pub height_pt: f32,
    /// Where the text goes on the page (points from its top): between the margins, less what a header or footer reaches into them
    pub body_top_pt: f32,
    pub body_height_pt: f32,
}

const MAX_PAGES: usize = 200;

/// The editor's HTML laid out and drawn page by page by WordCraft's layout engine and rasteriser: the pages as a word processor prints
/// them (page breaks, centring, headers, footers, tables of contents), for the Print Layout view
pub fn render_pages(html: &str, title: &str, layout: Option<&Layout>, scale: f32) -> Result<Vec<PageImage>, String> {
    render_pages_with(html, title, layout, scale, None)
}

/// [`render_pages`] over the file the document came from, brought up to date with the text
pub fn render_pages_with(html: &str, title: &str, layout: Option<&Layout>, scale: f32, source: Option<&str>) -> Result<Vec<PageImage>, String> {
    use base64::prelude::{Engine, BASE64_STANDARD};
    if html.len() > 16 * 1024 * 1024 {
        return Err("This document is too large to show as pages.".to_string());
    }
    let scale = scale.clamp(0.5, 2.0);
    catch_unwind(AssertUnwindSafe(|| -> Result<Vec<PageImage>, String> {
        let doc = build_document(html, title, "", layout, source)?;
        let laid = wordcraft_layout::layout(&doc, &mut wordcraft_layout::LayoutCache::new(), &wordcraft_layout::LayoutOptions::default());
        let opts = wordcraft_render::RenderOptions::default();
        Ok(laid
            .pages
            .iter()
            .take(MAX_PAGES)
            .map(|p| PageImage { png: BASE64_STANDARD.encode(wordcraft_render::render_page(&doc, p, scale, &opts).to_png()), width_pt: p.w, height_pt: p.h, body_top_pt: p.body.y, body_height_pt: p.body.h })
            .collect())
    }))
    .map_err(|_| "The pages could not be drawn safely.".to_string())?
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

/// Lays the document out and keeps it, for the Print Layout view to draw page by page; runs off the main thread
#[tauri::command]
pub async fn office_layout(html: String, title: String, layout: Option<Layout>, source_id: Option<String>) -> Result<PageList, String> {
    tokio::task::spawn_blocking(move || lay_out(&html, &title, layout.as_ref(), source_id.as_deref())).await.map_err(|e| e.to_string())?
}

/// The file's headers and footers (shapes, lines and page numbers as Word draws them) for each page of the editor, which shows the text
/// itself: a stand-in for the file with its sections and one empty page for each of the editor's, laid out by WordCraft so that page
/// fields, first-page and section rules work as in Word. Each stand-in is kept for its file and page count.
struct Margins {
    source: String,
    pages: usize,
    doc: wordcraft_doc::Document,
    laid: Vec<wordcraft_layout::Page>,
}
static MARGINS: std::sync::Mutex<Vec<std::sync::Arc<Margins>>> = std::sync::Mutex::new(Vec::new());
// Which section each page of a file is in, from laying the file out once
static SECTIONS_OF: std::sync::Mutex<Vec<(String, std::sync::Arc<Vec<usize>>)>> = std::sync::Mutex::new(Vec::new());

fn margins_for(source: &str, pages: usize) -> Result<std::sync::Arc<Margins>, String> {
    use std::sync::Arc;
    use wordcraft_doc::{Block, Paragraph};
    let mut kept = MARGINS.lock().unwrap_or_else(|p| p.into_inner());
    if let Some(m) = kept.iter().find(|m| m.source == source && m.pages == pages) {
        return Ok(m.clone());
    }
    let src = super::merge::drawn(source).ok_or("The file is no longer kept. Open it again.")?;
    let opts = wordcraft_layout::LayoutOptions::default();
    let known = SECTIONS_OF.lock().unwrap_or_else(|p| p.into_inner()).iter().find(|(k, _)| k == source).map(|(_, v)| v.clone());
    let of_page = match known {
        Some(v) => v,
        None => {
            let v: Arc<Vec<usize>> = Arc::new(wordcraft_layout::layout(&src, &mut wordcraft_layout::LayoutCache::new(), &opts).pages.iter().map(|p| p.section).collect());
            let mut all = SECTIONS_OF.lock().unwrap_or_else(|p| p.into_inner());
            all.push((source.to_string(), v.clone()));
            if all.len() > KEEP_LAID {
                all.remove(0);
            }
            v
        }
    };
    let sections: Vec<wordcraft_doc::SectionProps> = src.sections().into_iter().map(|(_, s)| s.clone()).collect();
    // Past the file's own pages, the editor's go on in the file's last section
    let sec = |i: usize| of_page.get(i).or(of_page.last()).copied().unwrap_or(0).min(sections.len().saturating_sub(1));
    let pages = pages.clamp(1, MAX_PAGES);
    let mut doc = (*src).clone();
    doc.body = (0..pages)
        .map(|i| {
            let mut p = Paragraph::default();
            if i > 0 && sec(i) == sec(i - 1) {
                p.props.page_break_before = Some(true);
            }
            if i + 1 < pages && sec(i + 1) != sec(i) {
                p.section = Some(Box::new(sections[sec(i)].clone()));
            }
            Arc::new(Block::Para(p))
        })
        .collect();
    doc.last_section = sections[sec(pages - 1)].clone();
    let laid = wordcraft_layout::layout(&doc, &mut wordcraft_layout::LayoutCache::new(), &opts).pages;
    let m = Arc::new(Margins { source: source.to_string(), pages, doc, laid });
    kept.push(m.clone());
    if kept.len() > KEEP_LAID {
        kept.remove(0);
    }
    Ok(m)
}

/// Page `index` of the editor's `pages` with only the file's header and footer on it, drawn
pub fn draw_margins(source: &str, pages: usize, index: usize, scale: f32) -> Result<PageImage, String> {
    use base64::prelude::{Engine, BASE64_STANDARD};
    catch_unwind(AssertUnwindSafe(|| -> Result<PageImage, String> {
        let m = margins_for(source, pages)?;
        let page = m.laid.get(index).ok_or("There is no such page.")?;
        let png = wordcraft_render::render_page(&m.doc, page, scale.clamp(0.5, 3.0), &wordcraft_render::RenderOptions::default()).to_png();
        Ok(PageImage { png: BASE64_STANDARD.encode(png), width_pt: page.w, height_pt: page.h, body_top_pt: page.body.y, body_height_pt: page.body.h })
    }))
    .map_err(|_| "The header and footer could not be drawn safely.".to_string())?
}

/// The file's header and footer on one page of the editor, drawn
#[tauri::command]
pub async fn office_margins(source_id: String, pages: usize, index: usize, scale: f32) -> Result<PageImage, String> {
    tokio::task::spawn_blocking(move || draw_margins(&source_id, pages, index, scale)).await.map_err(|e| e.to_string())?
}

/// One page of a laid-out document, drawn
#[tauri::command]
pub async fn office_page(session: u64, index: usize, scale: f32) -> Result<PageImage, String> {
    tokio::task::spawn_blocking(move || draw_page(session, index, scale)).await.map_err(|e| e.to_string())?
}

/// The document's pages as pictures, for the Print Layout view; runs off the main thread
#[tauri::command]
pub async fn office_render(html: String, title: String, layout: Option<Layout>, scale: f32, source_id: Option<String>) -> Result<Vec<PageImage>, String> {
    tokio::task::spawn_blocking(move || render_pages_with(&html, &title, layout.as_ref(), scale, source_id.as_deref())).await.map_err(|e| e.to_string())?
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

/// Brings a pushed-out original back by reading it again from `file`, when that file is exactly the one the id was made from (the id is
/// the hash of its bytes). A different file, or none, is left alone: merging with the wrong original would be worse than none.
pub fn recover_original(file: &std::path::Path, id: &str) {
    if super::merge::get(id).is_some() {
        return;
    }
    let Ok(meta) = fs::metadata(file) else { return };
    if !meta.is_file() || meta.len() > MAX_FILE_BYTES {
        return;
    }
    let Ok(bytes) = fs::read(file) else { return };
    let Some((hash, _)) = id.rsplit_once('.') else { return };
    if blake3::hash(&bytes).to_hex().as_str() == hash {
        let _ = import(&file.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(), &bytes, None);
    }
}

/// Saves the editor's document as a file in the format its name ends in, at a place the person chose
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn office_export(app_handle: tauri::AppHandle, path: String, dest: String, html: String, title: String, author: String, layout: Option<Layout>, source_id: Option<String>) -> Result<usize, String> {
    validate_allowed_root(&app_handle, &path)?;
    let dest = crate::commands::workspace::export::check_destination(&path, &dest, EXPORTABLE)?;
    let ext = ext_of(&dest.to_string_lossy());
    let from = dest.clone();
    let bytes = tokio::task::spawn_blocking(move || {
        // Updating the file it was opened from: its original comes back from the file if the cache let it go
        if let Some(id) = source_id.as_deref() {
            recover_original(&from, id);
        }
        export_with(&ext, &html, &title, &author, layout.as_ref(), source_id.as_deref())
    })
    .await.map_err(|e| e.to_string())??;
    super::keep_versions(&path, &dest, true, &[]);
    fs::write(&dest, &bytes).map_err(|e| format!("Could not save the file: {e}"))?;
    super::keep_versions(&path, &dest, false, &bytes);
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
    #[test]
    fn comments_are_written_on_their_words_with_replies() {
        use std::io::Read;
        let layout = Layout { comments: vec![CommentIn { quote: "second quarter".into(), author: "Ana".into(), text: "Which one?".into(), date: "2026-10-25T10:00:00Z".into(), resolved: false, replies: vec![ReplyIn { author: "Bo".into(), text: "Q2.".into(), date: "2026-10-25T11:00:00Z".into() }] }, CommentIn { quote: "not in the text".into(), author: "Ana".into(), text: "Lost".into(), ..Default::default() }], ..Default::default() };
        let bytes = export("docx", "<p>This covers the second quarter well.</p>", "T", "A", Some(&layout)).unwrap();
        let mut z = zip::ZipArchive::new(std::io::Cursor::new(bytes)).unwrap();
        let mut body = String::new();
        z.by_name("word/document.xml").unwrap().read_to_string(&mut body).unwrap();
        let mut comments = String::new();
        z.by_name("word/comments.xml").unwrap().read_to_string(&mut comments).unwrap();
        assert_eq!(body.matches("<w:commentRangeStart").count(), 2, "the comment and its reply sit on the same words: {body}");
        assert!(comments.contains("Which one?") && comments.contains("Q2."));
        assert!(!comments.contains("Lost"), "a comment whose words are gone is left out");
    }

    use super::*;

    const HTML: &str = "<h1>Report</h1><p>Hello <strong>bold</strong> and <em>italic</em> with a <a href=\"https://example.com/x\">link</a>.</p><ul><li>one</li><li>two</li></ul><table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>";

    /// The blocks a file opens as, written out, for looking through
    fn json(i: &Imported) -> String {
        serde_json::to_string(&i.blocks).unwrap()
    }

    #[test]
    fn a_pushed_out_original_comes_back_from_the_file_it_was_read_from_and_not_from_another() {
        let mut doc = wordcraft_formats::import("html", b"<p>Alpha</p><p>Beta</p>").unwrap().unwrap();
        doc.last_section.valign = wordcraft_doc::section::PageVAlign::Center;
        let bytes = wordcraft_docx::write(&doc).unwrap();
        let id = import("a.docx", &bytes, None).unwrap().source_id.unwrap();
        let dir = std::env::temp_dir().join(format!("nx-recover-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let (same, other) = (dir.join("same.docx"), dir.join("other.docx"));
        fs::write(&same, &bytes).unwrap();
        fs::write(&other, wordcraft_docx::write(&wordcraft_formats::import("html", b"<p>Different</p>").unwrap().unwrap()).unwrap()).unwrap();
        // Pushed out by newer files, then looked for
        {
            let mut all = super::super::merge::SOURCES.lock().unwrap_or_else(|p| p.into_inner());
            all.retain(|(k, _, _)| *k != id);
        }
        assert!(super::super::merge::get(&id).is_none());
        recover_original(&other, &id);
        assert!(super::super::merge::get(&id).is_none(), "another file is not the original");
        recover_original(&same, &id);
        assert!(super::super::merge::get(&id).is_some(), "the file it came from is");
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn text_marked_hidden_is_counted_and_shown_to_the_person_before_they_share_the_file() {
        use wordcraft_doc::{props::CharProps, para::Run, Block};
        let mut doc = wordcraft_formats::import("html", b"<p>Visible secret words end</p>").unwrap().unwrap();
        let Block::Para(p) = std::sync::Arc::make_mut(&mut doc.body[0]) else { panic!("a paragraph") };
        let (before, hidden) = ("Visible ".len(), "secret words".len());
        let rest = p.text.len() - before - hidden;
        p.runs = vec![Run { len: before, props: CharProps::default() }, Run { len: hidden, props: CharProps { hidden: Some(true), ..Default::default() } }, Run { len: rest, props: CharProps::default() }];
        let bytes = wordcraft_docx::write(&doc).unwrap();
        let opened = import("secret.docx", &bytes, None).unwrap();
        assert_eq!(opened.inspect.hidden_words, 2);
        assert_eq!(opened.inspect.hidden, vec!["secret words".to_string()]);
        assert!(opened.inspect.left_out.iter().any(|l| l.contains("2 words of hidden text")), "{:?}", opened.inspect.left_out);
        // The editor does not show it
        assert!(!json(&opened).contains("secret"), "hidden text stays out of the editor");
        // A file with none says nothing
        let plain = import("plain.docx", &wordcraft_docx::write(&wordcraft_formats::import("html", b"<p>All shown</p>").unwrap().unwrap()).unwrap(), None).unwrap();
        assert_eq!(plain.inspect.hidden_words, 0);
        assert!(plain.inspect.hidden.is_empty());
    }

    #[test]
    fn merged_cells_and_a_repeating_header_row_are_written_to_the_docx_and_come_back() {
        use std::io::Read;
        // The HTML the editor gives for a table with a header row, a cell across two columns and a cell down two rows
        let html = "<table><colgroup><col><col></colgroup><tr><th colspan=\"2\" rowspan=\"1\" colwidth=\",\"><p>Head</p></th></tr><tr><td colspan=\"1\" rowspan=\"2\"><p>A</p></td><td colspan=\"1\" rowspan=\"1\"><p>1</p></td></tr><tr><td colspan=\"1\" rowspan=\"1\"><p>2</p></td></tr></table>";
        let bytes = export("docx", html, "T", "", None).unwrap();
        let mut z = zip::ZipArchive::new(std::io::Cursor::new(bytes.clone())).unwrap();
        let mut body = String::new();
        z.by_name("word/document.xml").unwrap().read_to_string(&mut body).unwrap();
        assert!(body.contains("<w:gridSpan w:val=\"2\"/>"), "a cell across two columns: {body}");
        assert!(body.contains("<w:vMerge w:val=\"restart\"/>") && body.contains("<w:vMerge/>"), "a cell down two rows");
        assert!(body.contains("<w:tblHeader/>"), "the header row repeats on each page");
        // And the file opens with the same cells merged
        let back = json(&import("t.docx", &bytes, None).unwrap());
        assert!(back.contains("\"colspan\":2") && back.contains("\"rowspan\":2"), "{back}");
    }

    #[test]
    fn a_pdf_has_links_bookmarks_and_tags_and_can_show_changes_and_comments() {
        let html = "<h1>Title</h1><p>See <a href=\"https://example.com/x\">the page</a>.</p><h2>Part</h2><p>More.</p>";
        let pdf = export("pdf", html, "T", "A", None).unwrap();
        let t = String::from_utf8_lossy(&pdf).into_owned();
        assert!(t.contains("/URI") && t.contains("/Link"), "a link is a link annotation");
        assert!(t.contains("/Outlines"), "the headings are bookmarks");
        assert!(t.contains("/StructTreeRoot") && t.contains("/MarkInfo") && t.contains("/Lang"), "tagged, with a language");
        // With the comments printed beside the page, the file is a different one
        let layout = Layout { comments: vec![CommentIn { quote: "More.".into(), author: "Ana".into(), text: "Say more.".into(), date: "2026-10-30T10:00:00Z".into(), resolved: false, replies: vec![] }], ..Default::default() };
        let docx = export("docx", html, "T", "A", Some(&layout)).unwrap();
        let plain = convert_bytes("a.docx", &docx, "pdf", None, false, false).unwrap();
        let balloons = convert_bytes("a.docx", &docx, "pdf", None, false, true).unwrap();
        assert!(plain.starts_with(b"%PDF") && balloons.starts_with(b"%PDF") && plain != balloons);
        assert!(convert_bytes("a.docx", &docx, "txt", None, true, false).is_err(), "markup is for a PDF");
    }

    /// The HTML of a paragraph the editor gave a style, as `documentTools.forFile` writes it
    fn styled(id: &str, text: &str) -> String {
        format!("<p>{}{id}{}{text}</p>", '\u{E000}', '\u{E001}')
    }

    fn part(bytes: &[u8], name: &str) -> String {
        use std::io::Read;
        let mut z = zip::ZipArchive::new(std::io::Cursor::new(bytes.to_vec())).unwrap();
        let mut out = String::new();
        z.by_name(name).unwrap().read_to_string(&mut out).unwrap();
        out
    }

    fn callout() -> super::super::styles::StyleIn {
        super::super::styles::StyleIn { id: "Callout".into(), name: "Callout".into(), font: "Georgia".into(), size: Some(13.0), bold: true, color: "#c00000".into(), ..Default::default() }
    }

    #[test]
    fn a_style_made_in_the_editor_and_a_paragraph_that_uses_it_are_both_in_the_docx() {
        let html = format!("{}<p>Plain text</p>", styled("Callout", "Look here"));
        let layout = Layout { styles: vec![callout()], ..Default::default() };
        let bytes = export("docx", &html, "T", "", Some(&layout)).unwrap();
        let body = part(&bytes, "word/document.xml");
        assert_eq!(body.matches("<w:pStyle w:val=\"Callout\"/>").count(), 1, "one paragraph uses it: {body}");
        assert!(body.contains("Look here") && !body.contains('\u{E000}') && !body.contains('\u{E001}'), "the marker is gone from the text");
        let styles = part(&bytes, "word/styles.xml");
        assert!(styles.contains("w:styleId=\"Callout\"") && styles.contains("Georgia") && styles.contains("C00000") || styles.contains("c00000"), "{styles}");
        // And the file opens with the style in its gallery and the text in the editor without the marker
        let back = import("c.docx", &bytes, None).unwrap();
        assert!(back.styles.iter().any(|s| s.id == "Callout" && s.size == 13.0 && s.bold), "{:?}", back.styles);
        assert!(json(&back).contains("\"styleId\":\"Callout\"") && !json(&back).contains("E000"));
    }

    #[test]
    fn choosing_another_style_for_a_paragraph_whose_text_did_not_change_changes_it_in_the_file() {
        let layout = Layout { styles: vec![callout()], ..Default::default() };
        let original = export("docx", "<p>Hello there</p><p>Second</p>", "T", "", Some(&layout)).unwrap();
        let opened = import("o.docx", &original, None).unwrap();
        assert!(!part(&original, "word/document.xml").contains("w:pStyle w:val=\"Callout\""));
        // The person applied Callout to "Hello there" and changed nothing else: the editor sends the file's styles back unchanged
        let html = format!("{}<p>Second</p>", styled("Callout", "Hello there"));
        let bytes = export_with("docx", &html, "T", "", None, opened.source_id.as_deref()).unwrap();
        let body = part(&bytes, "word/document.xml");
        assert_eq!(body.matches("<w:pStyle w:val=\"Callout\"/>").count(), 1, "{body}");
        assert!(body.find("Callout").unwrap() < body.find("Second").unwrap(), "it is the first paragraph that has it");
    }

    #[test]
    fn a_style_changed_in_the_editor_replaces_the_files_own_definition() {
        let layout = Layout { styles: vec![callout()], ..Default::default() };
        let original = export("docx", &styled("Callout", "Hello there"), "T", "", Some(&layout)).unwrap();
        let opened = import("o.docx", &original, None).unwrap();
        let bigger = super::super::styles::StyleIn { id: "Callout".into(), size: Some(24.0), bold: true, ..Default::default() };
        let bytes = export_with("docx", &styled("Callout", "Hello there"), "T", "", Some(&Layout { styles: vec![bigger], ..Default::default() }), opened.source_id.as_deref()).unwrap();
        let back = import("b.docx", &bytes, None).unwrap();
        let s = back.styles.iter().find(|s| s.id == "Callout").unwrap();
        assert_eq!((s.size, s.font.as_str()), (24.0, "Georgia"), "the size changed and the font stayed");
    }

    fn with_notes(notes: Vec<super::super::notes::NoteIn>) -> Layout {
        Layout { notes: Some(notes), ..Default::default() }
    }

    fn note(id: u32, end: bool, text: &str) -> super::super::notes::NoteIn {
        super::super::notes::NoteIn { id, end, text: text.into() }
    }

    #[test]
    fn a_footnote_added_in_the_editor_is_a_real_footnote_in_the_docx_and_comes_back_as_one() {
        let mark = super::super::notes::marker(1_000_001);
        let html = format!("<p>First line</p><p>A claim{mark} to check.</p>");
        let bytes = export("docx", &html, "T", "", Some(&with_notes(vec![note(1_000_001, false, "Source: the report")]))).unwrap();
        let body = part(&bytes, "word/document.xml");
        assert_eq!(body.matches("<w:footnoteReference").count(), 1, "{body}");
        assert!(!body.contains('\u{E002}') && !body.contains('\u{E003}') && body.contains("A claim"));
        assert!(part(&bytes, "word/footnotes.xml").contains("Source: the report"));
        let back = import("n.docx", &bytes, None).unwrap();
        assert_eq!(back.notes.len(), 1);
        assert_eq!((back.notes[0].text.as_str(), back.notes[0].end), ("Source: the report", false));
        let id = back.notes[0].id;
        assert!(json(&back).contains(&format!("A claim{}", super::super::notes::marker(id))), "{}", json(&back));
    }

    #[test]
    fn a_file_with_a_footnote_keeps_it_unless_the_person_changes_or_removes_it() {
        let mark = super::super::notes::marker(1_000_001);
        let html = format!("<p>Keep me{mark}.</p><p>Other</p>");
        let bytes = export("docx", &html, "T", "", Some(&with_notes(vec![note(1_000_001, false, "Original words")]))).unwrap();
        let opened = import("n.docx", &bytes, None).unwrap();
        let id = opened.notes[0].id;
        let m = super::super::notes::marker(id);
        let same = format!("<p>Keep me{m}.</p><p>Other</p>");
        // Untouched: one note, same words
        let a = export_with("docx", &same, "T", "", Some(&with_notes(vec![note(id, false, "Original words")])), opened.source_id.as_deref()).unwrap();
        assert_eq!(part(&a, "word/document.xml").matches("<w:footnoteReference").count(), 1);
        assert!(part(&a, "word/footnotes.xml").contains("Original words"));
        // The words changed
        let b = export_with("docx", &same, "T", "", Some(&with_notes(vec![note(id, false, "Better words")])), opened.source_id.as_deref()).unwrap();
        let notes = part(&b, "word/footnotes.xml");
        assert!(notes.contains("Better words") && !notes.contains("Original words"), "{notes}");
        // The reference taken out of a paragraph whose other text did not change
        let gone = "<p>Keep me.</p><p>Other</p>";
        let c = export_with("docx", gone, "T", "", Some(&with_notes(vec![])), opened.source_id.as_deref()).unwrap();
        assert_eq!(part(&c, "word/document.xml").matches("<w:footnoteReference").count(), 0, "{}", part(&c, "word/document.xml"));
        // A client that does not know notes leaves them alone
        let d = export_with("docx", gone, "T", "", None, opened.source_id.as_deref()).unwrap();
        assert_eq!(part(&d, "word/document.xml").matches("<w:footnoteReference").count(), 1);
    }

    #[test]
    fn an_endnote_is_an_endnote() {
        let mark = super::super::notes::marker(1_000_002);
        let html = format!("<p>Text{mark}</p>");
        let bytes = export("docx", &html, "T", "", Some(&with_notes(vec![note(1_000_002, true, "At the end")]))).unwrap();
        assert!(part(&bytes, "word/document.xml").contains("<w:endnoteReference"));
        assert!(part(&bytes, "word/endnotes.xml").contains("At the end"));
    }

    /// A paragraph that starts a section, as `documentTools.forFile` writes it
    fn section_start(spec: &str, text: &str) -> String {
        format!("<p>{}{spec}{}{text}</p>", '\u{E004}', '\u{E005}')
    }

    #[test]
    fn a_section_made_in_the_editor_is_a_section_of_the_docx_with_its_own_page_set_up() {
        let html = format!("<p>Portrait one</p><p>Portrait two</p>{}<p>Wide too</p>", section_start("next|l|36,36,36,36|2", "Wide table here"));
        let bytes = export("docx", &html, "T", "", None).unwrap();
        let body = part(&bytes, "word/document.xml");
        assert_eq!(body.matches("<w:sectPr").count(), 2, "{body}");
        assert!(!body.contains('\u{E004}') && !body.contains('\u{E005}'));
        assert_eq!(body.matches("w:orient=\"landscape\"").count(), 1, "only the second section is landscape: {body}");
        assert!(body.contains("w:num=\"2\""), "{body}");
        // It comes back with the break on the first paragraph of the section, and the first section as it was
        let back = import("s.docx", &bytes, None).unwrap();
        let all = json(&back);
        assert!(all.contains("\"sectionBreak\":\"next|l|36,36,36,36|2\""), "{all}");
        assert_eq!(all.matches("sectionBreak").count(), 1);
    }

    #[test]
    fn a_section_a_file_has_is_left_as_it_is_unless_the_person_changes_it() {
        let html = format!("<p>One</p>{}<p>Two B</p>", section_start("next|p|72,72,72,72|1", "Two"));
        let original = export("docx", &html, "T", "", None).unwrap();
        let opened = import("o.docx", &original, None).unwrap();
        let spec = opened.blocks.iter().find_map(|b| b["props"]["sectionBreak"].as_str().map(str::to_string)).expect("the section starts a block");
        assert!(spec.starts_with("next|p|"), "{spec}");
        let same = format!("<p>One</p>{}<p>Two B</p>", section_start(&spec, "Two"));
        let a = export_with("docx", &same, "T", "", None, opened.source_id.as_deref()).unwrap();
        assert_eq!(part(&a, "word/document.xml").matches("<w:sectPr").count(), 2);
        // Continuous, in three columns
        let spec3 = format!("cont|p|{}|3", spec.split('|').nth(2).unwrap());
        let changed = format!("<p>One</p>{}<p>Two B</p>", section_start(&spec3, "Two"));
        let b = export_with("docx", &changed, "T", "", None, opened.source_id.as_deref()).unwrap();
        let body = part(&b, "word/document.xml");
        assert_eq!(body.matches("<w:sectPr").count(), 2, "{body}");
        assert!(body.contains("w:num=\"3\"") && body.contains("w:val=\"continuous\""), "{body}");
    }

    #[test]
    fn a_break_in_a_file_with_one_section_splits_it_and_the_first_part_keeps_what_it_had() {
        let original = export("docx", "<p>One</p><p>Two</p><p>Three</p>", "T", "", Some(&Layout { width: 612.0, height: 792.0, columns: 2, ..Default::default() })).unwrap();
        let opened = import("o.docx", &original, None).unwrap();
        let html = format!("<p>One</p><p>Two</p>{}", section_start("next|l|54,54,54,54|1", "Three"));
        let bytes = export_with("docx", &html, "T", "", None, opened.source_id.as_deref()).unwrap();
        let body = part(&bytes, "word/document.xml");
        assert_eq!(body.matches("<w:sectPr").count(), 2, "{body}");
        let first = body.find("<w:sectPr").unwrap();
        let sect = &body[first..body[first..].find("</w:sectPr>").unwrap() + first];
        assert!(sect.contains("w:num=\"2\"") && !sect.contains("landscape"), "the first section keeps its two columns: {sect}");
        assert_eq!(body.matches("w:orient=\"landscape\"").count(), 1);
    }

    #[test]
    fn what_the_styles_say_comes_into_the_editor_with_each_run() {
        let html = "<h1>Title</h1><p>Plain text</p><p style=\"font-family:Georgia\">Georgia text</p>";
        let back = import("f.docx", &export("docx", html, "T", "", None).unwrap(), None).unwrap();
        let heading = serde_json::to_string(&back.blocks[0]).unwrap();
        assert!(back.blocks[0]["type"] == "heading" && heading.contains("\"fontSize\":\"20pt\""), "the heading's size from its style: {heading}");
        assert!(heading.contains("\"textColor\":\"#"), "the heading's colour from its style: {heading}");
        let all = json(&back);
        assert!(all.contains("\"fontFamily\":\"Georgia\"") && all.contains("\"fontSize\":\"12pt\""), "{all}");
        // Each font comes with its line height, as Word measures it
        assert!(back.fonts.get("Georgia").is_some_and(|k| *k > 1.0 && *k < 1.5), "{:?}", back.fonts);
    }

    #[test]
    fn a_long_document_is_laid_out_on_several_pages_drawn_by_the_layout_engine() {
        let long: String = (0..60).map(|i| format!("<h2 style=\"text-align:center\">Section {i}</h2><p>{}</p>", "Lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(12))).collect();
        let pages = render_pages(&long, "Long", None, 0.5).unwrap();
        assert!(pages.len() > 3, "{} pages", pages.len());
        assert!(pages.iter().all(|p| p.width_pt > 500.0 && p.height_pt > 700.0 && !p.png.is_empty()));
        let one = render_pages("<p>short</p>", "S", None, 0.5).unwrap();
        assert_eq!(one.len(), 1);
        assert!(render_pages("<p>x</p>", "S", None, 99.0).is_ok());
    }

    #[test]
    fn spacing_and_contents_lines_reach_the_editor_as_attributes() {
        let page = "<html><body><h1>Cover</h1><p>Body text.</p><p>Chapter one\t12</p></body></html>";
        let mut doc = wordcraft_formats::import("html", page.as_bytes()).unwrap().unwrap();
        if let wordcraft_doc::Block::Para(p) = std::sync::Arc::make_mut(&mut doc.body[1]) {
            p.props.space_after = Some(30.0);
        }
        doc.styles.styles.push(wordcraft_doc::Style { id: "TOC1".into(), name: "toc 1".into(), kind: wordcraft_doc::StyleKind::Paragraph, ..Default::default() });
        if let wordcraft_doc::Block::Para(p) = std::sync::Arc::make_mut(&mut doc.body[2]) {
            p.props.style = Some("TOC1".into());
            p.text = p.text.replace("one 12", "one\t12");
        }
        let bytes = wordcraft_docx::write(&doc).unwrap();
        let opened = import("toc.docx", &bytes, None).unwrap();
        assert_eq!(opened.blocks[1]["props"]["spaceAfter"], 30.0, "the paragraph's own spacing is carried: {}", json(&opened));
        assert!(json(&opened).contains("Chapter one"));
    }

    #[test]
    fn a_file_keeps_its_sections_spacing_and_vertical_centring_through_the_editor_and_back() {
        // A file with things the editor cannot hold: a page centred between its margins, and a paragraph with its own spacing
        let page = "<html><body><h1>Cover</h1><p>Intro text.</p><p>Body text.</p></body></html>";
        let mut doc = wordcraft_formats::import("html", page.as_bytes()).unwrap().unwrap();
        doc.last_section.valign = wordcraft_doc::section::PageVAlign::Center;
        if let wordcraft_doc::Block::Para(p) = std::sync::Arc::make_mut(&mut doc.body[2]) {
            p.props.space_after = Some(41.0);
        }
        let bytes = wordcraft_docx::write(&doc).unwrap();
        let opened = import("cover.docx", &bytes, None).unwrap();
        assert_eq!(opened.layout.valign, "center");
        let id = opened.source_id.clone().unwrap();
        // The editor hands back its text (one word changed) and the page set-up as it was given
        let html = "<h1>Cover</h1><p>Intro text.</p><p>Body text, edited.</p>";
        let kept = export_with("docx", html, "Cover", "", Some(&opened.layout), Some(&id)).unwrap();
        let back = wordcraft_docx::read_with_password(&kept, None).unwrap();
        assert_eq!(back.last_section.valign, wordcraft_doc::section::PageVAlign::Center, "the centred page stays centred");
        assert!(matches!(&*back.body[2], wordcraft_doc::Block::Para(p) if p.props.space_after == Some(41.0) && p.plain_text().contains("edited")), "the edited paragraph keeps its spacing");
        // Without the file there is nothing to bring back
        let plain = wordcraft_docx::read_with_password(&export_with("docx", html, "Cover", "", Some(&opened.layout), None).unwrap(), None).unwrap();
        assert_ne!(plain.body[2].as_para().and_then(|p| p.props.space_after), Some(41.0));
        // And the page set-up the person changes wins
        let moved = Layout { valign: "bottom".into(), ..opened.layout.clone() };
        let changed = wordcraft_docx::read_with_password(&export_with("docx", html, "Cover", "", Some(&moved), Some(&id)).unwrap(), None).unwrap();
        assert_eq!(changed.last_section.valign, wordcraft_doc::section::PageVAlign::Bottom);
    }

    #[test]
    fn pages_are_laid_out_once_and_drawn_one_at_a_time() {
        let long: String = (0..40).map(|i| format!("<h2>Section {i}</h2><p>{}</p>", "Lorem ipsum dolor sit amet. ".repeat(20))).collect();
        let list = lay_out(&long, "Long", None, None).unwrap();
        assert!(list.sizes.len() > 3);
        let page = draw_page(list.session, 1, 0.5).unwrap();
        assert!(!page.png.is_empty() && page.width_pt > 500.0);
        assert!(draw_page(list.session, 9999, 0.5).is_err());
        assert!(draw_page(u64::MAX, 0, 0.5).is_err());
    }

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
            let h = json(&back).to_lowercase();
            assert!(h.contains("report") && h.contains("hello") && h.contains("bold") && h.contains("one") && h.contains("two"), "{ext}: {h}");
            if ext != "md" && ext != "rtf" {
                assert!(h.contains("\"type\":\"table\""), "{ext} lost its table: {h}");
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
        let back = json(&import("f.docx", &export("docx", html, "T", "", None).unwrap(), None).unwrap()).to_lowercase();
        assert!(back.contains("\"24pt\""), "size: {back}");
        assert!(back.contains("georgia"), "font: {back}");
        assert!(back.contains("\"textalignment\":\"center\""), "alignment: {back}");
        assert!(back.contains("\"textalignment\":\"right\""), "alignment: {back}");
        assert!(back.contains("\"underline\":true"), "underline: {back}");
        assert!(back.contains("\"strike\":true"), "strike: {back}");
        assert!(back.contains("e03e3e"), "colour: {back}");
        assert!(back.contains("\"type\":\"heading\""), "heading: {back}");
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
        let h = json(&back);
        assert!(back.blocks[0]["type"] == "heading" && back.blocks[0]["props"]["level"] == 1, "{h}");
        let bold = back.blocks[1]["content"].as_array().unwrap().iter().find(|t| t["text"] == "bold").unwrap();
        assert_eq!(bold["styles"]["bold"], true, "{h}");
        assert!(back.blocks[1]["content"].as_array().unwrap().iter().any(|t| t["type"] == "link" && t["href"] == "https://example.com/x"), "{h}");
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
        let h = json(&md);
        assert!(md.blocks[0]["type"] == "heading" && h.contains("\"text\":\"text\"") && h.contains("\"italic\":true") && h.contains("\"listLabel\""), "{h}");
        assert_eq!(import("n.txt", b"line one\n\nline two", None).unwrap().inspect.words, 4);
    }

}
