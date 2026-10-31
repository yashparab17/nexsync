//! Text that runs round a picture. In the editor a picture block says its wrap (`left`: the picture on the left and the text on its right;
//! `right`: the other way); for the file writer that goes in the picture's alt text as `U+E00E side U+E00F` before the words, and here it
//! becomes the picture's floating placement, with square wrapping, so Word flows the next paragraphs beside it. A picture that says nothing
//! stays in line with the text.
//!
//! A shape the editor drew is a picture whose alt text starts `U+E010 kind|#rrggbb U+E011`; it becomes the file's own shape (a preset
//! geometry with a fill and an outline), which Word and other programs can edit. A file's shapes come back as the same kind of picture.

use std::sync::Arc;

use wordcraft_doc::fill::Fill;
use wordcraft_doc::para::{Anchor, Float, FloatAlign, ShapeKind, Wrap, WrapText};
use wordcraft_doc::props::Rgb;
use wordcraft_doc::{Block, Document, InlineObject};

const OPEN: char = '\u{E00E}';
const CLOSE: char = '\u{E00F}';
const SHAPE_OPEN: char = '\u{E010}';
const SHAPE_CLOSE: char = '\u{E011}';

/// The editor's name for a shape kind and the file's
const KINDS: [(&str, ShapeKind); 6] = [("rect", ShapeKind::Rectangle), ("round", ShapeKind::RoundedRectangle), ("ellipse", ShapeKind::Ellipse), ("triangle", ShapeKind::Triangle), ("arrow", ShapeKind::Arrow), ("line", ShapeKind::Line)];

/// The marker for a shape picture's alt text
pub fn shape_marker(kind: &str, color: &str) -> String {
    format!("{SHAPE_OPEN}{kind}|{color}{SHAPE_CLOSE}")
}

/// The editor's name for a shape of the file, when it is one the editor draws
pub fn editor_kind(kind: ShapeKind) -> Option<&'static str> {
    KINDS.iter().find(|(_, k)| *k == kind).map(|(n, _)| *n)
}

fn parse_color(hex: &str) -> Option<Rgb> {
    let h = hex.strip_prefix('#')?;
    if h.len() != 6 {
        return None;
    }
    let n = u32::from_str_radix(h, 16).ok()?;
    Some(Rgb((n >> 16) as u8, (n >> 8) as u8, n as u8))
}

fn settle_blocks(blocks: &mut [Arc<Block>]) {
    for b in blocks {
        match Arc::make_mut(b) {
            Block::Para(p) => {
                let mut changed = false;
                for o in p.objects.iter_mut() {
                    let InlineObject::Image { alt, w, h, float, .. } = o else { continue };
                    // The wrap comes first in the alt text, then the shape, then the person's words
                    let mut words = alt.as_str();
                    let mut side = "";
                    if let Some((s, rest)) = words.strip_prefix(OPEN).and_then(|r| r.split_once(CLOSE)) {
                        side = s;
                        words = rest;
                    }
                    let mut shape = None;
                    if let Some((spec, rest)) = words.strip_prefix(SHAPE_OPEN).and_then(|r| r.split_once(SHAPE_CLOSE)) {
                        let mut it = spec.split('|');
                        let kind = it.next().and_then(|k| KINDS.iter().find(|(n, _)| *n == k).map(|(_, k)| *k));
                        let color = it.next().and_then(parse_color);
                        if let (Some(kind), Some(color)) = (kind, color) {
                            shape = Some((kind, color));
                            words = rest;
                        }
                    }
                    if side.is_empty() && shape.is_none() && !alt.starts_with(OPEN) {
                        continue;
                    }
                    let words = words.to_string();
                    let placement = match side {
                        "left" => Some((FloatAlign::Start, WrapText::Right)),
                        "right" => Some((FloatAlign::End, WrapText::Left)),
                        _ => None,
                    };
                    let mut placed = std::mem::take(float);
                    if let Some((align, text)) = placement {
                        placed = Float { wrap: Wrap::Square, wrap_text: text, h_rel: Anchor::Column, v_rel: Anchor::Paragraph, h_align: Some(align), dist: 8.0, dist_top: 4.0, dist_bottom: 4.0, ..Default::default() };
                    }
                    let (w, h) = (*w, *h);
                    *o = match shape {
                        Some((kind, color)) => InlineObject::Shape { kind, w, h, fill: (kind != ShapeKind::Line).then_some(Fill::Solid { color, transparency: 0.0 }), stroke: Some(Rgb(0x1f, 0x29, 0x37)), stroke_width: 1.5, float: placed, story: None, freeform: None, effects: Default::default(), extra: Default::default() },
                        None => {
                            let InlineObject::Image { alt, float, .. } = o else { continue };
                            *alt = words;
                            *float = placed;
                            changed = true;
                            continue;
                        }
                    };
                    changed = true;
                }
                if changed {
                    p.rev = wordcraft_doc::para::next_rev();
                }
            }
            Block::Table(t) => t.rows.iter_mut().for_each(|r| r.cells.iter_mut().for_each(|c| settle_blocks(&mut c.blocks))),
        }
    }
}

/// Floats the pictures the editor wrapped text round, and takes the markers off every picture's alt text
pub fn settle(doc: &mut Document) {
    settle_blocks(&mut doc.body);
}

/// A shape of the file drawn as a picture for the editor: the same figures the editor draws, as an SVG
pub fn shape_svg(kind: &str, color: &str, w: f32, h: f32) -> String {
    let (w, h) = (w.clamp(8.0, 2000.0), h.clamp(8.0, 2000.0));
    let p = 3.0_f32;
    let body = match kind {
        "rect" => format!("<rect x='{p}' y='{p}' width='{}' height='{}'/>", w - 2.0 * p, h - 2.0 * p),
        "round" => format!("<rect x='{p}' y='{p}' width='{}' height='{}' rx='{}'/>", w - 2.0 * p, h - 2.0 * p, (h / 6.0).min(22.0)),
        "ellipse" => format!("<ellipse cx='{}' cy='{}' rx='{}' ry='{}'/>", w / 2.0, h / 2.0, w / 2.0 - p, h / 2.0 - p),
        "triangle" => format!("<polygon points='{},{p} {},{} {p},{}'/>", w / 2.0, w - p, h - p, h - p),
        "arrow" => {
            let neck = h * 0.3;
            let (top, bottom) = (h / 2.0 - neck / 2.0, h / 2.0 + neck / 2.0);
            format!("<polygon points='{p},{top} {},{top} {},{p} {},{} {},{h2} {},{bottom} {p},{bottom}'/>", w * 0.6, w * 0.6, w - p, h / 2.0, w * 0.6, w * 0.6, h2 = h - p)
        }
        _ => format!("<line x1='{p}' y1='{}' x2='{}' y2='{}'/>", h / 2.0, w - p, h / 2.0),
    };
    let fill = if kind == "line" { "none" } else { color };
    format!("<svg xmlns='http://www.w3.org/2000/svg' width='{w}' height='{h}' viewBox='0 0 {w} {h}'><g fill='{fill}' stroke='#1f2937' stroke-width='2'>{body}</g></svg>")
}
