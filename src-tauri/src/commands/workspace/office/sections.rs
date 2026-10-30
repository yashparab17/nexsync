//! Sections of a document. A paragraph the editor says starts a section carries the section's page set-up as a marker at the start of its
//! text (U+E004, the set-up, U+E005), the way `styles.rs` carries a style. Here the markers are taken off after the HTML is read, and the
//! sections are made in the finished document: the paragraph before the break ends the section it was in, and the section that starts at the
//! break gets the set-up. A file's own sections come to the editor the same way, so a section the person did not change is left exactly as the
//! file had it.
//!
//! The set-up is `kind|orientation|top,right,bottom,left|columns`: `next` or `cont`inuous, `p`ortrait or `l`andscape, the margins in points
//! (empty: as the section had them), one to three columns.

use std::sync::Arc;

use wordcraft_doc::{section::SectionStart, Block, Document, Paragraph, SectionProps};

pub const OPEN: char = '\u{E004}';
pub const CLOSE: char = '\u{E005}';

#[derive(Clone, Debug, PartialEq)]
pub struct Spec {
    pub continuous: bool,
    pub landscape: bool,
    pub margins: Option<[f32; 4]>,
    pub columns: u32,
}

pub fn parse(s: &str) -> Option<Spec> {
    let mut it = s.split('|');
    let continuous = match it.next()? {
        "next" => false,
        "cont" => true,
        _ => return None,
    };
    let landscape = match it.next()? {
        "p" => false,
        "l" => true,
        _ => return None,
    };
    let m = it.next()?;
    let margins = if m.is_empty() {
        None
    } else {
        let v: Vec<f32> = m.split(',').filter_map(|x| x.parse().ok()).collect();
        if v.len() != 4 || v.iter().any(|x| !x.is_finite() || *x < 0.0 || *x > 500.0) {
            return None;
        }
        Some([v[0], v[1], v[2], v[3]])
    };
    let columns = it.next()?.parse::<u32>().ok().filter(|c| (1..=3).contains(c))?;
    Some(Spec { continuous, landscape, margins, columns })
}

/// A section's set-up as the editor holds it
pub fn spec_of(s: &SectionProps) -> String {
    let r = |v: f32| (v * 10.0).round() / 10.0;
    format!(
        "{}|{}|{},{},{},{}|{}",
        if s.start == SectionStart::Continuous { "cont" } else { "next" },
        if s.landscape { "l" } else { "p" },
        r(s.margin_top),
        r(s.margin_right),
        r(s.margin_bottom),
        r(s.margin_left),
        s.columns.count.clamp(1, 3)
    )
}

fn drop_marker(p: &mut Paragraph) -> Option<String> {
    if !p.text.starts_with(OPEN) {
        return None;
    }
    let end = p.text.find(CLOSE)?;
    let spec = p.text[OPEN.len_utf8()..end].to_string();
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
    Some(spec)
}

/// Takes the markers off the top-level paragraphs, and any in tables (which cannot start a section). Returns the place of each paragraph that
/// starts a section and its set-up.
pub fn take_markers(doc: &mut Document) -> Vec<(usize, Spec)> {
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
        match Arc::make_mut(b) {
            Block::Para(p) => {
                if let Some(spec) = drop_marker(p).as_deref().and_then(parse) {
                    found.push((i, spec));
                }
            }
            Block::Table(_) => walk(std::slice::from_mut(b)),
        }
    }
    found
}

fn differs(a: f32, b: f32) -> bool {
    (a - b).abs() > 0.5
}

/// Makes the sections of the finished document what the person has. A break at a paragraph that already starts a section (one the file has)
/// changes that section only where the set-up differs; a break anywhere else splits the section it is in, the first part keeping what the
/// section had.
pub fn settle(doc: &mut Document, breaks: &[(usize, Spec)]) {
    for (i, spec) in breaks {
        if *i == 0 || *i >= doc.body.len() {
            continue;
        }
        // The paragraph that ends the section the break is in, from the break on: the first with section properties, else the document's last
        let end = (*i..doc.body.len()).find(|k| matches!(&*doc.body[*k], Block::Para(p) if p.section.is_some()));
        let already = matches!(&*doc.body[*i - 1], Block::Para(p) if p.section.is_some());
        if !already {
            // Only a paragraph can end a section
            if !matches!(&*doc.body[*i - 1], Block::Para(_)) {
                continue;
            }
            let before = match end {
                Some(k) => match &*doc.body[k] {
                    Block::Para(p) => p.section.as_deref().cloned().unwrap_or_default(),
                    _ => continue,
                },
                None => doc.last_section.clone(),
            };
            if let Block::Para(p) = Arc::make_mut(&mut doc.body[*i - 1]) {
                p.section = Some(Box::new(before));
                p.rev = wordcraft_doc::para::next_rev();
            }
        }
        let apply = |s: &mut SectionProps| {
            // The two starts the editor offers; an even-page or odd-page start stays unless the person chose one of them
            if spec.continuous && s.start != SectionStart::Continuous {
                s.start = SectionStart::Continuous;
            } else if !spec.continuous && s.start == SectionStart::Continuous {
                s.start = SectionStart::NextPage;
            }
            if s.landscape != spec.landscape {
                std::mem::swap(&mut s.page_w, &mut s.page_h);
                s.landscape = spec.landscape;
            }
            if let Some([t, r, b, l]) = spec.margins {
                for (slot, v) in [(&mut s.margin_top, t), (&mut s.margin_right, r), (&mut s.margin_bottom, b), (&mut s.margin_left, l)] {
                    if differs(*slot, v) {
                        *slot = v;
                    }
                }
            }
            if s.columns.count != spec.columns {
                s.columns.count = spec.columns;
                s.columns.widths.clear();
            }
        };
        match end {
            Some(k) => {
                if let Block::Para(p) = Arc::make_mut(&mut doc.body[k]) {
                    if let Some(s) = p.section.as_deref_mut() {
                        apply(s);
                    }
                    p.rev = wordcraft_doc::para::next_rev();
                }
            }
            None => apply(&mut doc.last_section),
        }
    }
}
