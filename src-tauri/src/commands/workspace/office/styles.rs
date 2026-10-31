//! Named paragraph styles between the editor and the file.
//!
//! A Word file names the looks of its paragraphs ("Title", "Caption", a company's own "Callout") and a paragraph points at one by id. The
//! editor works on direct formatting, so until now a file's own styles never reached it (the Styles gallery had six fixed looks), and a style
//! applied or changed in the editor reached the file only as formatting on the text. Three steps close that:
//!
//! - **Reading**: [`styles_of`] lists the file's paragraph styles with the look each gives (font, size, colour, spacing...), for the gallery.
//! - **Writing**: the editor sends the styles that were made or changed there ([`StyleIn`]); [`apply`] puts them into the file's styles.
//! - **Pointing**: the editor's HTML marks each styled paragraph with its style id as a short run of private-use characters at the start of
//!   its text (`documentTools.forFile`); [`take_markers`] removes them straight after the HTML is read, and [`settle`] sets the styles on the
//!   paragraphs of the finished document (the merge keeps one block for each block of the editor, so the position is enough).

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use wordcraft_doc::{
    props::{LineSpacing, Underline},
    Align, Block, CharProps, Document, Paragraph, ParaProps, Rgb, Style, StyleKind, TextColor,
};

/// The characters around a style id at the start of a paragraph's text in the editor's HTML (private use, so no text has them)
const OPEN: char = '\u{E000}';
const CLOSE: char = '\u{E001}';

/// Styles the gallery already has under other names (see `documentFormat.STYLES`), so they are not listed again
const IN_GALLERY: &[&str] = &["Normal", "Heading1", "Heading2", "Heading3", "Quote"];

/// A paragraph style made or changed in the editor, to be written into the file's styles
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct StyleIn {
    /// Without spaces; what paragraphs point at
    pub id: String,
    pub name: String,
    /// The style this one starts from; none means Normal
    pub based_on: String,
    pub font: String,
    /// Points
    pub size: Option<f32>,
    pub bold: bool,
    pub italic: bool,
    pub underline: bool,
    /// `#rrggbb`, or empty for the text colour of the style it is based on
    pub color: String,
    /// left, center, right or justify; empty for the style it is based on
    pub align: String,
    pub space_before: Option<f32>,
    pub space_after: Option<f32>,
    /// A multiple of single spacing (1.15), or, below zero, exactly that many points
    pub line_spacing: Option<f32>,
    /// "character" for a style of the letters, "table" for a style of tables; empty for a style of paragraphs
    pub kind: String,
    /// What a table style gives
    pub table: Option<TableLook>,
}

/// What a table style gives, as the editor draws and sets it: the fill of the header row (and its bold text), of the odd rows and of every cell
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct TableLook {
    pub header_fill: String,
    pub header_color: String,
    pub header_bold: bool,
    pub band_fill: String,
    pub fill: String,
}

/// A paragraph style of a file as the gallery shows it
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StyleOut {
    pub id: String,
    pub name: String,
    pub based_on: Option<String>,
    pub font: String,
    pub size: f32,
    pub bold: bool,
    pub italic: bool,
    pub underline: bool,
    /// `#rrggbb`, or empty for automatic
    pub color: String,
    pub align: String,
    pub space_before: f32,
    pub space_after: f32,
    pub line_spacing: f32,
    /// 0 for body text, 1 to 9 for a heading level
    pub outline: u8,
    /// Some paragraph of the document has it
    pub used: bool,
    /// "paragraph", "character" or "table"
    pub kind: String,
    pub table: Option<TableLook>,
}

fn used_styles(blocks: &[Arc<Block>], out: &mut std::collections::BTreeSet<String>) {
    for b in blocks {
        match &**b {
            Block::Para(p) => {
                if let Some(s) = &p.props.style {
                    out.insert(s.clone());
                }
                out.extend(p.runs.iter().filter_map(|r| r.props.style.clone()));
            }
            Block::Table(t) => {
                if let Some(s) = &t.props.style {
                    out.insert(s.clone());
                }
                t.rows.iter().for_each(|r| r.cells.iter().for_each(|c| used_styles(&c.blocks, out)));
            }
        }
    }
}

