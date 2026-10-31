//! Footnotes and endnotes in documents. The editor holds a note's reference as the characters U+E002, the note's number, U+E003 in the text
//! (the same way `styles.rs` carries a paragraph's style), and the notes' words in a list beside it. Here the markers are taken off the
//! text after the HTML is read, and put back as real references to real notes in the finished document. A note the file already has comes
//! out to the editor with its part number in the marker, so a reference and its note that nobody touched are the file's own, unchanged.

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use wordcraft_doc::{para::NoteKind, Block, Document, InlineObject, Paragraph, PartKind};

pub const OPEN: char = '\u{E002}';
pub const CLOSE: char = '\u{E003}';

/// The marker for a reference to note `id`
pub fn marker(id: u32) -> String {
    format!("{OPEN}{id}{CLOSE}")
}

/// A note as the editor sends it back: its number, whether it is an endnote, and its words
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct NoteIn {
    pub id: u32,
    pub end: bool,
    pub text: String,
}

/// A note of the file as the editor is given it
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NoteOut {
    pub id: u32,
    pub end: bool,
    pub text: String,
}

/// A note's words with its bold and italic as `**bold**` and `*italic*` (and `\*` and `\\` for the characters themselves), a line to a paragraph
fn text_of(blocks: &[Arc<Block>]) -> String {
    let mut lines = Vec::new();
    for b in blocks {
        if let Block::Para(p) = &**b {
            let (mut out, mut at) = (String::new(), 0);
            // The runs lie over the paragraph's own text, which holds a character for each object; objects have no words in a note
            let (mut bold, mut italic) = (false, false);
            for r in &p.runs {
                let piece = p.text.get(at..at + r.len).unwrap_or("");
                at += r.len;
                let text: String = piece.chars().filter(|c| *c != wordcraft_doc::para::OBJ).collect();
                if text.is_empty() {
                    continue;
                }
                let (b2, i2) = (r.props.bold == Some(true), r.props.italic == Some(true));
                if i2 != italic && !i2 {
                    out.push('*');
                }
                if b2 != bold && !b2 {
                    out.push_str("**");
                }
                if b2 != bold && b2 {
                    out.push_str("**");
                }
                if i2 != italic && i2 {
                    out.push('*');
                }
                (bold, italic) = (b2, i2);
                for c in text.chars() {
                    if c == '*' || c == '\\' {
                        out.push('\\');
                    }
                    out.push(c);
                }
            }
            if italic {
                out.push('*');
            }
            if bold {
                out.push_str("**");
            }
            lines.push(out);
        }
    }
    lines.join("\n").trim().to_string()
}


/// The number formats the editor offers for notes
pub fn format_of(name: &str) -> Option<wordcraft_doc::section::NumFormat> {
    use wordcraft_doc::section::NumFormat;
    Some(match name {
        "decimal" => NumFormat::Decimal,
        "lowerRoman" => NumFormat::LowerRoman,
        "upperRoman" => NumFormat::UpperRoman,
        "lowerLetter" => NumFormat::LowerLetter,
        "upperLetter" => NumFormat::UpperLetter,
        _ => return None,
    })
}

/// The name the editor knows a number format by; "decimal" for one it does not offer
pub fn name_of(f: wordcraft_doc::section::NumFormat) -> &'static str {
    use wordcraft_doc::section::NumFormat;
    match f {
        NumFormat::LowerRoman => "lowerRoman",
        NumFormat::UpperRoman => "upperRoman",
        NumFormat::LowerLetter => "lowerLetter",
        NumFormat::UpperLetter => "upperLetter",
        _ => "decimal",
    }
}

