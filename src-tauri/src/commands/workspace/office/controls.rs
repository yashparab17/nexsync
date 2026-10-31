//! Content controls made in the editor: a form field a person fills in. In the editor's HTML the words of a control are wrapped in markers,
//! `U+E00B spec U+E00C words U+E00D` (the way a character style is, see `styles.rs` and `notes.rs`), and here they become the file's own
//! content control (`w:sdt`) around those words. A file's controls go the other way, as the same markers, so they show in the editor and
//! come back unchanged.
//!
//! An equation is the same kind of range with the spec `eq|latex`, the LaTeX (or linear) text in hex: its words are the equation as plain text,
//! and here they become the file's equation object, which Word lays out as built-up maths.
//!
//! The spec is `kind|title|tag|items|state`: the kind is `rich`, `text`, `check`, `drop`, `combo` or `date`; the title, the tag and each item
//! (the items joined by a comma) are the UTF-8 bytes in hex, so no character of them can be taken for a separator; the state is `1` or `0`
//! for a check box that is ticked or not, and the date (ISO 8601) for a date.

use wordcraft_doc::control::{ContentControl, ControlKind, ListItem};
use wordcraft_doc::{CharProps, Document, InlineObject};

use super::notes::{para_mut, CharRange, Place};

fn hex(t: &str) -> String {
    t.bytes().map(|b| format!("{b:02x}")).collect()
}

fn unhex(h: &str) -> Option<String> {
    if !h.len().is_multiple_of(2) || h.len() > 4000 {
        return None;
    }
    let bytes: Option<Vec<u8>> = (0..h.len()).step_by(2).map(|i| u8::from_str_radix(&h[i..i + 2], 16).ok()).collect();
    String::from_utf8(bytes?).ok().map(|t| t.chars().filter(|c| !c.is_control()).collect())
}

fn items_of(h: &str) -> Vec<ListItem> {
    h.split(',').filter(|x| !x.is_empty()).filter_map(unhex).take(200).map(|display| ListItem { display, value: String::new() }).collect()
}

/// A control as the editor holds it
pub fn spec_of(c: &ContentControl) -> String {
    let (kind, items, state) = match &c.kind {
        ControlKind::Text { .. } => ("text", &[][..], String::new()),
        ControlKind::CheckBox { checked, .. } => ("check", &[][..], if *checked { "1" } else { "0" }.to_string()),
        ControlKind::DropDown { items, .. } => ("drop", items.as_slice(), String::new()),
        ControlKind::ComboBox { items, .. } => ("combo", items.as_slice(), String::new()),
        ControlKind::Date { full_date, .. } => ("date", &[][..], full_date.clone()),
        _ => ("rich", &[][..], String::new()),
    };
    let items = items.iter().map(|i| hex(&i.display)).collect::<Vec<_>>().join(",");
    format!("{kind}|{}|{}|{items}|{state}", hex(&c.title), hex(&c.tag))
}

/// The control a spec describes, or `None` when it is not one
pub fn parse(spec: &str, id: i64) -> Option<ContentControl> {
    let mut it = spec.split('|');
    let kind = it.next()?;
    let title = unhex(it.next().unwrap_or(""))?;
    let tag = unhex(it.next().unwrap_or(""))?;
    let items = items_of(it.next().unwrap_or(""));
    let state = it.next().unwrap_or("");
    let kind = match kind {
        "rich" => ControlKind::RichText,
        "text" => ControlKind::Text { multi_line: false },
        "check" => ControlKind::CheckBox { checked: state == "1", checked_char: '\u{2612}', checked_font: "MS Gothic".into(), unchecked_char: '\u{2610}', unchecked_font: "MS Gothic".into() },
        "drop" => ControlKind::DropDown { items, last_value: String::new() },
        "combo" => ControlKind::ComboBox { items, last_value: String::new() },
        "date" => ControlKind::Date { full_date: state.chars().take(40).collect(), format: "M/d/yyyy".into(), lid: "en-US".into(), calendar: "gregorian".into(), store_as: "dateTime".into() },
        _ => return None,
    };
    let mut c = ContentControl::new(kind);
    c.id = Some(id);
    c.title = title.chars().take(200).collect();
    c.tag = tag.chars().take(200).collect();
    Some(c)
}

/// An equation as the editor holds it: the source text, in hex
pub fn equation_spec(source: &str) -> String {
    format!("eq|{}", hex(source))
}

/// The equation a source stands for: LaTeX when it has a backslash, the linear format otherwise
fn equation_of(source: &str, shown: &str) -> InlineObject {
    let nodes = if source.contains('\\') { wordcraft_doc::math_latex::parse_latex(source) } else { wordcraft_doc::math_linear::parse(source) };
    InlineObject::Equation { linear: shown.to_string(), display: false, math: wordcraft_doc::math::Math { nodes, ..Default::default() } }
}

/// Puts the controls the editor had round their words. `notes` are where note references stood: they were put in the text before this, so
/// each moves the places after it along by one object.
pub fn settle(doc: &mut Document, found: &[CharRange], notes: &[(Place, usize, u32)]) {
    let width = wordcraft_doc::para::OBJ.len_utf8();
    let mut next = (chrono::Utc::now().timestamp_millis() & 0x3fff_ffff) + 1;
    // The last first, so a place earlier in the same paragraph is still where it was
    let mut order: Vec<&CharRange> = found.iter().collect();
    order.sort_by_key(|r| (r.0, r.2));
    // Paragraphs that came with controls of their own (the file's block was kept): left as they are
    let own: Vec<Place> = order.iter().map(|r| r.0).filter(|place| para_mut(doc, place).is_some_and(|p| p.objects.iter().any(|o| matches!(o, InlineObject::ControlStart { .. } | InlineObject::Equation { .. })))).collect();
    for (place, a, b, spec) in order.into_iter().rev() {
        let shift = |at: usize, inclusive: bool| notes.iter().filter(|(p, off, _)| p == place && if inclusive { *off <= at } else { *off < at }).count() * width;
        let Some(p) = para_mut(doc, place) else { continue };
        let (start, end) = (a + shift(*a, false), b + shift(*b, true));
        // An equation: its words are taken out and the equation object put in their place. A block the file's own (kept whole) has its equations.
        if let Some(source) = spec.strip_prefix("eq|").and_then(unhex) {
            let (start, end) = (start.min(p.text.len()), end.min(p.text.len()));
            if own.contains(place) || start > end || !p.text.is_char_boundary(start) || !p.text.is_char_boundary(end) {
                continue;
            }
            let shown = p.text[start..end].to_string();
            let _ = p.delete(start, end);
            let _ = p.insert_object(start, equation_of(&source, &shown), &CharProps::default());
            continue;
        }
        if own.contains(place) {
            continue;
        }
        let (start, end) = (start.min(p.text.len()), end.min(p.text.len()));
        if start >= end || !p.text.is_char_boundary(start) || !p.text.is_char_boundary(end) {
            continue;
        }
        next += 1;
        let Some(control) = parse(spec, next) else { continue };
        let props = CharProps::default();
        if p.insert_object(end, InlineObject::ControlEnd, &props).is_ok() {
            let _ = p.insert_object(start, InlineObject::ControlStart { control: Box::new(control) }, &props);
        }
    }
}
