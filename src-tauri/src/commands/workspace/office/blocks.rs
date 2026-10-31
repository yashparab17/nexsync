//! A Word document as the editor's blocks, with nothing lost on the way: each paragraph's spacing, indents, line spacing, keeps, page
//! breaks, section starts, tab stops and list numbering go into the block's own properties, and each run's font, size, colours and marks
//! into its styles, all worked out the way Word works them out (styles, then direct formatting; contextual spacing; the larger of two
//! paragraphs' facing spaces). The editor stores them with the text, so they are shared, undone and copied with it.
//!
//! With the blocks go the line heights of the fonts they use, as Word measures single spacing (see `wordcraft_fonts::word`), and the
//! list definitions the editor numbers lists from as they change.

use std::collections::{BTreeMap, HashMap};

use serde::Serialize;
use serde_json::{json, Map, Value};
use wordcraft_doc::{
    numbering::Counters,
    para::{COLUMN_BREAK, OBJ, PAGE_BREAK},
    props::{Align, LineSpacing, TabAlign, TextColor, Underline, VMerge},
    Block, Document, InlineObject, Paragraph, StyleSheet,
};

/// One level of a list, as the editor numbers it
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ListLevel {
    /// The list's counters are shared by every list made from the same definition
    pub abs: u32,
    /// decimal, lowerLetter, upperLetter, lowerRoman, upperRoman, bullet, none
    pub format: String,
    /// The label with `%1`…`%9` standing for the levels' numbers (a bullet's own character)
    pub text: String,
    pub start: u32,
    pub restart: bool,
    /// The font the label is drawn in (a bullet's is often Symbol): its line height lifts the item's first line, as in Word
    pub font: String,
}

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Converted {
    pub blocks: Vec<Value>,
    /// Font → its single line height as a multiple of its size (Word's measure)
    pub fonts: BTreeMap<String, f32>,
    /// `num:level` → the level
    pub lists: BTreeMap<String, ListLevel>,
}

pub fn convert(doc: &Document) -> Converted {
    let mut c = Conv { doc, styles: &doc.styles, counters: Counters::default(), out: Converted::default(), fonts: HashMap::new(), break_next: false };
    let starts = section_starts(doc);
    let gaps = gaps_of(&doc.body, c.styles, doc.settings.sum_paragraph_spacing);
    let s = &doc.last_section;
    let text_w = (s.page_w - s.margin_left - s.margin_right).max(72.0);
    for (i, b) in doc.body.iter().enumerate() {
        match &**b {
            Block::Para(p) => c.paragraph(p, gaps[i], starts.get(&i).cloned()),
            Block::Table(t) => {
                let block = c.table(t, text_w);
                if std::mem::take(&mut c.break_next) {
                    // A table right after a page break: the break goes on an empty paragraph before it
                    c.out.blocks.push(json!({ "type": "paragraph", "props": { "pageBreakBefore": true, "spaceBefore": 0, "spaceAfter": 0, "lineSpacing": -1 }, "content": [] }));
                }
                c.out.blocks.push(block);
            }
        }
    }
    let fonts = std::mem::take(&mut c.fonts);
    c.out.fonts = fonts.into_iter().collect();
    c.out
}

struct Conv<'a> {
    doc: &'a Document,
    styles: &'a StyleSheet,
    counters: Counters,
    out: Converted,
    fonts: HashMap<String, f32>,
    /// The paragraph before ended with a page break: the next block starts the new page
    break_next: bool,
}

/// The first paragraph of each section after the first: whether it starts a page, and how the section's text sits on it (c, b, j or empty)
fn section_starts(doc: &Document) -> HashMap<usize, (bool, &'static str, String)> {
    use wordcraft_doc::section::{PageVAlign, SectionStart};
    let mut ends: Vec<(usize, &wordcraft_doc::SectionProps)> = doc.body.iter().enumerate().filter_map(|(i, b)| if let Block::Para(p) = &**b { p.section.as_deref().map(|s| (i, s)) } else { None }).collect();
    let mut out = HashMap::new();
    if ends.is_empty() {
        return out;
    }
    ends.push((doc.body.len().saturating_sub(1), &doc.last_section));
    let mut start = 0;
    for (k, (end, s)) in ends.iter().enumerate() {
        let valign = match s.valign {
            PageVAlign::Center => "c",
            PageVAlign::Bottom => "b",
            PageVAlign::Justify => "j",
            _ => "",
        };
        let brk = k > 0 && s.start != SectionStart::Continuous;
        if (k > 0 || !valign.is_empty()) && start <= *end {
            out.insert(start, (brk, valign, if k > 0 { super::sections::spec_of(doc, s) } else { String::new() }));
        }
        start = end + 1;
    }
    out
}

