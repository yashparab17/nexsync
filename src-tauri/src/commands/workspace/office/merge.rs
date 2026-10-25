//! Keeping what the editor cannot hold. A Word file keeps most of what makes it look the way it does outside the text: named styles, the
//! spacing and indents of each paragraph, sections (a cover page centred on its page), headers and footers, tables of contents, numbering.
//! The editor works on the text and a handful of character styles, so a file that went through it and came back lost the rest.
//!
//! So the file as it was read is kept (parsed, in a small cache, under an id the editor holds), and whatever is drawn or written is the
//! original with its body brought up to date: each block the editor still has unchanged *is* the original block, a block the person
//! changed keeps the original paragraph's formatting around the new text, and blocks they added come from the editor. Sections, headers,
//! footers, styles and numbering stay as the file had them. Nothing is kept when the editor's text has little in common with the file.

use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex},
};

use wordcraft_doc::{Block, Document, InlineObject, Paragraph};

use super::documents::Layout;

/// Parsed originals with the size of the file each came from, least recently used first
pub(super) static SOURCES: Mutex<Vec<(String, Arc<Document>, usize)>> = Mutex::new(Vec::new());
/// How many originals are kept, and how many bytes of files they came from (a parsed file is a few times its size); the one
/// just kept always stays
const KEEP: usize = 32;
const KEEP_BYTES: usize = 200 * 1024 * 1024;
/// The table of the longest-common-subsequence search is `n * m` cells of two bytes
const MAX_CELLS: usize = 16_000_000;

fn trim(all: &mut Vec<(String, Arc<Document>, usize)>) {
    while all.len() > 1 && (all.len() > KEEP || all.iter().map(|e| e.2).sum::<usize>() > KEEP_BYTES) {
        all.remove(0);
    }
}

/// Keeps a parsed original; returns the id to hand back with the editor's text
pub fn keep(bytes: &[u8], ext: &str, doc: &Document) -> String {
    let id = format!("{}.{ext}", blake3::hash(bytes).to_hex());
    let mut all = SOURCES.lock().unwrap_or_else(|p| p.into_inner());
    // Opened again: it becomes the most recent
    all.retain(|(k, _, _)| *k != id);
    all.push((id.clone(), Arc::new(doc.clone()), bytes.len()));
    trim(&mut all);
    id
}

/// The same files read for drawing their headers and footers (see `presets`), where that copy differs from the file
static DRAWN: Mutex<Vec<(String, Arc<Document>, usize)>> = Mutex::new(Vec::new());

pub fn keep_drawn(id: &str, doc: Document) {
    let mut all = DRAWN.lock().unwrap_or_else(|p| p.into_inner());
    if !all.iter().any(|(k, _, _)| k == id) {
        // Sized like the original it was drawn from, which is kept beside it
        let size = SOURCES.lock().unwrap_or_else(|p| p.into_inner()).iter().find(|(k, _, _)| k == id).map_or(0, |e| e.2);
        all.push((id.to_string(), Arc::new(doc), size));
        trim(&mut all);
    }
}

/// The file to draw headers and footers from: its drawing copy when it has one
pub fn drawn(id: &str) -> Option<Arc<Document>> {
    DRAWN.lock().unwrap_or_else(|p| p.into_inner()).iter().find(|(k, _, _)| k == id).map(|(_, d, _)| d.clone()).or_else(|| get(id))
}

/// An original, which then counts as the most recently used
pub fn get(id: &str) -> Option<Arc<Document>> {
    let mut all = SOURCES.lock().unwrap_or_else(|p| p.into_inner());
    let at = all.iter().position(|(k, _, _)| k == id)?;
    let entry = all.remove(at);
    let doc = entry.1.clone();
    all.push(entry);
    Some(doc)
}

#[cfg(test)]
mod keep_tests {
    use super::*;

    #[test]
    fn a_file_used_again_outlasts_newer_ones() {
        let doc = Document::default();
        let first = keep(b"first file", "docx", &doc);
        for i in 0..KEEP + 4 {
            keep(format!("other {i}").as_bytes(), "docx", &doc);
            // The person keeps coming back to the first one
            assert!(get(&first).is_some(), "still there after {i} others");
        }
    }
}