fn hex(c: &TextColor) -> String {
    match c {
        TextColor::Rgb(Rgb(r, g, b)) => format!("#{r:02x}{g:02x}{b:02x}"),
        TextColor::Auto => String::new(),
    }
}

/// The table look a table style gives: its own fields, else those of the style it is based on
fn table_look(doc: &Document, id: &str) -> TableLook {
    let mut look = TableLook::default();
    let mut at = Some(id.to_string());
    for _ in 0..20 {
        let Some(cur) = at else { break };
        let Some(st) = doc.styles.styles.iter().find(|e| e.id == cur) else { break };
        if let Some(t) = &st.table {
            let color = |c: &Option<Rgb>| c.map(|Rgb(r, g, b)| format!("#{r:02x}{g:02x}{b:02x}")).unwrap_or_default();
            if look.header_fill.is_empty() {
                look.header_fill = color(&t.header_fill);
            }
            if look.band_fill.is_empty() && t.band_size.is_some_and(|n| n > 0) {
                look.band_fill = color(&t.band_fill);
            }
            if look.fill.is_empty() {
                look.fill = color(&t.fill);
            }
            if look.header_color.is_empty() {
                look.header_color = match &t.header_chr.color {
                    Some(c) => hex(c),
                    None => String::new(),
                };
            }
            look.header_bold |= t.header_chr.bold == Some(true);
        }
        at = st.based_on.clone();
    }
    look
}

/// The styles a file has that the gallery should offer: paragraph, character and table styles that something uses, that the file shows in its
/// own gallery, or that somebody made; but not the ones the gallery has already, nor the character style Word links to each heading
pub fn styles_of(doc: &Document) -> Vec<StyleOut> {
    let mut used = std::collections::BTreeSet::new();
    used_styles(&doc.body, &mut used);
    doc.styles
        .styles
        .iter()
        .filter(|s| {
            let kind_ok = match s.kind {
                StyleKind::Paragraph => true,
                StyleKind::Character => s.linked.is_none(),
                StyleKind::Table => true,
                StyleKind::Numbering => false,
            };
            kind_ok && !s.hidden && !s.default && !s.id.is_empty() && !IN_GALLERY.contains(&s.id.as_str()) && (used.contains(&s.id) || s.quick || !s.builtin)
        })
        .map(|s| {
            let p = doc.styles.resolve_para(&ParaProps { style: Some(s.id.clone()), ..Default::default() });
            // A character style is resolved as the style of a run; a paragraph or table style as the style of the text of a paragraph
            let c = if s.kind == StyleKind::Character { doc.styles.resolve_char(None, &CharProps { style: Some(s.id.clone()), ..Default::default() }) } else { doc.styles.resolve_char(Some(&s.id), &CharProps::default()) };
            StyleOut {
                id: s.id.clone(),
                name: if s.name.is_empty() { s.id.clone() } else { s.name.clone() },
                based_on: s.based_on.clone(),
                font: c.font.clone(),
                size: c.size,
                bold: c.bold,
                italic: c.italic,
                underline: c.underline != Underline::None,
                color: hex(&c.color),
                align: match p.align {
                    Align::Center => "center",
                    Align::Right => "right",
                    Align::Justify | Align::Distribute => "justify",
                    Align::Left => "left",
                }
                .to_string(),
                space_before: p.space_before,
                space_after: p.space_after,
                line_spacing: match p.line_spacing {
                    LineSpacing::Multiple(m) => m,
                    LineSpacing::AtLeast(x) | LineSpacing::Exactly(x) => -x,
                },
                outline: p.outline_level.map_or(0, |l| l + 1),
                used: used.contains(&s.id),
                kind: match s.kind {
                    StyleKind::Character => "character",
                    StyleKind::Table => "table",
                    _ => "paragraph",
                }
                .to_string(),
                table: (s.kind == StyleKind::Table).then(|| table_look(doc, &s.id)),
            }
        })
        .collect()
}

fn parse_color(s: &str) -> Option<Rgb> {
    let h = s.strip_prefix('#').unwrap_or(s);
    if h.len() != 6 {
        return None;
    }
    let n = u32::from_str_radix(h, 16).ok()?;
    Some(Rgb((n >> 16) as u8, (n >> 8) as u8, n as u8))
}

