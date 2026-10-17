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
    /// The page set-up the file has, for the editor's page and header settings to start from
    pub layout: Layout,
    /// The file as it was read, kept so that drawing or saving can bring back what the editor does not hold (see `merge`)
    pub source_id: Option<String>,
}

/// How a document sits on paper: what the Layout tab and the page set-up say, written into the file
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
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
    /// Where the text sits between the top and bottom margins of each page: `top`, `center`, `bottom` or `justify`
    pub valign: String,
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
/// Joins neighbouring spans that carry the same style (`<span style="a">x</span><span style="a">y</span>`): flattening the styles puts one on
/// every run, and a long file would otherwise hand the editor tens of thousands of elements for the same look
fn merge_spans(html: &str) -> String {
    const JOIN: &str = "</span><span style=\"";
    let mut out = String::with_capacity(html.len());
    let mut rest = html;
    // The style of the span that is open, when what is inside it so far is plain text
    while let Some(at) = rest.find(JOIN) {
        let (before, after) = rest.split_at(at);
        let tail = &after[JOIN.len()..];
        let Some(end) = tail.find("\">") else { break };
        let style = &tail[..end];
        let opener = format!("<span style=\"{style}\">");
        let same = out.len() + before.len() >= opener.len()
            && before.rfind("<span style=\"").is_some_and(|i| before[i..].starts_with(&opener) && !before[i + opener.len()..].contains('<'))
            || (before.rfind("<span style=\"").is_none() && out.rfind("<span style=\"").is_some_and(|i| out[i..].starts_with(&opener) && !out[i + opener.len()..].contains('<') && before.find('<').is_none()));
        out.push_str(before);
        if same {
            rest = &tail[end + 2..];
        } else {
            out.push_str(JOIN);
            rest = tail;
        }
    }
    out.push_str(rest);
    out
}

fn body_of(html: &str) -> String {
    let start = html.find("<body").and_then(|i| html[i..].find('>').map(|j| i + j + 1)).unwrap_or(0);
    let end = html.rfind("</body>").unwrap_or(html.len());
    html[start..end.max(start)].trim().to_string()
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
    let flatten = package || matches!(ext.as_str(), "rtf" | "doc" | "dot");
    let names = if package && !bytes.starts_with(&[0xD0, 0xCF, 0x11, 0xE0]) { check_package(bytes).map_err(Refusal::text)? } else { Vec::new() };
    let doc = read_document(&ext, bytes, password)?;
    let layout = super::merge::layout_of(&doc);
    let source_id = Some(super::merge::keep(bytes, &ext, &doc));
    // The editor shows what is written on each run, so what the styles say (the font of a heading, the size of the body, a colour from a
    // character style) is written there first
    let mut doc = doc;
    if flatten {
        let _ = catch_unwind(AssertUnwindSafe(|| flatten_styles(&mut doc)));
    }
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
    Ok(Imported { html: merge_spans(&lift_notes(&body_of(&html))), title, inspect, layout, source_id })
}

/// The font and size the editor's page starts from; a run is given a font or size only where the file asks for another
const EDITOR_FONT: &str = "Calibri";
const EDITOR_SIZE: f32 = 11.0;

/// Opens and closes the note a paragraph carries its spacing in (private-use characters, so it cannot be mistaken for text)
const NOTE_OPEN: char = '\u{E000}';
const NOTE_CLOSE: char = '\u{E001}';