/// The page set-up of the file's last section as the editor's page and header settings show it
pub fn layout_of(doc: &Document) -> Layout {
    let s = &doc.last_section;
    let part_text = |id: Option<u32>| -> String {
        id.and_then(|i| doc.parts.get(&i))
            .map(|p| p.blocks.iter().map(|b| part_block_text(b)).filter(|t| !t.trim().is_empty()).collect::<Vec<_>>().join(" ").trim().to_string())
            .unwrap_or_default()
    };
    let footer_has_page = s
        .footers
        .default
        .and_then(|i| doc.parts.get(&i))
        .is_some_and(|p| p.blocks.iter().any(|b| matches!(&**b, Block::Para(para) if para.objects.iter().any(|o| matches!(o, InlineObject::Field { instr, .. } if instr.trim_start().to_ascii_uppercase().starts_with("PAGE"))))));
    let normal = doc.styles.resolve_char(Some("Normal"), &Default::default());
    Layout {
        width: s.page_w,
        height: s.page_h,
        landscape: s.landscape,
        top: s.margin_top,
        right: s.margin_right,
        bottom: s.margin_bottom,
        left: s.margin_left,
        columns: s.columns.count.clamp(1, 3),
        spacing: 0.0,
        header: part_text(s.headers.default),
        footer: part_text(s.footers.default),
        first_header: part_text(s.headers.first),
        first_footer: part_text(s.footers.first),
        even_header: part_text(s.headers.even),
        even_footer: part_text(s.footers.even),
        page_numbers: footer_has_page,
        valign: match s.valign {
            wordcraft_doc::section::PageVAlign::Top => "top",
            wordcraft_doc::section::PageVAlign::Center => "center",
            wordcraft_doc::section::PageVAlign::Bottom => "bottom",
            wordcraft_doc::section::PageVAlign::Justify => "justify",
        }
        .to_string(),
        font: normal.font,
        size: normal.size,
        comments: Vec::new(),
    }
}

/// Do two page set-ups say the same (the line spacing is left out: the editor always has one)?
pub fn same_page(a: &Layout, b: &Layout) -> bool {
    let near = |x: f32, y: f32| (x - y).abs() < 0.6;
    near(a.width, b.width)
        && near(a.height, b.height)
        && a.landscape == b.landscape
        && near(a.top, b.top)
        && near(a.right, b.right)
        && near(a.bottom, b.bottom)
        && near(a.left, b.left)
        && a.columns == b.columns
        && a.header.trim() == b.header.trim()
        && a.footer.trim() == b.footer.trim()
        && a.first_header.trim() == b.first_header.trim()
        && a.first_footer.trim() == b.first_footer.trim()
        && a.even_header.trim() == b.even_header.trim()
        && a.even_footer.trim() == b.even_footer.trim()
        && a.page_numbers == b.page_numbers
        && a.valign == b.valign
}

/// A header or footer paragraph's text without the page number fields (the editor draws those itself); tabs stay, they split it into
/// left, middle and right
fn part_block_text(b: &Block) -> String {
    match b {
        Block::Para(p) => {
            let (mut out, mut k) = (String::new(), 0);
            for c in p.text.chars() {
                if c == wordcraft_doc::para::OBJ {
                    if let Some(o) = p.objects.get(k) {
                        let page = matches!(o, InlineObject::Field { instr, .. } if { let i = instr.trim_start().to_ascii_uppercase(); i.starts_with("PAGE") || i.starts_with("NUMPAGES") });
                        if !page {
                            out.push_str(o.plain_text());
                        }
                    }
                    k += 1;
                } else {
                    out.push(c);
                }
            }
            out
        }
        other => block_text(other),
    }
}

fn block_text(b: &Block) -> String {
    match b {
        Block::Para(p) => p.plain_text(),
        Block::Table(t) => t.rows.iter().flat_map(|r| r.cells.iter()).flat_map(|c| c.blocks.iter()).map(|b| block_text(b)).collect::<Vec<_>>().join("\t"),
    }
}

/// What two blocks are compared by: their text without spaces, tabs or line breaks, which the editor's HTML does not keep exactly
fn key(b: &Block) -> String {
    block_text(b).chars().filter(|c| !c.is_whitespace() && *c != '\u{fffc}').collect()
}

