//! Windows metafile pictures (.emf, .wmf; what older Word, Visio and Excel documents paste for charts and clip art) as SVG, which a page can show.
//! The editor's page cannot draw these formats, so without this a document's old pictures opened blank.

use base64::prelude::{Engine, BASE64_STANDARD};
use std::fmt::Write;
use wordcraft_metafile::{HAlign, Item, Seg, VAlign};

/// Largest SVG written, in bytes (a metafile of a million tiny paths would otherwise fill a page's memory)
const MAX_SVG: usize = 24 * 1024 * 1024;

/// The metafile in `bytes` as an SVG document, or None when it is not one, does not parse, or has no size
pub fn to_svg(bytes: &[u8]) -> Option<String> {
    if !wordcraft_metafile::is_metafile(bytes) {
        return None;
    }
    let pic = wordcraft_metafile::parse(bytes).ok()?;
    let (w, h) = (pic.width, pic.height);
    if !(w.is_finite() && h.is_finite() && w > 0.0 && h > 0.0) {
        return None;
    }
    let mut s = String::new();
    let _ = write!(s, "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 {w:.2} {h:.2}\" width=\"{w:.2}\" height=\"{h:.2}\">");
    for item in &pic.items {
        if s.len() > MAX_SVG {
            break;
        }
        match item {
            Item::Path { segs, fill, stroke, even_odd } => {
                let mut d = String::new();
                for seg in segs {
                    let _ = match *seg {
                        Seg::Move(x, y) => write!(d, "M{x:.2} {y:.2}"),
                        Seg::Line(x, y) => write!(d, "L{x:.2} {y:.2}"),
                        Seg::Cubic(a, b, c, e, f, g) => write!(d, "C{a:.2} {b:.2} {c:.2} {e:.2} {f:.2} {g:.2}"),
                        Seg::Close => write!(d, "Z"),
                    };
                }
                let _ = write!(s, "<path d=\"{d}\" fill=\"{}\"{}", paint(*fill), if *even_odd { " fill-rule=\"evenodd\"" } else { "" });
                // A pen of width 0 is a hairline
                if let Some((c, w)) = stroke {
                    let _ = write!(s, " stroke=\"{}\" stroke-width=\"{:.2}\" stroke-linecap=\"round\" stroke-linejoin=\"round\"", paint(Some(*c)), w.max(0.3));
                }
                s.push_str("/>");
            }
            Item::Bitmap { rect: [x, y, w, h], width, height, rgba } => {
                if let Some(png) = png(*width, *height, rgba) {
                    let _ = write!(s, "<image x=\"{x:.2}\" y=\"{y:.2}\" width=\"{w:.2}\" height=\"{h:.2}\" preserveAspectRatio=\"none\" href=\"data:image/png;base64,{}\"/>", BASE64_STANDARD.encode(png));
                }
            }
            Item::Text(t) => {
                let anchor = match t.halign {
                    HAlign::Left => "start",
                    HAlign::Center => "middle",
                    HAlign::Right => "end",
                };
                let baseline = match t.valign {
                    VAlign::Top => "hanging",
                    VAlign::Baseline => "alphabetic",
                    VAlign::Bottom => "text-after-edge",
                };
                // A cell height counts the leading, so the em is a little smaller
                let size = if t.cell { t.size * 0.8 } else { t.size };
                let family: String = t.font.chars().filter(|c| c.is_alphanumeric() || *c == ' ' || *c == '-').collect();
                let _ = write!(
                    s,
                    "<text transform=\"translate({:.2} {:.2}) rotate({:.2})\" font-family=\"'{family}',sans-serif\" font-size=\"{size:.2}\" text-anchor=\"{anchor}\" dominant-baseline=\"{baseline}\" fill=\"{}\"{}{} xml:space=\"preserve\">{}</text>",
                    t.x,
                    t.y,
                    t.angle.to_degrees(),
                    paint(Some(t.color)),
                    if t.bold { " font-weight=\"bold\"" } else { "" },
                    if t.italic { " font-style=\"italic\"" } else { "" },
                    escape(&t.text)
                );
            }
        }
    }
    s.push_str("</svg>");
    Some(s)
}

fn paint(c: Option<[u8; 4]>) -> String {
    match c {
        Some([r, g, b, a]) if a > 0 => {
            if a == 255 {
                format!("#{r:02x}{g:02x}{b:02x}")
            } else {
                format!("rgba({r},{g},{b},{:.2})", f32::from(a) / 255.0)
            }
        }
        _ => "none".to_string(),
    }
}