/// HTML has nowhere to put a paragraph's spacing, indent or table-of-contents look, so they are written at the start of its text, as a note
/// `lift_notes` turns into an attribute of the paragraph's element (the editor reads it from there)
fn mark_spacing(p: &mut wordcraft_doc::Paragraph, styles: &wordcraft_doc::StyleSheet, section: Option<(bool, char)>) {
    if p.text.is_empty() {
        return;
    }
    let r = styles.resolve_para(&p.props);
    let listed = r.numbering.is_some();
    // A line of a table of contents ("Title<tab>12"): the page number goes to the right edge
    let is_toc = |s: &str| s.len() > 3 && s.is_char_boundary(3) && s[..3].eq_ignore_ascii_case("toc") && matches!(s.as_bytes()[3], b'0'..=b'9' | b' ');
    let named = p.props.style.as_deref().and_then(|id| styles.styles.iter().find(|s| s.id == id)).is_some_and(|s| is_toc(&s.name));
    let toc = (named || p.props.style.as_deref().is_some_and(is_toc)) && p.text.matches('\t').count() == 1;
    let (left, first) = if listed { (0.0, 0.0) } else { (r.indent_left, r.indent_first) };
    let (brk, valign) = section.unwrap_or((false, '-'));
    let note = format!("{NOTE_OPEN}{:.1},{:.1},{:.1},{:.1},{},{},{valign},{}{NOTE_CLOSE}", r.space_before, r.space_after, left, first, u8::from(toc), u8::from(brk), u8::from(r.keep_next));
    p.text.insert_str(0, &note);
    p.runs.insert(0, wordcraft_doc::Run { len: note.len(), props: Default::default() });
}

/// Moves each note `mark_spacing` wrote from the text into a `data-nx-sp` attribute on the element before it
fn lift_notes(html: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let mut rest = html;
    while let Some(at) = rest.find(NOTE_OPEN) {
        let after = &rest[at + NOTE_OPEN.len_utf8()..];
        let Some(end) = after.find(NOTE_CLOSE) else { break };
        let note = &after[..end];
        let head = &rest[..at];
        match head.strip_suffix('>') {
            Some(tag) => {
                out.push_str(tag);
                out.push_str(&format!(" data-nx-sp=\"{note}\">"));
            }
            None => out.push_str(head),
        }
        rest = &after[end + NOTE_CLOSE.len_utf8()..];
    }
    out.push_str(rest);
    out
}

/// Writes what the styles say into each run (font, size, bold, italic, underline, colour), so the HTML the editor is filled from carries
/// it: Word files keep most of their look in named styles, and HTML has nowhere to put those.
fn flatten_styles(doc: &mut wordcraft_doc::Document) {
    use std::sync::Arc;
    use wordcraft_doc::{props::TextColor, Block, Blocks};

    fn blocks(list: &mut Blocks, styles: &wordcraft_doc::StyleSheet, starts: &std::collections::HashMap<usize, (bool, char)>) {
        for (i, b) in list.iter_mut().enumerate() {
            match Arc::make_mut(b) {
                Block::Para(p) => para(p, styles, starts.get(&i).copied()),
                Block::Table(t) => {
                    for row in &mut t.rows {
                        for cell in &mut row.cells {
                            blocks(&mut cell.blocks, styles, &std::collections::HashMap::new());
                        }
                    }
                }
            }
        }
    }
    fn para(p: &mut wordcraft_doc::Paragraph, styles: &wordcraft_doc::StyleSheet, section: Option<(bool, char)>) {
        let style = p.props.style.clone();
        // Centring and the like that comes from the paragraph's style, not from the paragraph itself
        let resolved = styles.resolve_para(&p.props);
        let aligned = resolved.align;
        // A title or heading whose style names no colour is black in Word; the editor would otherwise paint its own heading colour
        let heading = resolved.outline_level.is_some() || style.as_deref().is_some_and(|s| matches!(s, "Title" | "Subtitle"));
        if p.props.align.is_none() && aligned != wordcraft_doc::props::Align::Left {
            p.props.align = Some(aligned);
        }
        for run in &mut p.runs {
            let r = styles.resolve_char(style.as_deref(), &run.props);
            if !r.font.is_empty() && !r.font.eq_ignore_ascii_case(EDITOR_FONT) {
                run.props.font = Some(r.font.clone());
            }
            if r.size > 0.0 && (r.size - EDITOR_SIZE).abs() > 0.05 {
                run.props.size = Some(r.size);
            }
            if r.bold {
                run.props.bold = Some(true);
            }
            if r.italic {
                run.props.italic = Some(true);
            }
            if r.underline != wordcraft_doc::props::Underline::None {
                run.props.underline = Some(r.underline);
            }
            if let TextColor::Rgb(c) = r.color {
                run.props.color = Some(TextColor::Rgb(c));
            } else if heading {
                run.props.color = Some(TextColor::Rgb(wordcraft_doc::Rgb(0, 0, 0)));
            }
        }
        mark_spacing(p, styles, section);
    }
    let styles = doc.styles.clone();
    let starts = section_starts(doc);
    blocks(&mut doc.body, &styles, &starts);
}