/// For each of `a` and `b`, which entries of the other they line up with (a longest common subsequence of equal keys), or `None` when the
/// two are too big to compare
fn align(a: &[String], b: &[String]) -> Option<Vec<(usize, usize)>> {
    let (mut lo, mut hi_a, mut hi_b) = (0, a.len(), b.len());
    while lo < hi_a && lo < hi_b && a[lo] == b[lo] {
        lo += 1;
    }
    while hi_a > lo && hi_b > lo && a[hi_a - 1] == b[hi_b - 1] {
        hi_a -= 1;
        hi_b -= 1;
    }
    let (n, m) = (hi_a - lo, hi_b - lo);
    if (n + 1).saturating_mul(m + 1) > MAX_CELLS || n > u16::MAX as usize || m > u16::MAX as usize {
        return None;
    }
    let w = m + 1;
    let mut t = vec![0u16; (n + 1) * w];
    for i in (0..n).rev() {
        for j in (0..m).rev() {
            t[i * w + j] = if a[lo + i] == b[lo + j] { t[(i + 1) * w + j + 1] + 1 } else { t[(i + 1) * w + j].max(t[i * w + j + 1]) };
        }
    }
    let mut out: Vec<(usize, usize)> = (0..lo).map(|i| (i, i)).collect();
    let (mut i, mut j) = (0, 0);
    while i < n && j < m {
        if a[lo + i] == b[lo + j] {
            out.push((lo + i, lo + j));
            i += 1;
            j += 1;
        } else if t[(i + 1) * w + j] >= t[i * w + j + 1] {
            i += 1;
        } else {
            j += 1;
        }
    }
    out.extend((0..a.len() - hi_a).map(|k| (hi_a + k, hi_b + k)));
    Some(out)
}

/// Heading level a paragraph has under its style (0 for body text), so a paragraph the person turned into a heading is not put back
fn heading_level(doc: &Document, p: &Paragraph) -> u8 {
    doc.styles.resolve_para(&p.props).outline_level.map_or(0, |l| l + 1)
}

/// A block of `new` brought into `into`: the pictures it holds are copied across under names that cannot clash
fn adopt(block: &Arc<Block>, new: &Document, into: &mut Document) -> Arc<Block> {
    fn walk(b: &mut Block, new: &Document, into: &mut Document) {
        match b {
            Block::Para(p) => {
                for o in &mut p.objects {
                    if let InlineObject::Image { media, .. } = o {
                        let renamed = format!("nx-{media}");
                        if let Some(bytes) = new.media.get(media.as_str()) {
                            into.media.insert(renamed.clone(), bytes.clone());
                        }
                        *media = renamed;
                    }
                }
            }
            Block::Table(t) => {
                for row in &mut t.rows {
                    for cell in &mut row.cells {
                        for inner in &mut cell.blocks {
                            walk(Arc::make_mut(inner), new, into);
                        }
                    }
                }
            }
        }
    }
    let mut b = (**block).clone();
    walk(&mut b, new, into);
    Arc::new(b)
}