/// A style of the letters: the look of the text it is given (no paragraph properties)
fn apply_character(doc: &mut Document, s: &StyleIn) {
    let at = doc.styles.styles.iter().position(|e| e.id == s.id);
    if at.is_some_and(|i| doc.styles.styles[i].kind != StyleKind::Character) {
        return;
    }
    let mut st = at.map(|i| doc.styles.styles[i].clone()).unwrap_or_else(|| Style { id: s.id.clone(), kind: StyleKind::Character, quick: true, ..Default::default() });
    st.name = if s.name.trim().is_empty() { s.id.clone() } else { s.name.trim().chars().take(80).collect() };
    if !s.font.is_empty() {
        st.chr.font = Some(s.font.clone());
    }
    if let Some(size) = s.size.filter(|z| *z > 0.0) {
        st.chr.size = Some(size);
    }
    st.chr.bold = Some(s.bold);
    st.chr.italic = Some(s.italic);
    st.chr.underline = Some(if s.underline { Underline::Single } else { Underline::None });
    if let Some(c) = parse_color(&s.color) {
        st.chr.color = Some(TextColor::Rgb(c));
    }
    match at {
        Some(i) => doc.styles.styles[i] = st,
        None => doc.styles.styles.push(st),
    }
}

/// A style of tables: the fill of the header row (bold, in a colour) and of every second row
fn apply_table(doc: &mut Document, s: &StyleIn) {
    use wordcraft_doc::styles::TableStyleParts;
    let Some(look) = &s.table else { return };
    let at = doc.styles.styles.iter().position(|e| e.id == s.id);
    if at.is_some_and(|i| doc.styles.styles[i].kind != StyleKind::Table) {
        return;
    }
    let mut st = at.map(|i| doc.styles.styles[i].clone()).unwrap_or_else(|| Style { id: s.id.clone(), kind: StyleKind::Table, quick: true, ..Default::default() });
    st.name = if s.name.trim().is_empty() { s.id.clone() } else { s.name.trim().chars().take(80).collect() };
    let mut parts = st.table.take().unwrap_or_default();
    // A style the file made keeps what this does not say (its borders, its other regions); the fills and the header text are set here
    let none_if_empty = |h: &str| parse_color(h);
    parts.header_fill = none_if_empty(&look.header_fill);
    parts.fill = none_if_empty(&look.fill);
    parts.band_fill = none_if_empty(&look.band_fill);
    parts.band_size = Some(u32::from(parts.band_fill.is_some()));
    parts.header_chr.bold = look.header_bold.then_some(true);
    parts.header_chr.color = parse_color(&look.header_color).map(TextColor::Rgb);
    let _: &TableStyleParts = &parts;
    st.table = Some(parts);
    match at {
        Some(i) => doc.styles.styles[i] = st,
        None => doc.styles.styles.push(st),
    }
}

/// Whether `from` is `id`, or is based (through any number of styles) on it: a style that would be based on itself
fn chain_has(doc: &Document, from: &str, id: &str) -> bool {
    let mut at = Some(from.to_string());
    for _ in 0..40 {
        let Some(cur) = at else { return false };
        if cur == id {
            return true;
        }
        at = doc.styles.styles.iter().find(|e| e.id == cur).and_then(|e| e.based_on.clone());
    }
    true
}