/// For the first paragraph of each section of a file with several: whether the section starts a new page, and how its text sits on the
/// page (`c`entre, `b`ottom, `j`ustify, `-` top). The editor has one page set-up, so these ride on the paragraph like its spacing.
fn section_starts(doc: &wordcraft_doc::Document) -> std::collections::HashMap<usize, (bool, char)> {
    use wordcraft_doc::{section::{PageVAlign, SectionStart}, Block};
    let mut ends: Vec<(usize, &wordcraft_doc::SectionProps)> = doc.body.iter().enumerate().filter_map(|(i, b)| if let Block::Para(p) = &**b { p.section.as_deref().map(|s| (i, s)) } else { None }).collect();
    let mut out = std::collections::HashMap::new();
    if ends.is_empty() {
        return out;
    }
    ends.push((doc.body.len().saturating_sub(1), &doc.last_section));
    let mut start = 0;
    for (k, (end, s)) in ends.iter().enumerate() {
        let valign = match s.valign {
            PageVAlign::Center => 'c',
            PageVAlign::Bottom => 'b',
            PageVAlign::Justify => 'j',
            _ => '-',
        };
        let brk = k > 0 && s.start != SectionStart::Continuous;
        if (brk || valign != '-') && start <= *end {
            if let Some(i) = (start..=*end).find(|&i| matches!(&*doc.body[i], Block::Para(p) if !p.text.is_empty())) {
                out.insert(i, (brk, valign));
            }
        }
        start = end + 1;
    }
    out
}

/// The document the editor's HTML stands for. With the file it came from (`source`), that file is brought up to date with the text, so
/// the styles, sections, headers and footers the editor does not hold are still there; without one it is made from the HTML alone.
fn build_document(html: &str, title: &str, author: &str, layout: Option<&Layout>, source: Option<&str>) -> Result<wordcraft_doc::Document, String> {
    let page = format!("<!doctype html><html><head><meta charset=\"utf-8\"><title>{}</title></head><body>{html}</body></html>", escape(title));
    let edited = wordcraft_formats::import("html", page.as_bytes()).ok_or("The document could not be read.")??;
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
    }
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
    catch_unwind(AssertUnwindSafe(|| PageImage { png: BASE64_STANDARD.encode(wordcraft_render::render_page(&laid.doc, page, scale, &wordcraft_render::RenderOptions::default()).to_png()), width_pt: page.w, height_pt: page.h }))
        .map_err(|_| "That page could not be drawn safely.".to_string())
}