/// The notes of a document, by the number of their part. A note nothing refers to is left out.
pub fn notes_of(doc: &Document) -> Vec<NoteOut> {
    let mut out: Vec<NoteOut> = Vec::new();
    let seen = |p: &Paragraph, doc: &Document, out: &mut Vec<NoteOut>| {
        for o in &p.objects {
            if let InlineObject::NoteRef { kind, id, .. } = o {
                if out.iter().all(|n| n.id != *id) {
                    if let Some(part) = doc.parts.get(id) {
                        out.push(NoteOut { id: *id, end: *kind == NoteKind::Endnote, text: text_of(&part.blocks) });
                    }
                }
            }
        }
    };
    fn walk(blocks: &[Arc<Block>], f: &mut impl FnMut(&Paragraph)) {
        for b in blocks {
            match &**b {
                Block::Para(p) => f(p),
                Block::Table(t) => t.rows.iter().for_each(|r| r.cells.iter().for_each(|c| walk(&c.blocks, f))),
            }
        }
    }
    walk(&doc.body, &mut |p| seen(p, doc, &mut out));
    out
}

/// Where a reference stands: the top-level block, and for a paragraph in a table cell its row, cell and block in the cell
pub type Place = (usize, Option<(usize, usize, usize)>);

/// What `take_markers` finds: the note references (place, byte place, number), the numbers of every note found, and the character ranges
pub type Markers = (Vec<(Place, usize, u32)>, Vec<u32>, Vec<CharRange>);

/// A range of letters in a character style: where it is, the byte places of its start and end in the text without the markers, and the style
pub type CharRange = (Place, usize, usize, String);

/// The characters that wrap a range of letters in a character style in the editor's HTML: `U+E006 id U+E007 ... U+E008` (see `styles.rs`). They are
/// taken off together with the note markers, in one pass from the left, so that the places of both are those of the text without any marker.
const CHAR_OPEN: char = '\u{E006}';
const CHAR_ID_END: char = '\u{E007}';
const CHAR_CLOSE: char = '\u{E008}';

/// Takes the markers off the text of a document read from the editor's HTML. Returns where each note reference stood (the place, the byte place in
/// the paragraph's text without the markers, the note number), every note number found anywhere, and the ranges in a character style. Markers in a
/// table nested in a cell are taken off the text but nothing is kept.
pub fn take_markers(doc: &mut Document) -> Markers {
    // The notes found in a paragraph (byte place, number) and the character ranges (start, end, style)
    type Found = (Vec<(usize, u32)>, Vec<(usize, usize, String)>);
    fn cut(p: &mut Paragraph, a: usize, end: usize) {
        p.text.drain(a..end);
        let mut at = 0;
        for r in &mut p.runs {
            let (from, to) = (at, at + r.len);
            at = to;
            r.len -= to.min(end).saturating_sub(from.max(a));
        }
        p.runs.retain(|r| r.len > 0);
        p.rev = wordcraft_doc::para::next_rev();
    }
    fn strip(p: &mut Paragraph) -> Found {
        let mut found: Found = (Vec::new(), Vec::new());
        let mut open: Vec<(usize, String)> = Vec::new();
        let mut from = 0;
        loop {
            // The next marker of any kind, from where the last one was
            let next = p.text[from..].char_indices().find(|(_, c)| matches!(*c, OPEN | CHAR_OPEN | CHAR_CLOSE)).map(|(i, c)| (from + i, c));
            let Some((a, c)) = next else { break };
            match c {
                OPEN => {
                    let Some(rel) = p.text[a..].find(CLOSE) else { break };
                    let end = a + rel + CLOSE.len_utf8();
                    let id = p.text[a + OPEN.len_utf8()..a + rel].parse::<u32>().ok();
                    cut(p, a, end);
                    if let Some(id) = id {
                        found.0.push((a, id));
                    }
                }
                CHAR_OPEN => {
                    let Some(rel) = p.text[a..].find(CHAR_ID_END) else { break };
                    let end = a + rel + CHAR_ID_END.len_utf8();
                    let id = p.text[a + CHAR_OPEN.len_utf8()..a + rel].to_string();
                    cut(p, a, end);
                    open.push((a, id));
                }
                _ => {
                    cut(p, a, a + CHAR_CLOSE.len_utf8());
                    if let Some((start, id)) = open.pop() {
                        found.1.push((start, a, id));
                    }
                }
            }
            from = a;
        }
        found
    }
    // A table nested in a cell: the markers go, nothing is kept
    fn walk(blocks: &mut [Arc<Block>], ids: &mut Vec<u32>) {
        for b in blocks {
            match Arc::make_mut(b) {
                Block::Para(p) => ids.extend(strip(p).0.into_iter().map(|(_, id)| id)),
                Block::Table(t) => t.rows.iter_mut().for_each(|r| r.cells.iter_mut().for_each(|c| walk(&mut c.blocks, ids))),
            }
        }
    }
    let (mut at, mut ids, mut chars) = (Vec::new(), Vec::new(), Vec::new());
    for (i, b) in doc.body.iter_mut().enumerate() {
        match Arc::make_mut(b) {
            Block::Para(p) => {
                let (notes, ranges) = strip(p);
                for (off, id) in notes {
                    at.push(((i, None), off, id));
                    ids.push(id);
                }
                chars.extend(ranges.into_iter().map(|(a, e, id)| ((i, None), a, e, id)));
            }
            Block::Table(t) => {
                for (r, row) in t.rows.iter_mut().enumerate() {
                    for (c, cell) in row.cells.iter_mut().enumerate() {
                        for (k, cb) in cell.blocks.iter_mut().enumerate() {
                            if matches!(&**cb, Block::Table(_)) {
                                walk(std::slice::from_mut(cb), &mut ids);
                            } else if let Block::Para(p) = Arc::make_mut(cb) {
                                let (notes, ranges) = strip(p);
                                for (off, id) in notes {
                                    at.push(((i, Some((r, c, k))), off, id));
                                    ids.push(id);
                                }
                                chars.extend(ranges.into_iter().map(|(a, e, id)| ((i, Some((r, c, k))), a, e, id)));
                            }
                        }
                    }
                }
            }
        }
    }
    (at, ids, chars)
}

