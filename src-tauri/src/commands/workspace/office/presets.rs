//! Word's ready-made page-number footers and headers (Insert › Page Number) draw the number in preset shapes WordCraft does not know,
//! such as the Double Bracket: it draws those as plain boxes. For drawing the margins of the editor's pages, a copy of the file is read
//! with each such shape written out as the geometry the preset stands for (ECMA-376 Part 1, `presetShapeDefinitions.xml`, the table
//! Word and LibreOffice both draw from). The file itself, and what is saved from the editor, keep the preset.

use std::io::{Read, Write};

/// A copy of the package with the preset shapes of its headers and footers drawn out, or `None` when it has none to draw
pub fn drawn_copy(bytes: &[u8]) -> Option<Vec<u8>> {
    let mut zip = zip::ZipArchive::new(std::io::Cursor::new(bytes)).ok()?;
    let mut changed = false;
    let mut out = zip::ZipWriter::new(std::io::Cursor::new(Vec::with_capacity(bytes.len())));
    let opts = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    for i in 0..zip.len() {
        let mut f = zip.by_index(i).ok()?;
        let name = f.name().to_string();
        let margin = name.starts_with("word/header") || name.starts_with("word/footer");
        if margin && name.ends_with(".xml") && f.size() < 8 * 1024 * 1024 {
            let mut xml = String::new();
            f.read_to_string(&mut xml).ok()?;
            let xml = match rewrite(&xml) {
                Some(x) => {
                    changed = true;
                    x
                }
                None => xml,
            };
            out.start_file(name, opts).ok()?;
            out.write_all(xml.as_bytes()).ok()?;
        } else {
            out.raw_copy_file(f).ok()?;
        }
    }
    if !changed {
        return None;
    }
    Some(out.finish().ok()?.into_inner())
}

/// Each Double Bracket (`bracketPair`) shape becomes two: the shape itself, still holding its text and its fill but with no outline,
/// and on top of it the two brackets, drawn as a path in the shape's own outline. `None` when the part has none.
// ponytail: only the Double Bracket, the preset of Word's page-number galleries met so far; others can be added the same way
fn rewrite(xml: &str) -> Option<String> {
    const MARK: &str = "prst=\"bracketPair\"";
    if !xml.contains(MARK) {
        return None;
    }
    let mut out = String::with_capacity(xml.len() + 2048);
    let mut rest = xml;
    while let Some(at) = rest.find(MARK) {
        let (Some(start), Some(end_rel)) = (rest[..at].rfind("<w:drawing>"), rest[at..].find("</w:drawing>")) else { break };
        let end = at + end_rel + "</w:drawing>".len();
        // The run holding it ends after the drawing's fallback (an old-style copy of the shape, with runs of its own) when it has one
        let after = match (rest[..start].rfind("<mc:AlternateContent"), rest[end..].find("</mc:AlternateContent>")) {
            (Some(open), Some(close)) if rest[open..start].find("</mc:AlternateContent>").is_none() => end + close + "</mc:AlternateContent>".len(),
            _ => end,
        };
        let Some(run_end_rel) = rest[after..].find("</w:r>") else { break };
        let run_end = after + run_end_rel + "</w:r>".len();
        let drawing = &rest[start..end];
        let (Some(shape), Some(brackets)) = (without_outline(drawing), brackets_of(drawing)) else { break };
        out.push_str(&rest[..start]);
        out.push_str(&shape);
        out.push_str(&rest[end..run_end]);
        out.push_str("<w:r>");
        out.push_str(&brackets);
        out.push_str("</w:r>");
        rest = &rest[run_end..];
    }
    out.push_str(rest);
    (out.len() != xml.len()).then_some(out)
}

/// The text between `open` and the `close` after it, with both
fn span(s: &str, open: &str, close: &str) -> Option<(usize, usize)> {
    let a = s.find(open)?;
    let b = a + s[a..].find(close)? + close.len();
    Some((a, b))
}

fn attr(s: &str, name: &str) -> Option<i64> {
    let key = format!("{name}=\"");
    let at = s.find(&key)? + key.len();
    s[at..].split('"').next()?.trim().parse().ok()
}

/// The shape with no outline (its `a:ln` says none)
fn without_outline(drawing: &str) -> Option<String> {
    let sppr = span(drawing, "<wps:spPr", "</wps:spPr>")?;
    let inner = &drawing[sppr.0..sppr.1];
    let line = inner.find("<a:ln").map(|a| (a, inner[a..].find("</a:ln>").map(|b| a + b + "</a:ln>".len()).or_else(|| inner[a..].find("/>").map(|b| a + b + 2))));
    let mut s = drawing.to_string();
    match line {
        Some((a, Some(b))) => s.replace_range(sppr.0 + a..sppr.0 + b, "<a:ln><a:noFill/></a:ln>"),
        _ => s.insert_str(sppr.1 - "</wps:spPr>".len(), "<a:ln><a:noFill/></a:ln>"),
    }
    Some(s)
}

