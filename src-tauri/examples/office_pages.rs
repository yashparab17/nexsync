//! Development only: lays a .docx out with WordCraft's engine, as the app does, and prints where each page starts, so the page
//! numbers can be compared with the ones Word saved in the file's table of contents. `cargo run --example office_pages -- file.docx`.

use wordcraft_doc::Block;

fn main() {
    let path = std::env::args().nth(1).expect("a .docx path");
    if std::env::var("NOCLOUD").is_err() {
        eprintln!("cloud fonts added: {}", nexsync_lib::lab::fonts::load_fonts());
    }
    let bytes = std::fs::read(&path).expect("readable file");
    let mut doc = wordcraft_docx::read_with_password(&bytes, None).expect("readable docx");
    // HACK=bullets: bullets drawn in the text's own font (their line then is no taller than the text's)
    if std::env::var("HACK").is_ok_and(|h| h.contains("bullets")) {
        for a in doc.numbering.abstracts.iter_mut() {
            for l in a.levels.iter_mut() {
                if matches!(l.chr.font.as_deref(), Some("Symbol") | Some("Wingdings")) {
                    l.chr.font = None;
                }
            }
        }
    }
    let laid = wordcraft_layout::layout(&doc, &mut wordcraft_layout::LayoutCache::new(), &wordcraft_layout::LayoutOptions::default());
    println!("pages {}", laid.pages.len());
    // PDF=out.pdf: the document as the app would export it, to compare page by page with the PDF Word saved (`compare_pdfs.py`)
    if let Ok(out) = std::env::var("PDF") {
        let pdf = wordcraft_pdf::export(&doc, &wordcraft_pdf::PdfOptions::default()).expect("pdf export");
        std::fs::write(out, pdf).expect("writable pdf path");
        return;
    }
    for fam in std::env::args().skip(2) {
        for (b, i) in [(false, false), (true, false)] {
            let r = wordcraft_fonts::word::resolve(&fam, b, i);
            let (a, d) = wordcraft_fonts::word::line_metrics(&r.face);
            eprintln!("{fam} bold={b}: face {} {} substituted={} synth_bold={} upem={} ascent={} descent={} line={:.4}em weight={}", r.face.family, r.face.style, r.substituted, r.synth_bold, r.face.upem, a, d, (a + d) / r.face.upem, r.face.weight);
        }
    }
    if let Ok(pg) = std::env::var("PAGE") {
        let page = &laid.pages[pg.parse::<usize>().unwrap() - 1];
        println!("body {:?} first_block {}", page.body, page.first_block);
        for it in &page.items {
            if std::env::var("CELLS").is_ok() {
                if let wordcraft_layout::Placed::Cell { rect, row, cell, .. } = it {
                    println!("cell row {row} col {cell}: x {:.3} y {:.2} w {:.3} h {:.2}", rect.x, rect.y, rect.w, rect.h);
                }
            }
            if let wordcraft_layout::Placed::Lines { path, para, l0, l1, y, x, .. } = it {
                if std::env::var("XS").is_ok() {
                    for l in &para.lines[*l0..*l1] {
                        println!("  x {:.1}..{:.1} line_end_x {:.1} stop {} limit {:.1}", x + l.left, x + l.right, x + l.xs.last().copied().unwrap_or(0.0), l.stop, x + l.right);
                    }
                }
                if std::env::var("RUN").is_ok() {
                    for (i, st) in para.styles.iter().enumerate() {
                        println!("  style {i}: face {} {} size {} kern {} kerned {} spacing {:?}", st.face.family, st.face.style, st.size, st.rc.kern, st.rc.kerned(), st.rc.spacing);
                    }
                    let l = &para.lines[*l0];
                    println!("  xs {:?}", l.xs.iter().take(40).map(|v| ((x + v) * 100.0).round() / 100.0).collect::<Vec<_>>());
                    let w: f32 = para.clusters[l.c0..l.c1].iter().map(|c| c.adv).sum();
                    println!("  line0 clusters {} sum adv {:.2}", l.c1 - l.c0, w);
                }
                let h: f32 = para.lines[*l0..*l1].iter().map(|l| l.height).sum();
                let rp = format!("{:?}", para.rp);
                println!("y={:.1} lines {}..{} of {} h={:.2} line_h={:.2} path={:?} {}", y, l0, l1, para.lines.len(), h, para.lines.get(*l0).map(|l| l.height).unwrap_or(0.0), path, rp.chars().take(260).collect::<String>());
            }
        }
        return;
    }
    if std::env::var("GAPS").is_ok() {
        // How far apart paragraphs sit, for each combination of space after / before: tells which rule the engine applies
        let mut seen: std::collections::BTreeMap<String, (usize, f32)> = std::collections::BTreeMap::new();
        for page in &laid.pages {
            let mut prev: Option<(&std::sync::Arc<wordcraft_layout::ParaLayout>, f32, usize, usize)> = None;
            for it in &page.items {
                if let wordcraft_layout::Placed::Lines { para, l0, l1, y, .. } = it {
                    if let Some((pp, py, _, pl1)) = prev {
                        if *l0 == 0 && pl1 == pp.lines.len() {
                            let ph: f32 = pp.lines.iter().map(|l| l.height).sum();
                            let gap = y - (py + ph);
                            let key = format!("{} after={} ctx={} -> {} before={} ctx={}", pp.rp.style, pp.rp.space_after, pp.rp.contextual_spacing, para.rp.style, para.rp.space_before, para.rp.contextual_spacing);
                            let e = seen.entry(key).or_insert((0, gap));
                            e.0 += 1;
                        }
                    }
                    prev = Some((para, *y, *l0, *l1));
                }
            }
        }
        for (k, (n, g)) in seen {
            println!("{n:5}x gap {g:5.2}  {k}");
        }
        return;
    }
    for (i, p) in laid.pages.iter().enumerate() {
        // The text the page opens with: the first paragraph with words in it (a table's first cell counts), as a reader sees it
        let mut text = String::new();
        for blk in doc.body.iter().skip(p.first_block).take(6) {
            match &**blk {
                Block::Para(par) if !par.text.replace('\u{fffc}', "").trim().is_empty() => {
                    text = par.text.chars().take(60).collect();
                    break;
                }
                Block::Table(t) => {
                    text = t
                        .rows
                        .iter()
                        .flat_map(|r| r.cells.iter())
                        .flat_map(|c| c.blocks.iter())
                        .find_map(|b| match &**b {
                            Block::Para(par) if !par.text.trim().is_empty() => Some(par.text.chars().take(60).collect::<String>()),
                            _ => None,
                        })
                        .unwrap_or_default();
                    break;
                }
                _ => {}
            }
        }
        println!("{}\t{}\t{}\t{}", i + 1, p.number, p.first_block, text.replace('\n', " "));
    }
}