/// Writes the styles made or changed in the editor into the document's styles: one with an id the file has is changed in the fields given, any
/// other is added (shown in the file's own gallery)
pub fn apply(doc: &mut Document, styles: &[StyleIn]) {
    for s in styles.iter().filter(|s| !s.id.trim().is_empty() && s.id.len() <= 80 && !s.id.contains(char::is_whitespace)) {
        match s.kind.as_str() {
            "character" => {
                apply_character(doc, s);
                continue;
            }
            "table" => {
                apply_table(doc, s);
                continue;
            }
            _ => {}
        }
        let at = doc.styles.styles.iter().position(|e| e.id == s.id);
        let mut st = at.map(|i| doc.styles.styles[i].clone()).unwrap_or_else(|| Style {
            id: s.id.clone(),
            kind: StyleKind::Paragraph,
            next: Some(s.id.clone()),
            quick: true,
            ..Default::default()
        });
        if !s.name.trim().is_empty() {
            st.name = s.name.trim().chars().take(80).collect();
        } else if st.name.is_empty() {
            st.name = s.id.clone();
        }
        // A new style starts from Normal; a changed one keeps what it started from
        if at.is_none() || !s.based_on.is_empty() {
            let base = if s.based_on.is_empty() { "Normal" } else { s.based_on.as_str() };
            if base != s.id && doc.styles.styles.iter().any(|e| e.id == base) && !chain_has(doc, base, &s.id) {
                st.based_on = Some(base.to_string());
            }
        }
        // What the style it is based on gives: a field that is the same is not written, so the style follows the base when the base changes
        // (a style that is based on nothing, or on a style that is itself based on this one, writes every field)
        let base_look = st.based_on.clone().filter(|b| !chain_has(doc, b, &s.id)).map(|b| {
            (doc.styles.resolve_char(Some(&b), &CharProps::default()), doc.styles.resolve_para(&ParaProps { style: Some(b.clone()), ..Default::default() }))
        });
        let (bc, bp) = match &base_look {
            Some((c, p)) => (Some(c), Some(p)),
            None => (None, None),
        };
        let differs = |v: bool, base: Option<bool>| base.is_none_or(|b| b != v);
        // A field the editor sent is written when it is not what the base gives; one it left out stays as the style had it
        if !s.font.is_empty() {
            st.chr.font = bc.is_none_or(|b| b.font != s.font).then(|| s.font.clone());
        }
        if let Some(z) = s.size.filter(|z| *z > 0.0) {
            st.chr.size = bc.is_none_or(|b| (b.size - z).abs() > 0.01).then_some(z);
        }
        st.chr.bold = differs(s.bold, bc.map(|b| b.bold)).then_some(s.bold);
        st.chr.italic = differs(s.italic, bc.map(|b| b.italic)).then_some(s.italic);
        st.chr.underline = differs(s.underline, bc.map(|b| b.underline != Underline::None)).then_some(if s.underline { Underline::Single } else { Underline::None });
        if let Some(c) = parse_color(&s.color) {
            st.chr.color = bc.is_none_or(|b| hex(&b.color) != hex(&TextColor::Rgb(c))).then_some(TextColor::Rgb(c));
        }
        let align = match s.align.as_str() {
            "left" => Some(Align::Left),
            "center" => Some(Align::Center),
            "right" => Some(Align::Right),
            "justify" => Some(Align::Justify),
            _ => None,
        };
        if let Some(a) = align {
            st.para.align = bp.is_none_or(|b| b.align != a).then_some(a);
        }
        let num_differs = |v: f32, base: Option<f32>| base.is_none_or(|b| (b - v).abs() > 0.01);
        if let Some(v) = s.space_before.filter(|v| *v >= 0.0) {
            st.para.space_before = num_differs(v, bp.map(|b| b.space_before)).then_some(v);
        }
        if let Some(v) = s.space_after.filter(|v| *v >= 0.0) {
            st.para.space_after = num_differs(v, bp.map(|b| b.space_after)).then_some(v);
        }
        let line = s.line_spacing.filter(|l| *l != 0.0).map(|l| if l < 0.0 { LineSpacing::Exactly(-l) } else { LineSpacing::Multiple(l) });
        if let Some(l) = line {
            st.para.line_spacing = bp.is_none_or(|b| b.line_spacing != l).then_some(l);
        }
        match at {
            Some(i) => doc.styles.styles[i] = st,
            None => doc.styles.styles.push(st),
        }
    }
}

/// Takes the style markers off the paragraphs of a document read from the editor's HTML. Returns, for each top-level paragraph that had one,
/// its place in the body, the style id, and the style the HTML reader gave it by its tag (Heading2 for an h2).
pub fn take_markers(doc: &mut Document) -> Vec<(usize, String, Option<String>)> {
    fn drop_marker(p: &mut Paragraph) -> Option<String> {
        if !p.text.starts_with(OPEN) {
            return None;
        }
        let end = p.text.find(CLOSE)?;
        let id = p.text[OPEN.len_utf8()..end].to_string();
        let n = end + CLOSE.len_utf8();
        p.text.drain(..n);
        let mut left = n;
        for r in &mut p.runs {
            let t = left.min(r.len);
            r.len -= t;
            left -= t;
            if left == 0 {
                break;
            }
        }
        p.runs.retain(|r| r.len > 0);
        p.rev = wordcraft_doc::para::next_rev();
        Some(id)
    }
    fn walk(blocks: &mut [Arc<Block>]) {
        for b in blocks {
            match Arc::make_mut(b) {
                Block::Para(p) => {
                    drop_marker(p);
                }
                Block::Table(t) => t.rows.iter_mut().for_each(|r| r.cells.iter_mut().for_each(|c| walk(&mut c.blocks))),
            }
        }
    }
    let mut found = Vec::new();
    for (i, b) in doc.body.iter_mut().enumerate() {
        if let Block::Para(p) = Arc::make_mut(b) {
            let tag = p.props.style.clone();
            if let Some(id) = drop_marker(p) {
                found.push((i, id, tag));
            }
        }
    }
    // Paragraphs in tables
    for b in doc.body.iter_mut() {
        if let Block::Table(_) = &**b {
            walk(std::slice::from_mut(b));
        }
    }
    found
}

