//! Sections of a document. A paragraph the editor says starts a section carries the section's page set-up as a marker at the start of its
//! text (U+E004, the set-up, U+E005), the way `styles.rs` carries a style. Here the markers are taken off after the HTML is read, and the
//! sections are made in the finished document: the paragraph before the break ends the section it was in, and the section that starts at the
//! break gets the set-up. A file's own sections come to the editor the same way, so a section the person did not change is left exactly as the
//! file had it.
//!
//! The set-up is `kind|orientation|top,right,bottom,left|columns`: `next`, `cont`inuous, `even` or `odd` page start, `p`ortrait or `l`andscape,
//! the margins in points (empty: as the section had them), one to three columns. Then, when the section has them, `|header|footer`: each `=`
//! and the text in hex (`=` alone: none), or empty to leave what the section had. After those come `key=value` pieces: `num=` a number the
//! section's page numbers start at (or `c` to carry on from the section before), and `fh`, `ff`, `eh`, `ef`, the header and footer of the first
//! page and of even pages, each in hex as above.

use std::sync::Arc;

use wordcraft_doc::{section::SectionStart, Block, Document, Paragraph, PartKind, SectionProps};

pub const OPEN: char = '\u{E004}';
pub const CLOSE: char = '\u{E005}';

#[derive(Clone, Debug, PartialEq)]
pub struct Spec {
    pub start: SectionStart,
    pub landscape: bool,
    pub margins: Option<[f32; 4]>,
    pub columns: u32,
    /// The section's header and footer text: `None` leaves them as they were, `Some("")` takes them away
    pub header: Option<String>,
    pub footer: Option<String>,
    pub num: Numbering,
    pub first_header: Option<String>,
    pub first_footer: Option<String>,
    pub even_header: Option<String>,
    pub even_footer: Option<String>,
}

/// What the section does with page numbers
#[derive(Clone, Copy, Debug, PartialEq, Default)]
pub enum Numbering {
    #[default]
    Leave,
    Continue,
    At(u32),
}

/// The starts the editor offers; a file's start of a new column is shown as a new page
fn kind_of(s: SectionStart) -> SectionStart {
    if s == SectionStart::NextColumn { SectionStart::NextPage } else { s }
}