/// The space above and below each paragraph as Word lays them out: none next to a paragraph of the same style where the style says so
/// (contextual spacing), and between two paragraphs the larger of the first's space after and the second's space before, not both
/// (unless the file asks for their sum)
fn gaps_of(list: &[std::sync::Arc<Block>], styles: &StyleSheet, sum: bool) -> Vec<(f32, f32)> {
    let kinds: Vec<Option<(String, bool)>> = list
        .iter()
        .map(|b| match &**b {
            Block::Para(p) => {
                let r = styles.resolve_para(&p.props);
                Some((p.props.style.clone().unwrap_or(r.style), r.contextual_spacing))
            }
            _ => None,
        })
        .collect();
    let same = |i: usize, j: Option<usize>| match (kinds.get(i).cloned().flatten(), j.and_then(|j| kinds.get(j).cloned().flatten())) {
        (Some((a, true)), Some((b, _))) => a == b,
        _ => false,
    };
    let mut gaps: Vec<(f32, f32)> = list
        .iter()
        .enumerate()
        .map(|(i, b)| match &**b {
            Block::Para(p) => {
                let r = styles.resolve_para(&p.props);
                (if same(i, i.checked_sub(1)) { 0.0 } else { r.space_before }, if same(i, Some(i + 1)) { 0.0 } else { r.space_after })
            }
            _ => (0.0, 0.0),
        })
        .collect();
    if !sum {
        for i in 1..gaps.len() {
            if matches!(&*list[i - 1], Block::Para(_)) {
                gaps[i].0 = (gaps[i].0 - gaps[i - 1].1).max(0.0);
            }
        }
    }
    gaps
}

fn hex(c: wordcraft_doc::Rgb) -> String {
    format!("#{:02x}{:02x}{:02x}", c.0, c.1, c.2)
}

fn align_of(a: Align) -> &'static str {
    match a {
        Align::Center => "center",
        Align::Right => "right",
        Align::Justify => "justify",
        _ => "left",
    }
}

/// Points, to a tenth
fn pt(v: f32) -> f64 {
    if v.is_finite() {
        (f64::from(v) * 10.0).round() / 10.0
    } else {
        0.0
    }
}

/// Symbol and Wingdings bullets are private-use characters drawn by those fonts; the editor shows the character they look like
fn bullet_char(text: &str) -> String {
    text.chars()
        .map(|c| match c {
            '\u{f0b7}' | '\u{f095}' => '•',
            '\u{f0a7}' | '\u{f06e}' => '▪',
            '\u{f0a8}' | '\u{f071}' => '□',
            '\u{f076}' => '❖',
            '\u{f0d8}' => '➢',
            '\u{f0fc}' => '✓',
            '\u{f0e0}' => '➔',
            c if ('\u{f020}'..='\u{f0ff}').contains(&c) => '•',
            c => c,
        })
        .collect()
}

fn format_name(f: wordcraft_doc::section::NumFormat) -> &'static str {
    use wordcraft_doc::section::NumFormat as F;
    match f {
        F::Bullet => "bullet",
        F::UpperRoman => "upperRoman",
        F::LowerRoman => "lowerRoman",
        F::UpperLetter => "upperLetter",
        F::LowerLetter => "lowerLetter",
        F::None => "none",
        _ => "decimal",
    }
}