/// The brackets alone: the same drawing, without its text and fill, its preset written out as a path
fn brackets_of(drawing: &str) -> Option<String> {
    let ext = span(drawing, "<wp:extent", "/>")?;
    let (cx, cy) = (attr(&drawing[ext.0..ext.1], "cx")?.max(1), attr(&drawing[ext.0..ext.1], "cy")?.max(1));
    let geom = span(drawing, "<a:prstGeom", "</a:prstGeom>").or_else(|| span(drawing, "<a:prstGeom", "/>"))?;
    let adj = drawing[geom.0..geom.1].find("name=\"adj\"").and_then(|i| drawing[geom.0 + i..].split("val ").nth(1)?.split('"').next()?.trim().parse::<i64>().ok()).unwrap_or(16_667);
    let mut s = drawing.to_string();
    s.replace_range(geom.0..geom.1, &bracket_pair(cx, cy, adj));
    // No text, no fill
    if let Some((a, b)) = span(&s, "<wps:txbx>", "</wps:txbx>") {
        s.replace_range(a..b, "");
    }
    let sppr = span(&s, "<wps:spPr", "</wps:spPr>")?;
    let geom_end = s[sppr.0..].find("</a:custGeom>").map(|i| sppr.0 + i + "</a:custGeom>".len())?;
    let fill_end = s[geom_end..].find("<a:ln").map(|i| geom_end + i).unwrap_or(sppr.1 - "</wps:spPr>".len());
    s.replace_range(geom_end..fill_end, "<a:noFill/>");
    // A drawing of its own, over the shape
    if let Some(id) = attr(&s, "wp:docPr id") {
        s = s.replacen(&format!("wp:docPr id=\"{id}\""), &format!("wp:docPr id=\"{}\"", id + 1_000_000), 1);
    }
    if let Some(h) = attr(&s, "relativeHeight") {
        s = s.replacen(&format!("relativeHeight=\"{h}\""), &format!("relativeHeight=\"{}\"", h + 1), 1);
    }
    Some(s)
}

/// `bracketPair` (ECMA-376 presetShapeDefinitions): `x1 = ss × pin(0, adj, 50000) / 100000`, a quarter circle of radius `x1` at each
/// corner, the left bracket from bottom to top and the right one from top to bottom, not filled. Quarter circles as cubic Béziers.
fn bracket_pair(w: i64, h: i64, adj: i64) -> String {
    let (w, h) = (w as f64, h as f64);
    let x1 = w.min(h) * adj.clamp(0, 50_000) as f64 / 100_000.0;
    let (x2, y2) = (w - x1, h - x1);
    let k = x1 * 0.552_284_75;
    let p = |x: f64, y: f64| format!("<a:pt x=\"{}\" y=\"{}\"/>", x.round() as i64, y.round() as i64);
    let curve = |a: (f64, f64), b: (f64, f64), c: (f64, f64)| format!("<a:cubicBezTo>{}{}{}</a:cubicBezTo>", p(a.0, a.1), p(b.0, b.1), p(c.0, c.1));
    let left = format!(
        "<a:moveTo>{}</a:moveTo>{}<a:lnTo>{}</a:lnTo>{}",
        p(x1, h),
        curve((x1 - k, h), (0.0, y2 + k), (0.0, y2)),
        p(0.0, x1),
        curve((0.0, x1 - k), (x1 - k, 0.0), (x1, 0.0))
    );
    let right = format!(
        "<a:moveTo>{}</a:moveTo>{}<a:lnTo>{}</a:lnTo>{}",
        p(x2, 0.0),
        curve((x2 + k, 0.0), (w, x1 - k), (w, x1)),
        p(w, y2),
        curve((w, y2 + k), (x2 + k, h), (x2, h))
    );
    format!("<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l=\"0\" t=\"0\" r=\"r\" b=\"b\"/><a:pathLst><a:path w=\"{}\" h=\"{}\" fill=\"none\">{left}{right}</a:path></a:pathLst></a:custGeom>", w as i64, h as i64)
}

#[cfg(test)]
mod tests {
    use super::*;

    const RUN: &str = r#"<w:p><w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing><wp:anchor relativeHeight="5"><wp:extent cx="551815" cy="238760"/><wp:docPr id="7" name="Double Bracket 2"/><a:graphic><a:graphicData><wps:wsp><wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="551815" cy="238760"/></a:xfrm><a:prstGeom prst="bracketPair"><a:avLst><a:gd name="adj" fmla="val 16667"/></a:avLst></a:prstGeom><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:ln w="28575"><a:solidFill><a:srgbClr val="808080"/></a:solidFill></a:ln></wps:spPr><wps:txbx><w:txbxContent><w:p><w:r><w:t>2</w:t></w:r></w:p></w:txbxContent></wps:txbx><wps:bodyPr/></wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing></mc:Choice><mc:Fallback><w:pict><w:txbxContent><w:p><w:r><w:t>2</w:t></w:r></w:p></w:txbxContent></w:pict></mc:Fallback></mc:AlternateContent></w:r></w:p>"#;

    #[test]
    fn a_double_bracket_becomes_its_box_without_an_outline_and_the_brackets_drawn_over_it() {
        let out = rewrite(RUN).unwrap();
        // The box keeps its text and fill, and has no outline
        let (box_part, brackets) = out.split_once("</mc:AlternateContent></w:r><w:r>").unwrap();
        assert!(box_part.contains("<w:t>2</w:t>") && box_part.contains("FFFFFF") && box_part.contains("<a:ln><a:noFill/></a:ln>") && box_part.contains("bracketPair"));
        // The brackets: the preset's path in the shape's outline, no text, no fill, a drawing of their own on top
        assert!(brackets.contains("<a:custGeom>") && brackets.contains("fill=\"none\"") && brackets.contains("<a:ln w=\"28575\">"));
        assert!(!brackets.contains("<wps:txbx>") && !brackets.contains("FFFFFF") && !brackets.contains("bracketPair"));
        assert!(brackets.contains("wp:docPr id=\"1000007\"") && brackets.contains("relativeHeight=\"6\""));
        // Corners of radius ss × 16667 / 100000 = 39794: the left bracket runs from (39794, bottom) up to (39794, 0)
        assert!(brackets.contains("<a:moveTo><a:pt x=\"39794\" y=\"238760\"/></a:moveTo>"));
        assert!(out.ends_with("</w:p>"));
        assert_eq!(rewrite("<w:p/>"), None);
    }
}