fn escape(t: &str) -> String {
    t.chars().filter(|c| !c.is_control() || *c == '\t').map(|c| match c {
        '<' => "&lt;".to_string(),
        '>' => "&gt;".to_string(),
        '&' => "&amp;".to_string(),
        c => c.to_string(),
    }).collect()
}

/// RGBA pixels as a PNG (stored, not compressed: bitmaps in metafiles are small, and this keeps a crate out)
fn png(w: u32, h: u32, rgba: &[u8]) -> Option<Vec<u8>> {
    if w == 0 || h == 0 || w > 8192 || h > 8192 || rgba.len() != w as usize * h as usize * 4 {
        return None;
    }
    let mut raw = Vec::with_capacity(rgba.len() + h as usize);
    for row in rgba.chunks(w as usize * 4) {
        raw.push(0);
        raw.extend_from_slice(row);
    }
    let mut z = vec![0x78, 0x01];
    let mut chunks = raw.chunks(65535).peekable();
    while let Some(c) = chunks.next() {
        z.push(u8::from(chunks.peek().is_none()));
        z.extend_from_slice(&(c.len() as u16).to_le_bytes());
        z.extend_from_slice(&(!(c.len() as u16)).to_le_bytes());
        z.extend_from_slice(c);
    }
    let (mut a, mut b) = (1u32, 0u32);
    for &x in &raw {
        a = (a + u32::from(x)) % 65521;
        b = (b + a) % 65521;
    }
    z.extend_from_slice(&((b << 16) | a).to_be_bytes());
    let mut out = b"\x89PNG\r\n\x1a\n".to_vec();
    let mut head = Vec::new();
    head.extend_from_slice(&w.to_be_bytes());
    head.extend_from_slice(&h.to_be_bytes());
    head.extend_from_slice(&[8, 6, 0, 0, 0]);
    chunk(&mut out, b"IHDR", &head);
    chunk(&mut out, b"IDAT", &z);
    chunk(&mut out, b"IEND", &[]);
    Some(out)
}

fn chunk(out: &mut Vec<u8>, kind: &[u8; 4], data: &[u8]) {
    out.extend_from_slice(&(data.len() as u32).to_be_bytes());
    let start = out.len();
    out.extend_from_slice(kind);
    out.extend_from_slice(data);
    let mut crc = 0xFFFF_FFFFu32;
    for &byte in &out[start..] {
        crc ^= u32::from(byte);
        for _ in 0..8 {
            crc = if crc & 1 == 1 { (crc >> 1) ^ 0xEDB8_8320 } else { crc >> 1 };
        }
    }
    out.extend_from_slice(&(!crc).to_be_bytes());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_png_has_a_valid_signature_and_length() {
        let p = png(2, 2, &[255; 16]).unwrap();
        assert!(p.starts_with(b"\x89PNG"));
        assert!(png(2, 2, &[0; 3]).is_none());
    }

    #[test]
    fn something_that_is_not_a_metafile_is_not_converted() {
        assert!(to_svg(b"not a metafile at all").is_none());
    }

    #[test]
    fn every_metafile_in_the_corpus_draws_something() {
        // The corpus is kept outside the repository; this runs only where it is
        let Some(dir) = std::env::var_os("GOVDOCS_DOCX") else { return };
        let (mut seen, mut drawn) = (0, 0);
        for f in std::fs::read_dir(dir).unwrap().flatten() {
            let Ok(mut z) = std::fs::File::open(f.path()).map(zip::ZipArchive::new).and_then(|r| r.map_err(std::io::Error::other)) else { continue };
            for i in 0..z.len() {
                let mut e = z.by_index(i).unwrap();
                if !(e.name().ends_with(".emf") || e.name().ends_with(".wmf")) {
                    continue;
                }
                let mut b = Vec::new();
                std::io::Read::read_to_end(&mut e, &mut b).unwrap();
                seen += 1;
                if to_svg(&b).is_some_and(|s| s.len() > 120) {
                    drawn += 1;
                }
            }
        }
        eprintln!("{drawn} of {seen} metafiles drawn");
        assert!(drawn * 10 >= seen * 8, "{drawn} of {seen}");
    }
}