impl Conv<'_> {
    /// The font's single line height over its size, as Word measures it; remembered for the editor
    fn font(&mut self, family: &str) {
        if family.is_empty() || self.fonts.contains_key(family) {
            return;
        }
        let r = wordcraft_fonts::word::resolve(family, false, false);
        let face = r.face.get();
        let (a, d) = wordcraft_fonts::word::line_metrics(face);
        let k = if face.upem > 0.0 { ((a + d) / face.upem) as f32 } else { 1.2 };
        self.fonts.insert(family.to_string(), if k.is_finite() && k > 0.5 && k < 3.0 { (k * 1000.0).round() / 1000.0 } else { 1.2 });
    }

    /// The font's descent below the baseline over its size, as Word measures it
    fn descent(&self, family: &str) -> f64 {
        let face = wordcraft_fonts::word::resolve(if family.is_empty() { "Calibri" } else { family }, false, false).face.get();
        let (_, d) = wordcraft_fonts::word::line_metrics(face);
        if face.upem > 0.0 && d.is_finite() { (d / face.upem).clamp(0.0, 1.0) } else { 0.25 }
    }

    /// One run's look as the editor's styles
    fn run_styles(&mut self, style: Option<&str>, props: &wordcraft_doc::CharProps, heading: bool) -> (Map<String, Value>, Option<String>, bool) {
        let r = self.styles.resolve_char(style, props);
        let mut s = Map::new();
        if r.bold {
            s.insert("bold".into(), json!(true));
        }
        if r.italic {
            s.insert("italic".into(), json!(true));
        }
        if r.underline != Underline::None {
            s.insert("underline".into(), json!(true));
        }
        if r.strike || r.double_strike {
            s.insert("strike".into(), json!(true));
        }
        match r.color {
            TextColor::Rgb(c) => {
                s.insert("textColor".into(), json!(hex(c)));
            }
            // A heading whose style names no colour is black in Word; the editor would otherwise paint its own heading colour
            _ if heading => {
                s.insert("textColor".into(), json!("#000000"));
            }
            _ => {}
        }
        if let Some(c) = r.highlight.or(r.shading) {
            s.insert("backgroundColor".into(), json!(hex(c)));
        }
        if r.size > 0.0 {
            s.insert("fontSize".into(), json!(format!("{}pt", pt(r.size))));
        }
        if !r.font.is_empty() {
            self.font(&r.font);
            s.insert("fontFamily".into(), json!(r.font));
        }
        // A letter style the text is in, so the editor can show and change it
        if let Some(cs) = props.style.as_deref() {
            if self.doc.styles.styles.iter().any(|e| e.id == cs && e.kind == wordcraft_doc::StyleKind::Character) {
                s.insert("charStyle".into(), json!(cs));
            }
        }
        (s, r.link.clone(), r.hidden)
    }

    /// The paragraph as blocks: one per page where page breaks fall inside it, then its pictures. A break at the end of a paragraph keeps
    /// the paragraph's mark on the old page with it (Word shows "Page Break¶" there), so nothing of it starts the new page: the next
    /// block does.
    fn paragraph(&mut self, p: &Paragraph, gap: (f32, f32), section: Option<(bool, &'static str, String)>) {
        let r = self.styles.resolve_para(&p.props);
        let style = p.props.style.as_deref();
        let heading = r.outline_level.is_some_and(|l| l < 6) || style.is_some_and(|s| matches!(s, "Title" | "Subtitle"));
        let mut props = Map::new();
        props.insert("textAlignment".into(), json!(align_of(p.props.align.unwrap_or(r.align))));
        props.insert("spaceBefore".into(), json!(pt(gap.0)));
        props.insert("spaceAfter".into(), json!(pt(gap.1)));
        let line = match r.line_spacing {
            LineSpacing::Multiple(m) if m.is_finite() && m > 0.0 => f64::from(m),
            LineSpacing::Exactly(v) | LineSpacing::AtLeast(v) if v > 0.0 => -pt(v),
            _ => 1.0,
        };
        props.insert("lineSpacing".into(), json!((line * 1000.0).round() / 1000.0));
        props.insert("indentLeft".into(), json!(pt(r.indent_left)));
        props.insert("indentRight".into(), json!(pt(r.indent_right)));
        props.insert("indentFirst".into(), json!(pt(r.indent_first)));
        props.insert("keepNext".into(), json!(r.keep_next));
        props.insert("keepLines".into(), json!(r.keep_lines));
        props.insert("widowControl".into(), json!(r.widow_control));
        let (brk, valign, spec) = section.unwrap_or((false, "", String::new()));
        props.insert("pageBreakBefore".into(), json!(r.page_break_before || brk || std::mem::take(&mut self.break_next)));
        if !valign.is_empty() {
            props.insert("sectionVAlign".into(), json!(valign));
        }
        if !spec.is_empty() {
            props.insert("sectionBreak".into(), json!(spec));
        }
        if let Some(id) = style {
            props.insert("styleId".into(), json!(id));
        }
        // The paragraph mark's font and size: an empty paragraph's line, and the least any line of it is
        let (mark, _, _) = self.run_styles(style, &p.mark, heading);
        if let Some(f) = mark.get("fontFamily") {
            props.insert("markFont".into(), f.clone());
        }
        if let Some(Value::String(s)) = mark.get("fontSize") {
            if let Ok(v) = s.trim_end_matches("pt").parse::<f64>() {
                props.insert("markSize".into(), json!(v));
            }
        }
        // A right-aligned tab stop with one tab in the text (a contents line, "Title<tab>12"): what follows the tab sits at the right edge
        let right_tab = r.tabs.iter().rfind(|t| t.align == TabAlign::Right);
        if right_tab.is_some() && p.text.matches('\t').count() == 1 {
            props.insert("tabRight".into(), json!(true));
        }
        // A list paragraph: its list, level and label, and the level's definition for numbering it again as the list changes
        if let Some(n) = r.numbering.filter(|n| n.num != 0) {
            if let Some((label, lvl)) = self.counters.next_label(&self.doc.numbering, n.num, n.level) {
                let format = format_name(lvl.format);
                // The level's indent and hanging indent over the paragraph style's; the paragraph's own indents over both
                props.insert("indentLeft".into(), json!(pt(p.props.indent_left.unwrap_or(lvl.indent))));
                props.insert("indentFirst".into(), json!(pt(p.props.indent_first.unwrap_or(-lvl.hanging))));
                props.insert("numId".into(), json!(n.num));
                props.insert("ilvl".into(), json!(n.level));
                props.insert("listLabel".into(), json!(if format == "bullet" { bullet_char(&label) } else { label }));
                let abs = self.doc.numbering.abstract_of(n.num).map(|a| a.id).unwrap_or(n.num);
                let label_font = lvl.chr.font.clone().unwrap_or_default();
                self.font(&label_font);
                self.out.lists.entry(format!("{}:{}", n.num, n.level)).or_insert_with(|| ListLevel {
                    font: label_font,
                    abs,
                    format: format.into(),
                    text: if format == "bullet" { bullet_char(&lvl.text) } else { lvl.text.clone() },
                    start: lvl.start,
                    restart: lvl.restart,
                });
            }
        }
        let kind = match r.outline_level {
            Some(l) if l < 6 => ("heading", Some(u32::from(l) + 1)),
            _ => ("paragraph", None),
        };
        if let Some(level) = kind.1 {
            props.insert("level".into(), json!(level));
        }

        // The text, a piece per page
        let mut pieces: Vec<Vec<Value>> = vec![Vec::new()];
        let mut pictures: Vec<Value> = Vec::new();
        let mut objects = p.objects.iter();
        let mut at = 0;
        for run in &p.runs {
            let Some(text) = p.text.get(at..at + run.len) else { break };
            at += run.len;
            let (styles, link, hidden) = self.run_styles(style, &run.props, heading);
            let mut buf = String::new();
            let flush = |buf: &mut String, pieces: &mut Vec<Vec<Value>>| {
                if !buf.is_empty() {
                    push_text(pieces.last_mut().unwrap(), std::mem::take(buf), &styles, link.as_deref());
                }
            };
            for ch in text.chars() {
                match ch {
                    OBJ => match objects.next() {
                        Some(InlineObject::Field { result, .. }) if !hidden => buf.push_str(result),
                        Some(InlineObject::NoteRef { id, .. }) if !hidden => buf.push_str(&super::notes::marker(*id)),
                        Some(InlineObject::Image { media, w, alt, .. }) => {
                            if let Some(url) = self.doc.media.get(media).and_then(|b| data_url(b)) {
                                pictures.push(json!({ "type": "image", "props": { "url": url, "name": alt, "previewWidth": (f64::from(*w) * 4.0 / 3.0).round(), "textAlignment": props.get("textAlignment").cloned().unwrap_or(json!("left")) } }));
                            }
                        }
                        _ => {}
                    },
                    PAGE_BREAK => {
                        flush(&mut buf, &mut pieces);
                        pieces.push(Vec::new());
                    }
                    COLUMN_BREAK | '\n' => buf.push('\n'),
                    c if hidden || (c.is_control() && c != '\t') => {}
                    c => buf.push(c),
                }
            }
            flush(&mut buf, &mut pieces);
        }

        // Nothing after the last break: the break carries over to the next block (and a paragraph that was only a break leaves
        // nothing: its line at the foot of the old page holds no text)
        let only_break = pieces.len() > 1 && pieces.iter().all(|c| c.is_empty()) && pictures.is_empty();
        if pieces.len() > 1 && pieces.last().is_some_and(|c| c.is_empty()) {
            pieces.pop();
            self.break_next = true;
        }
        if only_break {
            return;
        }
        let count = pieces.len();
        let mut wrote = false;
        for (k, content) in pieces.into_iter().enumerate() {
            let mut props = props.clone();
            if k > 0 {
                props.insert("pageBreakBefore".into(), json!(true));
                props.insert("spaceBefore".into(), json!(0));
                // The rest of a list paragraph after a break is not another item
                props.remove("numId");
                props.remove("listLabel");
            }
            if k + 1 < count {
                props.insert("spaceAfter".into(), json!(0));
            }
            // Text before a page break that is nothing at all leaves no line worth keeping
            if k + 1 < count && content.is_empty() {
                continue;
            }
            // A paragraph holding only a picture (and maybe spaces) is the picture, with the paragraph's spacing
            let blank = content.iter().all(|t| t["type"] == "text" && t["text"].as_str().is_some_and(|x| x.trim().is_empty()));
            if blank && !pictures.is_empty() && k + 1 == count {
                break;
            }
            self.out.blocks.push(json!({ "type": kind.0, "props": Value::Object(props), "content": content }));
            wrote = true;
        }
        // A picture sits on its line's baseline, so the line is the picture and, below it, the descent of the paragraph's font (at its
        // line spacing), as Word draws an inline picture
        let size = props.get("markSize").and_then(Value::as_f64).unwrap_or(12.0);
        let font = props.get("markFont").and_then(Value::as_str).unwrap_or("").to_string();
        let multiple = props.get("lineSpacing").and_then(Value::as_f64).filter(|m| *m > 0.0).unwrap_or(1.0);
        let descent = size * self.descent(&font) * multiple;
        for (k, mut pic) in pictures.into_iter().enumerate() {
            if let Some(o) = pic["props"].as_object_mut() {
                if !wrote && k == 0 {
                    for key in ["spaceBefore", "spaceAfter", "indentLeft", "keepNext", "pageBreakBefore"] {
                        if let Some(v) = props.get(key) {
                            o.insert(key.into(), v.clone());
                        }
                    }
                }
                o.insert("descent".into(), json!((descent * 10.0).round() / 10.0));
            }
            self.out.blocks.push(pic);
        }
    }

    /// A table: its column widths as Word lays them out (AutoFit, see `column_widths`), and its cells, with merged cells spanning their
    /// rows and columns
    fn table(&mut self, t: &wordcraft_doc::table::Table, text_w: f32) -> Value {
        // (Whole pixels, rounded up: a column a fraction narrower than its widest line would wrap it)
        let widths: Vec<Value> = column_widths(self.doc, t, text_w).iter().map(|w| json!((f64::from(*w) * 4.0 / 3.0 - 0.01).ceil())).collect();
        // Where each row's cells start in the grid, for finding the cells below a vertically merged one
        let starts: Vec<Vec<usize>> = t
            .rows
            .iter()
            .map(|row| {
                let mut col = 0;
                row.cells
                    .iter()
                    .map(|c| {
                        let at = col;
                        col += c.props.span.max(1) as usize;
                        at
                    })
                    .collect()
            })
            .collect();
        let mut rows = Vec::new();
        for (ri, row) in t.rows.iter().enumerate() {
            let mut cells = Vec::new();
            for (ci, cell) in row.cells.iter().enumerate() {
                if cell.props.vmerge == VMerge::Continue {
                    continue;
                }
                let col = starts[ri][ci];
                let rowspan = if cell.props.vmerge == VMerge::Restart {
                    1 + t.rows.iter().enumerate().skip(ri + 1).take_while(|(r2, below)| starts[*r2].iter().position(|&c| c == col).is_some_and(|k| below.cells[k].props.vmerge == VMerge::Continue)).count()
                } else {
                    1
                };
                let mut content: Vec<Value> = Vec::new();
                let mut align = "left";
                for (k, b) in cell.blocks.iter().enumerate() {
                    let Block::Para(p) = &**b else { continue };
                    if k == 0 {
                        align = align_of(p.props.align.unwrap_or(self.styles.resolve_para(&p.props).align));
                    } else {
                        push_text(&mut content, "\n".into(), &Map::new(), None);
                    }
                    let mut at = 0;
                    let mut objects = p.objects.iter();
                    for run in &p.runs {
                        let Some(text) = p.text.get(at..at + run.len) else { break };
                        at += run.len;
                        let (styles, link, hidden) = self.run_styles(p.props.style.as_deref(), &run.props, false);
                        let mut buf = String::new();
                        for ch in text.chars() {
                            match ch {
                                OBJ => match objects.next() {
                                    Some(InlineObject::Field { result, .. }) => buf.push_str(result),
                                    Some(InlineObject::NoteRef { id, .. }) if !hidden => buf.push_str(&super::notes::marker(*id)),
                                    _ => {}
                                },
                                PAGE_BREAK | COLUMN_BREAK | '\n' => buf.push('\n'),
                                c if hidden || (c.is_control() && c != '\t') => {}
                                c => buf.push(c),
                            }
                        }
                        if !buf.is_empty() {
                            push_text(&mut content, buf, &styles, link.as_deref());
                        }
                    }
                }
                let mut props = json!({ "colspan": cell.props.span.max(1), "rowspan": rowspan, "textAlignment": align });
                if let Some(c) = cell.props.shading {
                    props["backgroundColor"] = json!(hex(c));
                }
                cells.push(json!({ "type": "tableCell", "props": props, "content": content }));
            }
            rows.push(json!({ "cells": cells }));
        }
        let mut block = json!({ "type": "table", "content": { "type": "tableContent", "columnWidths": widths, "rows": rows } });
        // The table style, when the file has one by that id that is a table style
        if let Some(ts) = t.props.style.as_deref() {
            if self.doc.styles.styles.iter().any(|e| e.id == ts && e.kind == wordcraft_doc::StyleKind::Table && !e.default) {
                // A table node has no place for a property of its own, so the editor holds the style as a mark on the first cell's text
                if let Some(items) = block["content"]["rows"][0]["cells"][0]["content"].as_array_mut() {
                    for item in items.iter_mut().filter(|i| i["type"] == "text") {
                        item["styles"]["tableStyle"] = json!(ts);
                    }
                }
            }
        }
        block
    }
}