/// Sets the styles the person chose on the paragraphs of the finished document. A style the document does not have is not set, so no
/// paragraph points at nothing; and a heading is not given a style of another level than the one its tag made it.
pub fn settle(doc: &mut Document, chosen: &[(usize, String, Option<String>)]) {
    for (i, id, tag) in chosen {
        let Some(style) = doc.styles.styles.iter().find(|s| s.id == *id && s.kind == StyleKind::Paragraph) else { continue };
        let _ = style;
        if let Some(t) = tag.as_deref().and_then(|t| t.strip_prefix("Heading")).and_then(|n| n.parse::<u8>().ok()) {
            let level = doc.styles.resolve_para(&ParaProps { style: Some(id.clone()), ..Default::default() }).outline_level.map_or(0, |l| l + 1);
            if level != t {
                continue;
            }
        }
        if let Some(Block::Para(p)) = doc.body.get_mut(*i).map(Arc::make_mut) {
            if p.props.style.as_deref() != Some(id.as_str()) {
                p.props.style = Some(id.clone());
                p.rev = wordcraft_doc::para::next_rev();
            }
        }
    }
}

// ---- Letters and tables --------------------------------------------------------------------------------------------------------------------
//
// A range of text in a character style is wrapped in the editor's HTML as `U+E006 id U+E007 ... U+E008`. A table in a table style carries
// `U+E009 id U+E00A` at the start of its first cell. Both are taken off right after the HTML is read; the styles go on the finished document.

const TABLE_OPEN: char = '\u{E009}';
const TABLE_CLOSE: char = '\u{E00A}';

/// Takes `a..b` (bytes) out of a paragraph's text, and out of its runs
fn cut(p: &mut Paragraph, a: usize, b: usize) {
    p.text.drain(a..b);
    let mut at = 0;
    for r in &mut p.runs {
        let (from, to) = (at, at + r.len);
        at = to;
        r.len -= to.min(b).saturating_sub(from.max(a));
    }
    p.runs.retain(|r| r.len > 0);
    p.rev = wordcraft_doc::para::next_rev();
}

/// Every paragraph of the body and of its table cells, with its place
fn paragraphs_mut(doc: &mut Document, f: &mut dyn FnMut(super::notes::Place, &mut Paragraph)) {
    for (i, b) in doc.body.iter_mut().enumerate() {
        match Arc::make_mut(b) {
            Block::Para(p) => f((i, None), p),
            Block::Table(t) => {
                for (r, row) in t.rows.iter_mut().enumerate() {
                    for (c, cell) in row.cells.iter_mut().enumerate() {
                        for (k, cb) in cell.blocks.iter_mut().enumerate() {
                            if let Block::Para(p) = Arc::make_mut(cb) {
                                f((i, Some((r, c, k))), p);
                            }
                        }
                    }
                }
            }
        }
    }
}