pub fn parse(s: &str) -> Option<Spec> {
    let mut it = s.split('|');
    let start = match it.next()? {
        "next" => SectionStart::NextPage,
        "cont" => SectionStart::Continuous,
        "even" => SectionStart::EvenPage,
        "odd" => SectionStart::OddPage,
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
    let header = it.next().and_then(unhex);
    let footer = it.next().and_then(unhex);
    let mut spec = Spec { start, landscape, margins, columns, header, footer, num: Numbering::Leave, first_header: None, first_footer: None, even_header: None, even_footer: None };
    for piece in it {
        let Some((key, value)) = piece.split_once('=') else { continue };
        let text = || unhex(&format!("={value}"));
        match key {
            "num" => spec.num = if value == "c" { Numbering::Continue } else { value.parse::<u32>().ok().filter(|n| (1..=100_000).contains(n)).map_or(Numbering::Leave, Numbering::At) },
            "fh" => spec.first_header = text(),
            "ff" => spec.first_footer = text(),
            "eh" => spec.even_header = text(),
            "ef" => spec.even_footer = text(),
            _ => {}
        }
    }
    Some(spec)
}

/// `=` and a text in hex, as the text; anything else (empty) is "leave it"
fn unhex(f: &str) -> Option<String> {
    let h = f.strip_prefix('=')?;
    if h.len() % 2 != 0 || h.len() > 800 {
        return None;
    }
    let bytes: Option<Vec<u8>> = (0..h.len()).step_by(2).map(|i| u8::from_str_radix(&h[i..i + 2], 16).ok()).collect();
    String::from_utf8(bytes?).ok().map(|t| t.chars().filter(|c| !c.is_control()).collect())
}

fn hex(t: &str) -> String {
    format!("={}", t.bytes().map(|b| format!("{b:02x}")).collect::<String>())
}

/// A section's set-up as the editor holds it
pub fn spec_of(doc: &Document, s: &SectionProps) -> String {
    let r = |v: f32| (v * 10.0).round() / 10.0;
    let text = |id: Option<u32>| super::merge::part_text(doc, id);
    let opt = |t: String| if t.is_empty() { String::new() } else { hex(&t) };
    let (h, f) = (text(s.headers.default), text(s.footers.default));
    let mut extras = Vec::new();
    if let Some(n) = s.page_num_start {
        extras.push(format!("num={n}"));
    }
    for (key, id) in [("fh", s.headers.first), ("ff", s.footers.first), ("eh", s.headers.even), ("ef", s.footers.even)] {
        let t = text(id);
        if !t.is_empty() {
            extras.push(format!("{key}={}", &hex(&t)[1..]));
        }
    }
    let tail = if h.is_empty() && f.is_empty() && extras.is_empty() { String::new() } else { format!("|{}|{}", opt(h), opt(f)) };
    let extras = extras.iter().map(|e| format!("|{e}")).collect::<String>();
    format!(
        "{}|{}|{},{},{},{}|{}{tail}{extras}",
        match kind_of(s.start) {
            SectionStart::Continuous => "cont",
            SectionStart::EvenPage => "even",
            SectionStart::OddPage => "odd",
            _ => "next",
        },
        if s.landscape { "l" } else { "p" },
        r(s.margin_top),
        r(s.margin_right),
        r(s.margin_bottom),
        r(s.margin_left),
        s.columns.count.clamp(1, 3),
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
        // The header and footer the section is to have: new parts for text that is not what it has now
        let current = match end {
            Some(k) => match &*doc.body[k] {
                Block::Para(p) => p.section.as_deref().cloned().unwrap_or_default(),
                _ => continue,
            },
            None => doc.last_section.clone(),
        };
        let make = |doc: &mut Document, want: &Option<String>, now: Option<u32>, kind: PartKind| -> Option<Option<u32>> {
            let text = want.as_ref()?.trim().chars().take(200).collect::<String>();
            if super::merge::part_text(doc, now) == text {
                return None;
            }
            Some((!text.is_empty()).then(|| doc.add_part(kind, vec![super::documents::line_block(&text, false, wordcraft_doc::Align::Left)])))
        };
        let header = make(doc, &spec.header, current.headers.default, PartKind::Header);
        let footer = make(doc, &spec.footer, current.footers.default, PartKind::Footer);
        let first_header = make(doc, &spec.first_header, current.headers.first, PartKind::Header);
        let first_footer = make(doc, &spec.first_footer, current.footers.first, PartKind::Footer);
        let even_header = make(doc, &spec.even_header, current.headers.even, PartKind::Header);
        let even_footer = make(doc, &spec.even_footer, current.footers.even, PartKind::Footer);
        let settings_even = even_header.is_some_and(|h| h.is_some()) || even_footer.is_some_and(|f| f.is_some());
        if settings_even {
            doc.settings.even_odd_headers = true;
        }
        let apply = |s: &mut SectionProps| {
            if let Some(h) = header {
                s.headers.default = h;
            }
            if let Some(f) = footer {
                s.footers.default = f;
            }
            if let Some(v) = first_header {
                s.headers.first = v;
            }
            if let Some(v) = first_footer {
                s.footers.first = v;
            }
            if s.headers.first.is_some() || s.footers.first.is_some() {
                s.title_page = true;
            }
            if let Some(v) = even_header {
                s.headers.even = v;
            }
            if let Some(v) = even_footer {
                s.footers.even = v;
            }
            // The starts the editor offers: a file's start of a new column is shown as a new page and left as it is until one is chosen
            if kind_of(s.start) != spec.start {
                s.start = spec.start;
            }
            match spec.num {
                Numbering::Leave => {}
                Numbering::Continue => s.page_num_start = None,
                Numbering::At(n) => s.page_num_start = Some(n),
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
