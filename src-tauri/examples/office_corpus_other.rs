//! Development only: the round-trip corpus check for .xlsx and .pptx (see `office_corpus` for .docx).
//! `cargo run --example office_corpus_other -- <folder>` reads every .xlsx and .pptx in a folder, writes it, reads it again and compares
//! the two models field by field (sheets, cells, styles; slides, shapes, notes). A difference, an error or a panic is marked `LOSS`.

use serde_json::Value;
use std::panic::{catch_unwind, AssertUnwindSafe};

/// The top-level fields (and, for lists, the lengths) in which two models differ
fn diff(a: &Value, b: &Value, path: &str, out: &mut Vec<String>) {
    if a == b || out.len() >= 6 {
        return;
    }
    match (a, b) {
        (Value::Object(x), Value::Object(y)) => {
            for (k, v) in x {
                match y.get(k) {
                    Some(w) => diff(v, w, &format!("{path}.{k}"), out),
                    None => out.push(format!("{path}.{k} lost")),
                }
            }
        }
        (Value::Array(x), Value::Array(y)) if x.len() != y.len() => out.push(format!("{path} {} -> {} items", x.len(), y.len())),
        (Value::Array(x), Value::Array(y)) => {
            for (i, (v, w)) in x.iter().zip(y).enumerate() {
                diff(v, w, &format!("{path}[{i}]"), out);
            }
        }
        _ => out.push(if std::env::var_os("NEXDIFF").is_some() { format!("{path}: {a} -> {b}") } else { format!("{path} changed") }),
    }
}

/// (slides, shapes, media items, media bytes, all text, animations) of a deck's JSON
fn deck_facts(v: &Value) -> (usize, usize, usize, usize, String, usize) {
    fn walk(v: &Value, shapes: &mut usize, text: &mut String) {
        match v {
            Value::Object(m) => {
                if m.contains_key("kind") && m.contains_key("id") {
                    *shapes += 1;
                }
                for (k, w) in m {
                    if k == "text" {
                        if let Value::String(t) = w {
                            text.push_str(t);
                            text.push(' ');
                        }
                    }
                    walk(w, shapes, text);
                }
            }
            Value::Array(a) => a.iter().for_each(|w| walk(w, shapes, text)),
            _ => {}
        }
    }
    let (mut shapes, mut text) = (0, String::new());
    let slides = v.get("slides").and_then(Value::as_array);
    if let Some(s) = slides {
        s.iter().for_each(|w| walk(w, &mut shapes, &mut text));
    }
    let media = v.get("media").and_then(Value::as_array);
    let bytes = media.map_or(0, |m| m.iter().map(|i| i.to_string().len()).sum());
    let anim = slides.map_or(0, |s| s.iter().map(|x| x.get("animations").and_then(Value::as_array).map_or(0, Vec::len)).sum());
    (slides.map_or(0, Vec::len), shapes, media.map_or(0, Vec::len), bytes, text, anim)
}

fn main() {
    let dir = std::env::args().nth(1).expect("a folder");
    let mut files: Vec<_> = std::fs::read_dir(&dir).expect("folder").flatten().map(|e| e.path()).filter(|p| p.extension().is_some_and(|x| x.eq_ignore_ascii_case("xlsx") || x.eq_ignore_ascii_case("pptx"))).collect();
    files.sort();
    let (mut ok, mut bad) = (0, 0);
    for f in files {
        let name = f.file_name().unwrap().to_string_lossy().to_string();
        let bytes = std::fs::read(&f).unwrap();
        let t0 = std::time::Instant::now();
        let is_x = name.ends_with(".xlsx");
        let r = catch_unwind(AssertUnwindSafe(|| -> Result<Vec<String>, String> {
            let (a, out) = if is_x {
                let (wb, _) = gridcraft_xlsx::read_xlsx(&bytes).map_err(|e| format!("read: {e}"))?;
                let out = gridcraft_xlsx::write_xlsx(&wb).map_err(|e| format!("write: {e}"))?;
                (serde_json::to_value(&wb).map_err(|e| e.to_string())?, out)
            } else {
                let p = deckcraft_pptx::import(&bytes).map_err(|e| format!("read: {e}"))?;
                let out = deckcraft_pptx::export(&p).map_err(|e| format!("write: {e}"))?;
                (serde_json::to_value(&p).map_err(|e| e.to_string())?, out)
            };
            let b = if is_x {
                serde_json::to_value(gridcraft_xlsx::read_xlsx(&out).map_err(|e| format!("reread: {e}"))?.0).map_err(|e| e.to_string())?
            } else {
                serde_json::to_value(deckcraft_pptx::import(&out).map_err(|e| format!("reread: {e}"))?).map_err(|e| e.to_string())?
            };
            let mut d = Vec::new();
            if is_x {
                diff(&a, &b, "", &mut d);
            } else {
                // A deck is compared by what a person sees: slides, shapes, every text, the pictures and the notes. Ids and names are renewed on writing.
                let (x, y) = (deck_facts(&a), deck_facts(&b));
                for (what, p, q) in [("slides", x.0, y.0), ("shapes", x.1, y.1), ("animations", x.5, y.5)] {
                    if p != q {
                        d.push(format!("{what} {p} -> {q}"));
                    }
                }
                // A picture may be added (a thumbnail) but never lost
                if y.2 < x.2 {
                    d.push(format!("pictures {} -> {}", x.2, y.2));
                }
                if x.4 != y.4 {
                    d.push(format!("text {} -> {} chars", x.4.len(), y.4.len()));
                }
            }
            Ok(d)
        }));
        let ms = t0.elapsed().as_millis();
        match r {
            Ok(Ok(d)) if d.is_empty() => {
                ok += 1;
                println!("ok    {ms:6} ms  {name}");
            }
            Ok(Ok(d)) => {
                bad += 1;
                println!("LOSS  {ms:6} ms  {name}: {}", d.join("; "));
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