/// A table's column widths (points) the way Word's AutoFit gives them, as WordCraft's layout does: a table with no preferred width
/// anywhere takes its columns from their content (each its widest line when they all fit, else shared out between narrowest and
/// widest); otherwise the grid stands, but no column is narrower than its longest word. A table with fixed widths keeps its grid.
fn column_widths(doc: &Document, t: &wordcraft_doc::table::Table, avail: f32) -> Vec<f32> {
    let ncols = t.cols().max(1);
    let mut grid: Vec<f32> = if t.grid.len() == ncols { t.grid.iter().map(|w| if w.is_finite() { w.max(4.0) } else { 72.0 }).collect() } else { vec![avail / ncols as f32; ncols] };
    let total: f32 = grid.iter().sum();
    if !t.props.fixed {
        let content = wordcraft_layout::measure_table_columns(doc, t);
        if content.len() == ncols {
            let automatic = t.props.width.is_none() && t.props.width_pct.is_none() && t.rows.iter().all(|r| r.cells.iter().all(|c| c.props.width.is_none() && c.props.width_pct.is_none()));
            if automatic {
                grid = wordcraft_layout::autofit_widths(&content, avail);
            } else {
                let short: f32 = grid.iter().zip(&content).map(|(w, c)| (c.0 - *w).max(0.0)).sum();
                if short >= 0.01 {
                    let spare: f32 = grid.iter().zip(&content).map(|(w, c)| (*w - c.0).max(0.0)).sum();
                    let give = (short / spare.max(0.01)).min(1.0);
                    for (w, c) in grid.iter_mut().zip(&content) {
                        *w = if *w < c.0 { c.0 } else { *w - (*w - c.0) * give };
                    }
                }
            }
            let fitted: f32 = grid.iter().sum();
            let cap = avail.max(total);
            if fitted > cap {
                grid.iter_mut().for_each(|w| *w *= cap / fitted);
            }
        }
    }
    grid
}