/// Puts the character styles on the finished document. `authoritative`: the editor knows character styles (its markers are all there are), so
/// a style the file had on text that carries no marker is taken off.
pub fn settle_chars(doc: &mut Document, found: &[super::notes::CharRange], authoritative: bool) {
    let is_char = |doc: &Document, id: &str| doc.styles.styles.iter().any(|s| s.id == id && s.kind == StyleKind::Character);
    if authoritative {
        let ids: Vec<String> = doc.styles.styles.iter().filter(|s| s.kind == StyleKind::Character).map(|s| s.id.clone()).collect();
        paragraphs_mut(doc, &mut |_, p| {
            if p.runs.iter().any(|r| r.props.style.as_ref().is_some_and(|s| ids.contains(s))) {
                for r in &mut p.runs {
                    if r.props.style.as_ref().is_some_and(|s| ids.contains(s)) {
                        r.props.style = None;
                    }
                }
                p.rev = wordcraft_doc::para::next_rev();
            }
        });
    }
    for (place, a, b, id) in found {
        if !is_char(doc, id) {
            continue;
        }
        if let Some(p) = super::notes::para_mut(doc, place) {
            let (a, b) = ((*a).min(p.text.len()), (*b).min(p.text.len()));
            if a < b && p.text.is_char_boundary(a) && p.text.is_char_boundary(b) {
                let _ = p.format(a, b, &|c| c.style = Some(id.clone()));
            }
        }
    }
}

/// The table styles chosen in the editor: (top-level index of the table, id), with the markers taken out of the text
pub fn take_table_markers(doc: &mut Document) -> Vec<(usize, String)> {
    let mut found = Vec::new();
    paragraphs_mut(doc, &mut |place, p| {
        if let (Some((0, 0, 0)), true) = (place.1, p.text.starts_with(TABLE_OPEN)) {
            if let Some(end) = p.text.find(TABLE_CLOSE) {
                found.push((place.0, p.text[TABLE_OPEN.len_utf8()..end].to_string()));
                cut(p, 0, end + TABLE_CLOSE.len_utf8());
            }
        }
    });
    found
}

