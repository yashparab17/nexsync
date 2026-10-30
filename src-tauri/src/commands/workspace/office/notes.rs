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

fn text_of(blocks: &[Arc<Block>]) -> String {
    blocks
        .iter()
        .filter_map(|b| match &**b {
            Block::Para(p) => Some(p.plain_text()),
            Block::Table(_) => None,
        })
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string()
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

/// Takes the markers off the text of a document read from the editor's HTML. Returns where each stood (top-level paragraph, byte place in
/// its text without the markers, note number) and every note number found anywhere, tables included.
pub fn take_markers(doc: &mut Document) -> (Vec<(usize, usize, u32)>, Vec<u32>) {
    fn strip(p: &mut Paragraph) -> Vec<(usize, u32)> {
        let mut found = Vec::new();
        while let Some(a) = p.text.find(OPEN) {
            let Some(rel) = p.text[a..].find(CLOSE) else { break };
            let end = a + rel + CLOSE.len_utf8();
            let id = p.text[a + OPEN.len_utf8()..a + rel].parse::<u32>().ok();
            p.text.drain(a..end);
            // Shorten the runs the marker lay in
            let mut at = 0;
            for r in &mut p.runs {
                let (from, to) = (at, at + r.len);
                at = to;
                r.len -= to.min(end).saturating_sub(from.max(a));
            }
            p.runs.retain(|r| r.len > 0);
            p.rev = wordcraft_doc::para::next_rev();
            if let Some(id) = id {
                found.push((a, id));
            }
        }
        found
    }
    fn walk(blocks: &mut [Arc<Block>], ids: &mut Vec<u32>) {
        for b in blocks {
            match Arc::make_mut(b) {
                Block::Para(p) => ids.extend(strip(p).into_iter().map(|(_, id)| id)),
                Block::Table(t) => t.rows.iter_mut().for_each(|r| r.cells.iter_mut().for_each(|c| walk(&mut c.blocks, ids))),
            }
        }
    }
    let (mut at, mut ids) = (Vec::new(), Vec::new());
    for (i, b) in doc.body.iter_mut().enumerate() {
        if let Block::Para(p) = Arc::make_mut(b) {
            for (off, id) in strip(p) {
                at.push((i, off, id));
                ids.push(id);
            }
        }
    }
    // References in tables are not kept as references, but their markers must not stay in the text
    for b in doc.body.iter_mut() {
        if let Block::Table(_) = &**b {
            walk(std::slice::from_mut(b), &mut ids);
        }
    }
    (at, ids)
}

fn note_blocks(text: &str) -> Vec<Arc<Block>> {
    let lines: Vec<&str> = text.split('\n').collect();
    lines.iter().map(|l| wordcraft_doc::para_block(Paragraph::with_text(&l.chars().take(4000).collect::<String>(), wordcraft_doc::CharProps::default()))).collect()
}

/// Makes the notes of the finished document what the person has: a reference they added becomes a real one with a new note, a note whose
/// words they changed gets the new words, and a reference they took out is taken out of the paragraph the file kept as it was.
/// `notes` is what the editor holds (`None` from an editor that does not know notes: the document's notes are left alone).
pub fn settle(doc: &mut Document, at: &[(usize, usize, u32)], ids: &[u32], notes: Option<&[NoteIn]>) {
    let Some(notes) = notes else { return };
    // 1. References the person took out: in the paragraphs the merge kept as the file had them, a reference whose number is in no marker
    for b in doc.body.iter_mut() {
        let Block::Para(p) = &**b else { continue };
        if !p.objects.iter().any(|o| matches!(o, InlineObject::NoteRef { id, .. } if !ids.contains(id))) {
            continue;
        }
        let Block::Para(p) = Arc::make_mut(b) else { continue };
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
    // 2. References that are new, with their notes; and the words of the notes that were there
    let mut made: Vec<(u32, u32)> = Vec::new();
    for (bi, off, id) in at {
        let Some(note) = notes.iter().find(|n| n.id == *id) else { continue };
        let kind = if note.end { NoteKind::Endnote } else { NoteKind::Footnote };
        let Some(Block::Para(p)) = doc.body.get(*bi).map(|b| &**b) else { continue };
        let has = p.objects.iter().any(|o| matches!(o, InlineObject::NoteRef { id: part, .. } if *part == *id && doc.parts.contains_key(part)));
        if has {
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
        if let Some(Block::Para(p)) = doc.body.get_mut(*bi).map(Arc::make_mut) {
            let at = (*off).min(p.text.len());
            let at = (0..=at).rev().find(|i| p.text.is_char_boundary(*i)).unwrap_or(0);
            let _ = p.insert_object(at, InlineObject::NoteRef { kind, id: part, custom: String::new() }, &wordcraft_doc::CharProps::default());
        }
    }
}