/// The paragraphs of a note from its words: `**bold**` and `*italic*` are bold and italic, `\*` and `\\` the characters themselves
fn note_blocks(text: &str) -> Vec<Arc<Block>> {
    text.split('\n')
        .map(|line| {
            let line: String = line.chars().take(4000).collect();
            let mut p = Paragraph::new();
            let (mut bold, mut italic) = (false, false);
            let mut buf = String::new();
            let flush = |p: &mut Paragraph, buf: &mut String, bold: bool, italic: bool| {
                if buf.is_empty() {
                    return;
                }
                let props = wordcraft_doc::CharProps { bold: bold.then_some(true), italic: italic.then_some(true), ..Default::default() };
                let at = p.text.len();
                let _ = p.insert_text(at, buf, &props);
                buf.clear();
            };
            let chars: Vec<char> = line.chars().collect();
            let mut i = 0;
            while i < chars.len() {
                match chars[i] {
                    '\\' if i + 1 < chars.len() && (chars[i + 1] == '*' || chars[i + 1] == '\\') => {
                        buf.push(chars[i + 1]);
                        i += 2;
                    }
                    '*' if chars.get(i + 1) == Some(&'*') => {
                        flush(&mut p, &mut buf, bold, italic);
                        bold = !bold;
                        i += 2;
                    }
                    '*' => {
                        flush(&mut p, &mut buf, bold, italic);
                        italic = !italic;
                        i += 1;
                    }
                    c => {
                        buf.push(c);
                        i += 1;
                    }
                }
            }
            flush(&mut p, &mut buf, bold, italic);
            wordcraft_doc::para_block(p)
        })
        .collect()
}

/// The paragraph at a place, when there is one
pub(super) fn para_mut<'a>(doc: &'a mut Document, place: &Place) -> Option<&'a mut Paragraph> {
    let block = Arc::make_mut(doc.body.get_mut(place.0)?);
    match (block, place.1) {
        (Block::Para(p), None) => Some(p),
        (Block::Table(t), Some((r, c, k))) => match Arc::make_mut(t.rows.get_mut(r)?.cells.get_mut(c)?.blocks.get_mut(k)?) {
            Block::Para(p) => Some(p),
            Block::Table(_) => None,
        },
        _ => None,
    }
}