/// One page of a document as a picture, with its size in points
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PageImage {
    pub png: String,
    pub width_pt: f32,
    pub height_pt: f32,
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
            .map(|p| PageImage { png: BASE64_STANDARD.encode(wordcraft_render::render_page(&doc, p, scale, &opts).to_png()), width_pt: p.w, height_pt: p.h })
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

/// Saves the editor's document as a file in the format its name ends in, at a place the person chose
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn office_export(app_handle: tauri::AppHandle, path: String, dest: String, html: String, title: String, author: String, layout: Option<Layout>, source_id: Option<String>) -> Result<usize, String> {
    validate_allowed_root(&app_handle, &path)?;
    let dest = crate::commands::workspace::export::check_destination(&path, &dest, EXPORTABLE)?;
    let ext = ext_of(&dest.to_string_lossy());
    let bytes = tokio::task::spawn_blocking(move || export_with(&ext, &html, &title, &author, layout.as_ref(), source_id.as_deref())).await.map_err(|e| e.to_string())??;
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
    fn what_the_styles_say_comes_into_the_editor_with_each_run() {
        let html = "<h1>Title</h1><p>Plain text</p><p style=\"font-family:Georgia\">Georgia text</p>";
        let back = import("f.docx", &export("docx", html, "T", "", None).unwrap(), None).unwrap().html;
        let heading = back.split("</h1>").next().unwrap();
        assert!(heading.contains("font-size:20pt"), "the heading's size from its style: {heading}");
        assert!(heading.contains("color:#"), "the heading's colour from its style: {heading}");
        assert!(back.contains("font-family:'Georgia'"));
        // This file's own body font and size (Aptos 12) are written on the runs, since the editor starts from Calibri 11
        assert!(back.contains("font-size:12pt"));
    }

    /// The HTML without its `<span style="...">` openers, to read the structure
    fn regex_free_strip_spans(h: &str) -> String {
        let mut out = String::new();
        let mut rest = h;
        while let Some(i) = rest.find("<span") {
            out.push_str(&rest[..i]);
            rest = &rest[i..];
            rest = rest.find('>').map_or("", |e| &rest[e + 1..]);
        }
        out.push_str(rest);
        out
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
        assert!(opened.html.contains("data-nx-sp=\"") && !opened.html.contains('\u{E000}') && !opened.html.contains('\u{E001}'), "{}", opened.html);
        assert!(opened.html.contains(",30.0,"), "the paragraph's own spacing is carried: {}", opened.html);
        assert!(opened.html.contains(",1,0,-,") && opened.html.contains("Chapter one"), "a contents line is marked: {}", opened.html);
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
        let html = opened.html.replace("Body text.", "Body text, edited.");
        let kept = export_with("docx", &html, "Cover", "", Some(&opened.layout), Some(&id)).unwrap();
        let back = wordcraft_docx::read_with_password(&kept, None).unwrap();
        assert_eq!(back.last_section.valign, wordcraft_doc::section::PageVAlign::Center, "the centred page stays centred");
        assert!(matches!(&*back.body[2], wordcraft_doc::Block::Para(p) if p.props.space_after == Some(41.0) && p.plain_text().contains("edited")), "the edited paragraph keeps its spacing");
        // Without the file there is nothing to bring back
        let plain = wordcraft_docx::read_with_password(&export_with("docx", &html, "Cover", "", Some(&opened.layout), None).unwrap(), None).unwrap();
        assert_ne!(plain.body[2].as_para().and_then(|p| p.props.space_after), Some(41.0));
        // And the page set-up the person changes wins
        let moved = Layout { valign: "bottom".into(), ..opened.layout.clone() };
        let changed = wordcraft_docx::read_with_password(&export_with("docx", &html, "Cover", "", Some(&moved), Some(&id)).unwrap(), None).unwrap();
        assert_eq!(changed.last_section.valign, wordcraft_doc::section::PageVAlign::Bottom);
    }

    #[test]
    fn neighbouring_spans_with_the_same_style_are_joined_and_different_ones_are_not() {
        let html = "<p><span style=\"a:1\">one </span><span style=\"a:1\">two </span><span style=\"b:2\">three</span><strong><span style=\"b:2\">x</span></strong><span style=\"b:2\">y</span></p>";
        assert_eq!(merge_spans(html), "<p><span style=\"a:1\">one two </span><span style=\"b:2\">three</span><strong><span style=\"b:2\">x</span></strong><span style=\"b:2\">y</span></p>");
        assert_eq!(merge_spans("<p>plain</p>"), "<p>plain</p>");
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
        let h = back.html.to_lowercase().replace("</span>", "");
        let h = regex_free_strip_spans(&h);
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
