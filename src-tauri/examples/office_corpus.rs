//! Development only: the round-trip corpus check. Every .docx in a folder is read, laid out, written back, read again and laid out
//! again; the two are compared (text, tables, pages, parts of the package). `cargo run --example office_corpus -- <folder>`.
//! Prints one line per file and a summary; a file that loses text, tables or pages, or that panics, is marked `LOSS`.

use std::panic::{catch_unwind, AssertUnwindSafe};
use wordcraft_doc::Block;

#[derive(Default, PartialEq, Debug)]
struct Shape {
    text: String,
    paras: usize,
    tables: usize,
    cells: usize,
}

fn walk(blocks: &[std::sync::Arc<Block>], s: &mut Shape) {
    for b in blocks {
        match &**b {
            Block::Para(p) => {
                s.paras += 1;
                s.text.push_str(&p.text.replace('\u{fffc}', ""));
                s.text.push('\n');
            }
            Block::Table(t) => {
                s.tables += 1;
                for c in t.rows.iter().flat_map(|r| r.cells.iter()) {
                    s.cells += 1;
                    walk(&c.blocks, s);
                }
            }
        }
    }
}

fn shape(doc: &wordcraft_doc::Document) -> Shape {
    let mut s = Shape::default();
    walk(&doc.body, &mut s);
    s
}

fn pages(doc: &wordcraft_doc::Document) -> usize {
    wordcraft_layout::layout(doc, &mut wordcraft_layout::LayoutCache::new(), &wordcraft_layout::LayoutOptions::default()).pages.len()
}

/// How often the body (`word/document.xml`) uses things a round trip must keep
fn marks(bytes: &[u8]) -> Vec<(&'static str, usize)> {
    let mut text = String::new();
    if let Ok(mut z) = zip::ZipArchive::new(std::io::Cursor::new(bytes)) {
        if let Ok(mut f) = z.by_name("word/document.xml") {
            use std::io::Read;
            let _ = f.read_to_string(&mut text);
        }
    }
    // The fallback of an mc:AlternateContent repeats what its choice shows
    while let Some(i) = text.find("<mc:Fallback") {
        let end = text[i..].find("</mc:Fallback>").map_or(text.len(), |e| i + e + "</mc:Fallback>".len());
        text.replace_range(i..end, "");
    }
    [("pictures", "<w:drawing"), ("old pictures", "<w:pict"), ("footnotes", "<w:footnoteReference"), ("endnotes", "<w:endnoteReference"), ("comments", "<w:commentReference"), ("links", "</w:hyperlink>"), ("sections", "<w:sectPr"), ("fields", "w:fldCharType=\"begin\""), ("bookmarks", "<w:bookmarkStart")]
        .into_iter()
        .map(|(what, tag)| (what, text.matches(tag).count()))
        .collect()
}

fn main() {
    let dir = std::env::args().nth(1).expect("a folder");
    let _ = nexsync_lib::lab::fonts::load_fonts();
    let mut files: Vec<_> = std::fs::read_dir(&dir).expect("folder").flatten().map(|e| e.path()).filter(|p| p.extension().is_some_and(|x| x.eq_ignore_ascii_case("docx")) && !p.file_name().unwrap().to_string_lossy().starts_with("~$")).collect();
    files.sort();
    let (mut ok, mut bad) = (0, 0);
    for f in files {
        let name = f.file_name().unwrap().to_string_lossy().to_string();
        let bytes = std::fs::read(&f).unwrap();
        let t0 = std::time::Instant::now();
        let r = catch_unwind(AssertUnwindSafe(|| -> Result<Vec<String>, String> {
            let a = wordcraft_docx::read_with_password(&bytes, None).map_err(|e| format!("read: {e}"))?;
            let (sa, pa) = (shape(&a), pages(&a));
            let out = wordcraft_docx::write(&a).map_err(|e| format!("write: {e}"))?;
            if let Some(d) = std::env::var_os("OUTDIR") {
                let _ = std::fs::write(std::path::Path::new(&d).join(f.file_name().unwrap()), &out);
            }
            let b = wordcraft_docx::read_with_password(&out, None).map_err(|e| format!("reread: {e}"))?;
            let (sb, pb) = (shape(&b), pages(&b));
            let mut loss = Vec::new();
            if sa.text != sb.text {
                loss.push(format!("text {} -> {} chars", sa.text.len(), sb.text.len()));
            }
            if sa.tables != sb.tables || sa.cells != sb.cells {
                loss.push(format!("tables {}/{} -> {}/{}", sa.tables, sa.cells, sb.tables, sb.cells));
            }
            if pa != pb {
                loss.push(format!("pages {pa} -> {pb}"));
            }
            // What the body refers to (pictures, notes, comments, links, sections) before and after; parts nothing refers to may go
            let (co, cw) = (marks(&bytes), marks(&out));
            for ((what, x), (_, y)) in co.iter().zip(&cw) {
                if y < x {
                    loss.push(format!("{what} {x} -> {y}"));
                }
            }
            Ok(loss)
        }));
        let ms = t0.elapsed().as_millis();
        match r {
            Ok(Ok(loss)) if loss.is_empty() => {
                ok += 1;
                println!("ok    {ms:6} ms  {name}");
            }
            Ok(Ok(loss)) => {
                bad += 1;
                println!("LOSS  {ms:6} ms  {name}: {}", loss.join("; "));
            }
            Ok(Err(e)) => {
                bad += 1;
                println!("ERROR {ms:6} ms  {name}: {e}");
            }
            Err(_) => {
                bad += 1;
                println!("PANIC {ms:6} ms  {name}");
            }
        }
    }
    println!("{ok} round-trip clean, {bad} with losses or errors");
}