/// Whether some paragraph of the document, in a table cell or not, already refers to the note with this part number
fn refers_to(blocks: &[Arc<Block>], part: u32) -> bool {
    blocks.iter().any(|b| match &**b {
        Block::Para(p) => p.objects.iter().any(|o| matches!(o, InlineObject::NoteRef { id, .. } if *id == part)),
        Block::Table(t) => t.rows.iter().any(|r| r.cells.iter().any(|c| refers_to(&c.blocks, part))),
    })
}

/// Takes out of a paragraph the references whose number is in no marker
fn drop_gone(p: &mut Paragraph, ids: &[u32]) {
    let mut k = 0;
    while k < p.objects.len() {
        if matches!(&p.objects[k], InlineObject::NoteRef { id, .. } if !ids.contains(id)) {
            // The place of the k-th object character in the text
            if let Some((off, c)) = p.text.char_indices().filter(|(_, c)| *c == wordcraft_doc::para::OBJ).nth(k) {
                let _ = p.delete(off, off + c.len_utf8());
                continue;
            }
        }
        k += 1;
    }
}

fn drop_gone_in(blocks: &mut [Arc<Block>], ids: &[u32]) {
    for b in blocks {
        let needs = match &**b {
            Block::Para(p) => p.objects.iter().any(|o| matches!(o, InlineObject::NoteRef { id, .. } if !ids.contains(id))),
            Block::Table(_) => true,
        };
        if !needs {
            continue;
        }
        match Arc::make_mut(b) {
            Block::Para(p) => drop_gone(p, ids),
            Block::Table(t) => t.rows.iter_mut().for_each(|r| r.cells.iter_mut().for_each(|c| drop_gone_in(&mut c.blocks, ids))),
        }
    }
}

/// Makes the notes of the finished document what the person has: a reference they added becomes a real one with a new note, a note whose
/// words they changed gets the new words, and a reference they took out is taken out of the paragraph the file kept as it was.
/// `notes` is what the editor holds (`None` from an editor that does not know notes: the document's notes are left alone).
pub fn settle(doc: &mut Document, at: &[(Place, usize, u32)], ids: &[u32], notes: Option<&[NoteIn]>) {
    let Some(notes) = notes else { return };
    // 1. References the person took out: in the paragraphs the merge kept as the file had them, a reference whose number is in no marker
    drop_gone_in(&mut doc.body, ids);
    // 2. References that are new, with their notes; and the words of the notes that were there
    let mut made: Vec<(u32, u32)> = Vec::new();
    for (place, off, id) in at {
        let Some(note) = notes.iter().find(|n| n.id == *id) else { continue };
        let kind = if note.end { NoteKind::Endnote } else { NoteKind::Footnote };
        if doc.parts.contains_key(id) && refers_to(&doc.body, *id) {
            // The file's own note: its words change only when the person changed them
            if doc.parts.get(id).is_some_and(|part| text_of(&part.blocks) != note.text.trim()) {
                if let Some(part) = doc.parts.get_mut(id) {
                    part.blocks = note_blocks(&note.text);
                }
            }
            continue;
        }
        let part = match made.iter().find(|(from, _)| from == id) {
            Some((_, part)) => *part,
            None => {
                let part = doc.add_part(if note.end { PartKind::Endnote } else { PartKind::Footnote }, note_blocks(&note.text));
                made.push((*id, part));
                part
            }
        };
        if let Some(p) = para_mut(doc, place) {
            let at = (*off).min(p.text.len());
            let at = (0..=at).rev().find(|i| p.text.is_char_boundary(*i)).unwrap_or(0);
            let _ = p.insert_object(at, InlineObject::NoteRef { kind, id: part, custom: String::new() }, &wordcraft_doc::CharProps::default());
        }
    }
}