/// `edited`, the editor's text read back as a document, laid over `original`
pub fn merge(original: &Document, edited: Document) -> Document {
    let keys_o: Vec<String> = original.body.iter().map(|b| key(b)).collect();
    let keys_n: Vec<String> = edited.body.iter().map(|b| key(b)).collect();
    let Some(pairs) = align(&keys_o, &keys_n) else {
        return edited;
    };
    // Little in common: this is not the same document any more, so what the editor has is what there is
    let common: usize = pairs.iter().filter(|(o, _)| !keys_o[*o].is_empty()).count();
    let wanted = keys_o.iter().filter(|k| !k.is_empty()).count().min(keys_n.iter().filter(|k| !k.is_empty()).count());
    if wanted > 0 && common * 4 < wanted {
        return edited;
    }

    let mut out = original.clone();
    let mut body: Vec<Arc<Block>> = Vec::with_capacity(edited.body.len());
    let (mut o, mut n) = (0usize, 0usize);
    let flush = |o_end: usize, n_end: usize, o: &mut usize, n: &mut usize, out: &mut Document, body: &mut Vec<Arc<Block>>| {
        // Blocks between two that line up: the first of each side are the same place in the file, changed; the rest came or went
        let (gap_o, gap_n) = (*o..o_end, *n..n_end);
        let k = gap_o.len().min(gap_n.len());
        for i in 0..k {
            let (ob, nb) = (&original.body[gap_o.start + i], &edited.body[gap_n.start + i]);
            let merged = match (&**ob, &**nb) {
                (Block::Para(op), Block::Para(np)) if heading_level(original, op) == heading_level(&edited, np) => {
                    let mut p = np.clone();
                    p.props = op.props.clone();
                    p.mark = op.mark.clone();
                    p.section = op.section.clone();
                    let mut b = Block::Para(p);
                    if let Block::Para(p) = &mut b {
                        for obj in &mut p.objects {
                            if let InlineObject::Image { media, .. } = obj {
                                let renamed = format!("nx-{media}");
                                if let Some(bytes) = edited.media.get(media.as_str()) {
                                    out.media.insert(renamed.clone(), bytes.clone());
                                }
                                *media = renamed;
                            }
                        }
                    }
                    Arc::new(b)
                }
                _ => adopt(nb, &edited, out),
            };
            body.push(merged);
        }
        for extra in gap_n.start + k..gap_n.end {
            body.push(adopt(&edited.body[extra], &edited, out));
        }
        *o = o_end;
        *n = n_end;
    };
    for (po, pn) in pairs {
        flush(po, pn, &mut o, &mut n, &mut out, &mut body);
        body.push(original.body[po].clone());
        o = po + 1;
        n = pn + 1;
    }
    flush(original.body.len(), edited.body.len(), &mut o, &mut n, &mut out, &mut body);
    out.body = body;
    // Pictures nothing refers to any more are not carried
    let used: BTreeMap<String, ()> = {
        let mut set = BTreeMap::new();
        fn collect(list: &[Arc<Block>], set: &mut BTreeMap<String, ()>) {
            for b in list {
                match &**b {
                    Block::Para(p) => {
                        for o in &p.objects {
                            if let InlineObject::Image { media, .. } = o {
                                set.insert(media.clone(), ());
                            }
                        }
                    }
                    Block::Table(t) => {
                        for row in &t.rows {
                            for cell in &row.cells {
                                collect(&cell.blocks, set);
                            }
                        }
                    }
                }
            }
        }
        collect(&out.body, &mut set);
        for part in out.parts.values() {
            collect(&part.blocks, &mut set);
        }
        set
    };
    out.media.retain(|k, _| !k.starts_with("nx-") || used.contains_key(k));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn doc(html: &str) -> Document {
        wordcraft_formats::import("html", format!("<html><body>{html}</body></html>").as_bytes()).unwrap().unwrap()
    }

    #[test]
    fn lines_up_blocks_by_their_text_and_notices_what_changed() {
        let a: Vec<String> = ["a", "b", "c", "d"].iter().map(|s| s.to_string()).collect();
        let b: Vec<String> = ["a", "x", "c", "d", "e"].iter().map(|s| s.to_string()).collect();
        assert_eq!(align(&a, &b).unwrap(), vec![(0, 0), (2, 2), (3, 3)]);
        assert_eq!(align(&[], &b).unwrap(), vec![]);
    }

    #[test]
    fn an_unchanged_document_is_the_original_and_an_edit_keeps_the_formatting_around_the_new_text() {
        let mut original = doc("<h1>Title</h1><p>First paragraph here.</p><p>Second one.</p>");
        // Give the second paragraph a look the editor does not carry
        if let Block::Para(p) = Arc::make_mut(&mut original.body[2]) {
            p.props.space_after = Some(33.0);
        }
        let same = merge(&original, doc("<h1>Title</h1><p>First paragraph here.</p><p>Second one.</p>"));
        assert_eq!(same.body.len(), original.body.len());
        assert!(matches!(&*same.body[2], Block::Para(p) if p.props.space_after == Some(33.0)));
        let edited = merge(&original, doc("<h1>Title</h1><p>First paragraph here.</p><p>Second one, changed.</p><p>A new one.</p>"));
        assert_eq!(edited.body.len(), 4);
        assert!(matches!(&*edited.body[2], Block::Para(p) if p.plain_text().contains("changed") && p.props.space_after == Some(33.0)), "the changed paragraph keeps its spacing");
        assert!(matches!(&*edited.body[3], Block::Para(p) if p.plain_text() == "A new one."));
        let shorter = merge(&original, doc("<h1>Title</h1><p>Second one.</p>"));
        assert_eq!(shorter.body.len(), 2);
    }

    #[test]
    fn a_different_text_is_not_forced_into_the_original() {
        let original = doc("<p>Alpha beta gamma.</p><p>Delta epsilon.</p><p>Zeta eta theta.</p>");
        let other = merge(&original, doc("<p>Something</p><p>Else</p><p>Entirely</p>"));
        assert_eq!(other.body.iter().map(|b| key(b)).collect::<Vec<_>>(), vec!["Something", "Else", "Entirely"]);
    }

    #[test]
    fn the_page_set_up_of_a_file_is_read_and_compared() {
        let d = doc("<p>x</p>");
        let l = layout_of(&d);
        assert!(l.width > 500.0 && l.valign == "top");
        assert!(same_page(&l, &l.clone()));
        let mut m = l.clone();
        m.valign = "center".into();
        assert!(!same_page(&l, &m));
    }
}