/// Gives the tables the style chosen in the editor; "none" takes the style off. A style the document does not have is not set.
pub fn settle_tables(doc: &mut Document, found: &[(usize, String)]) {
    for (i, id) in found {
        let exists = doc.styles.styles.iter().any(|s| s.id == *id && s.kind == StyleKind::Table);
        if let Some(Block::Table(t)) = doc.body.get_mut(*i).map(Arc::make_mut) {
            if id == "none" {
                t.props.style = None;
            } else if exists {
                t.props.style = Some(id.clone());
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn doc_from(html: &str) -> Document {
        wordcraft_formats::import("html", html.as_bytes()).unwrap().unwrap()
    }

    fn callout() -> StyleIn {
        StyleIn { id: "Callout".into(), name: "Callout".into(), font: "Georgia".into(), size: Some(13.0), bold: true, color: "#c00000".into(), align: "center".into(), space_after: Some(12.0), line_spacing: Some(1.5), ..Default::default() }
    }

    #[test]
    fn a_style_based_on_another_writes_only_what_it_changes_and_follows_the_base() {
        let mut doc = doc_from("<p>Hello</p>");
        apply(&mut doc, &[callout()]);
        // "Warning" is the Callout look, in italic
        let warning = StyleIn { id: "Warning".into(), name: "Warning".into(), based_on: "Callout".into(), font: "Georgia".into(), size: Some(13.0), bold: true, italic: true, color: "#c00000".into(), align: "center".into(), space_after: Some(12.0), line_spacing: Some(1.5), ..Default::default() };
        apply(&mut doc, &[warning]);
        let st = doc.styles.styles.iter().find(|s| s.id == "Warning").unwrap();
        assert_eq!(st.based_on.as_deref(), Some("Callout"));
        assert!(st.chr.font.is_none() && st.chr.size.is_none() && st.chr.color.is_none() && st.chr.bold.is_none() && st.para.align.is_none(), "only the italic is its own: {st:?}");
        assert_eq!(st.chr.italic, Some(true));
        // The base gets bigger and the style follows
        apply(&mut doc, &[StyleIn { size: Some(20.0), ..callout() }]);
        let out = styles_of(&doc);
        let w = out.iter().find(|s| s.id == "Warning").unwrap();
        assert_eq!((w.size, w.font.as_str(), w.italic, w.bold), (20.0, "Georgia", true, true));
        // A style cannot be based on one that is based on it
        apply(&mut doc, &[StyleIn { based_on: "Warning".into(), ..callout() }]);
        assert_ne!(doc.styles.styles.iter().find(|s| s.id == "Callout").unwrap().based_on.as_deref(), Some("Warning"));
    }

    #[test]
    fn a_style_made_in_the_editor_is_written_into_the_file_and_read_back_with_its_look() {
        let mut doc = doc_from("<p>Hello</p>");
        apply(&mut doc, &[callout()]);
        let Some(Block::Para(p)) = doc.body.first_mut().map(Arc::make_mut) else { panic!() };
        p.props.style = Some("Callout".into());
        let bytes = wordcraft_docx::write(&doc).unwrap();
        let back = wordcraft_docx::read_with_password(&bytes, None).unwrap();
        let styles = styles_of(&back);
        let s = styles.iter().find(|s| s.id == "Callout").expect("the style is in the file");
        assert_eq!((s.name.as_str(), s.font.as_str(), s.size, s.bold, s.color.as_str(), s.align.as_str()), ("Callout", "Georgia", 13.0, true, "#c00000", "center"));
        assert_eq!((s.space_after, s.line_spacing, s.used), (12.0, 1.5, true));
    }

    #[test]
    fn changing_a_style_of_the_file_keeps_what_it_did_not_say() {
        let mut doc = doc_from("<p>Hello</p>");
        apply(&mut doc, &[callout()]);
        apply(&mut doc, &[StyleIn { id: "Callout".into(), size: Some(20.0), color: "#0000ff".into(), ..Default::default() }]);
        let s = styles_of(&doc).into_iter().find(|s| s.id == "Callout").unwrap();
        assert_eq!((s.size, s.color.as_str()), (20.0, "#0000ff"));
        assert_eq!(s.font, "Georgia", "the font it had stays");
        assert_eq!(s.name, "Callout");
    }

    #[test]
    fn the_gallerys_own_styles_are_not_listed_again_and_unused_built_ins_stay_out() {
        let doc = doc_from("<h1>A</h1><p>b</p><blockquote>q</blockquote>");
        let ids: Vec<String> = styles_of(&doc).into_iter().map(|s| s.id).collect();
        for gallery in IN_GALLERY {
            assert!(!ids.iter().any(|i| i == gallery), "{gallery} is in the gallery already: {ids:?}");
        }
    }

    #[test]
    fn markers_are_taken_off_the_text_and_the_style_goes_on_the_paragraph() {
        let html = format!("<p>{OPEN}Callout{CLOSE}Look here</p><p>plain</p><h2>{OPEN}Heading2{CLOSE}Part</h2>");
        let mut edited = doc_from(&html);
        let chosen = take_markers(&mut edited);
        assert_eq!(chosen.iter().map(|(i, id, _)| (*i, id.as_str())).collect::<Vec<_>>(), vec![(0, "Callout"), (2, "Heading2")]);
        assert_eq!(chosen[1].2.as_deref(), Some("Heading2"), "the tag gave the heading its style");
        let texts: Vec<&str> = edited.body.iter().map(|b| if let Block::Para(p) = &**b { p.text.as_str() } else { "" }).collect();
        assert_eq!(texts, vec!["Look here", "plain", "Part"]);
        for b in &edited.body {
            if let Block::Para(p) = &**b {
                assert_eq!(p.runs.iter().map(|r| r.len).sum::<usize>(), p.text.len(), "the runs still cover the text");
            }
        }
        apply(&mut edited, &[callout()]);
        settle(&mut edited, &chosen);
        let style_of = |i: usize| if let Block::Para(p) = &*edited.body[i] { p.props.style.clone() } else { None };
        assert_eq!(style_of(0).as_deref(), Some("Callout"));
        assert_eq!(style_of(1), None);
    }

    #[test]
    fn a_style_the_document_does_not_have_is_not_set() {
        let mut edited = doc_from(&format!("<p>{OPEN}Nope{CLOSE}x</p>"));
        let chosen = take_markers(&mut edited);
        settle(&mut edited, &chosen);
        assert!(matches!(&*edited.body[0], Block::Para(p) if p.props.style.is_none()));
    }

    #[test]
    fn a_heading_keeps_the_level_its_tag_gave_it() {
        // The editor still says Heading2 after the person made it a level-1 heading
        let mut edited = doc_from(&format!("<h1>{OPEN}Heading2{CLOSE}Title</h1>"));
        let chosen = take_markers(&mut edited);
        settle(&mut edited, &chosen);
        assert!(matches!(&*edited.body[0], Block::Para(p) if p.props.style.as_deref() == Some("Heading1")), "{:?}", if let Block::Para(p) = &*edited.body[0] { p.props.style.clone() } else { None });
    }
}
