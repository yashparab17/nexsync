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
}

fn used_styles(blocks: &[Arc<Block>], out: &mut std::collections::BTreeSet<String>) {
    for b in blocks {
        match &**b {
            Block::Para(p) => {
                if let Some(s) = &p.props.style {
                    out.insert(s.clone());
                }
            }
            Block::Table(t) => t.rows.iter().for_each(|r| r.cells.iter().for_each(|c| used_styles(&c.blocks, out))),
        }
    }
}

fn hex(c: &TextColor) -> String {
    match c {
        TextColor::Rgb(Rgb(r, g, b)) => format!("#{r:02x}{g:02x}{b:02x}"),
        TextColor::Auto => String::new(),
    }
}

/// The paragraph styles a file has that the gallery should offer: those a paragraph uses, those the file shows in its own gallery, and
/// those somebody made, but not the ones the gallery has already
pub fn styles_of(doc: &Document) -> Vec<StyleOut> {
    let mut used = std::collections::BTreeSet::new();
    used_styles(&doc.body, &mut used);
    doc.styles
        .styles
        .iter()
        .filter(|s| s.kind == StyleKind::Paragraph && !s.hidden && !s.id.is_empty() && !IN_GALLERY.contains(&s.id.as_str()) && (used.contains(&s.id) || s.quick || !s.builtin))
        .map(|s| {
            let p = doc.styles.resolve_para(&ParaProps { style: Some(s.id.clone()), ..Default::default() });
            let c = doc.styles.resolve_char(Some(&s.id), &CharProps::default());
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

/// Writes the styles made or changed in the editor into the document's styles: one with an id the file has is changed in the fields given, any
/// other is added (shown in the file's own gallery)
pub fn apply(doc: &mut Document, styles: &[StyleIn]) {
    for s in styles.iter().filter(|s| !s.id.trim().is_empty() && s.id.len() <= 80 && !s.id.contains(char::is_whitespace)) {
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
            if base != s.id && doc.styles.styles.iter().any(|e| e.id == base) {
                st.based_on = Some(base.to_string());
            }
        }
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
        st.para.align = match s.align.as_str() {
            "left" => Some(Align::Left),
            "center" => Some(Align::Center),
            "right" => Some(Align::Right),
            "justify" => Some(Align::Justify),
            _ => st.para.align,
        };
        if let Some(v) = s.space_before.filter(|v| *v >= 0.0) {
            st.para.space_before = Some(v);
        }
        if let Some(v) = s.space_after.filter(|v| *v >= 0.0) {
            st.para.space_after = Some(v);
        }
        if let Some(l) = s.line_spacing.filter(|l| *l != 0.0) {
            st.para.line_spacing = Some(if l < 0.0 { LineSpacing::Exactly(-l) } else { LineSpacing::Multiple(l) });
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