/// Adds text to inline content, joined to the text before it when it looks the same
fn push_text(content: &mut Vec<Value>, text: String, styles: &Map<String, Value>, link: Option<&str>) {
    let item = json!({ "type": "text", "text": text, "styles": styles });
    match link {
        Some(href) => {
            if let Some(last) = content.last_mut().filter(|l| l["type"] == "link" && l["href"] == href) {
                let inner = last["content"].as_array_mut().unwrap();
                match inner.last_mut().filter(|t| t["styles"] == item["styles"]) {
                    Some(t) => t["text"] = json!(format!("{}{}", t["text"].as_str().unwrap_or(""), text)),
                    None => inner.push(item),
                }
            } else {
                content.push(json!({ "type": "link", "href": href, "content": [item] }));
            }
        }
        None => match content.last_mut().filter(|t| t["type"] == "text" && t["styles"] == item["styles"]) {
            Some(t) => t["text"] = json!(format!("{}{}", t["text"].as_str().unwrap_or(""), text)),
            None => content.push(item),
        },
    }
}

/// A picture's bytes as a `data:` URL, for the formats a page can show
fn data_url(bytes: &[u8]) -> Option<String> {
    use base64::prelude::{Engine, BASE64_STANDARD};
    let mime = if bytes.starts_with(b"\x89PNG") {
        "image/png"
    } else if bytes.starts_with(&[0xFF, 0xD8]) {
        "image/jpeg"
    } else if bytes.starts_with(b"GIF8") {
        "image/gif"
    } else if bytes.starts_with(b"BM") {
        "image/bmp"
    } else if bytes.len() > 12 && &bytes[8..12] == b"WEBP" {
        "image/webp"
    } else if bytes.starts_with(b"<svg") || bytes.starts_with(b"<?xml") {
        "image/svg+xml"
    } else {
        return None;
    };
    Some(format!("data:{mime};base64,{}", BASE64_STANDARD.encode(bytes)))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn para(text: &str) -> std::sync::Arc<Block> {
        wordcraft_doc::para_block(Paragraph::with_text(text, wordcraft_doc::CharProps::default()))
    }

    #[test]
    fn a_page_break_at_the_end_of_a_paragraph_starts_the_next_block_on_a_new_page() {
        let mut doc = wordcraft_formats::import("html", b"<p>one</p>").unwrap().unwrap();
        doc.body = vec![para("A"), para("\u{c}"), para("B"), para("C\u{c}"), para("D")];
        let out = convert(&doc);
        let texts: Vec<&str> = out.blocks.iter().map(|b| b["content"][0]["text"].as_str().unwrap_or("")).collect();
        // The paragraph that is only a break leaves nothing; what follows each break starts the new page
        assert_eq!(texts, ["A", "B", "C", "D"]);
        let breaks: Vec<bool> = out.blocks.iter().map(|b| b["props"]["pageBreakBefore"] == true).collect();
        assert_eq!(breaks, [false, true, false, true]);
    }

    #[test]
    fn list_items_carry_their_label_and_the_levels_indents() {
        let doc = wordcraft_formats::import("md", b"- a\n- b\n").unwrap().unwrap();
        let out = convert(&doc);
        let item = &out.blocks.iter().find(|b| b["content"][0]["text"] == "a").unwrap()["props"];
        assert_eq!(item["listLabel"], "•");
        assert!(item["numId"].as_u64().is_some_and(|n| n > 0));
        assert!(item["indentFirst"].as_f64().is_some_and(|v| v < 0.0), "a hanging indent: {item}");
        let key = format!("{}:0", item["numId"]);
        assert_eq!(out.lists.get(&key).map(|l| l.format.as_str()), Some("bullet"));
    }
}
