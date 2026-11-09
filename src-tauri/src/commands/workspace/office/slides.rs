//! Slide decks (Phase 21, step 5): opening and writing .pptx files, drawing a slide as a picture, and the small edits the slide editor
//! makes to a shape, with the model, file reader and renderer of DeckCraft (MIT OR Apache-2.0, pinned by commit, see
//! THIRD_PARTY_NOTICES.md).
//!
//! A deck is kept in the workspace as a shared document in pieces that people can change at the same time: the deck's `base`
//! (slide size, master slides, layouts, theme, media, everything that is not a slide, as one JSON text that rarely changes), the order of
//! the slides, and for each slide its own settings and each of its shapes as a JSON text. Two people moving different shapes both keep
//! their moves. This file turns a .pptx into those pieces and back, draws a slide from them, and makes the edits. Because the pieces are
//! the whole model, notes, transitions, animations, comments and tables survive a round trip even though the editor does not show them
//! yet.
//!
//! The base is sent to this side once and kept (by its hash) so that drawing a slide sends only the slide.

use std::{
    panic::{catch_unwind, AssertUnwindSafe},
    sync::{Arc, Mutex},
};

use base64::prelude::{Engine, BASE64_STANDARD};
use deckcraft_color::Rgba;
use deckcraft_geom::Xfrm;
use deckcraft_model::{
    defaults,
    resolve::{self, Ctx},
    style::{ColorRef, Fill, Line},
    table::Table,
    text::{Paragraph, Run, TextBody},
    Geom, LayoutId, Presentation, SchemeSlot, Shape, ShapeId, ShapeKind, Slide, SlideId,
};
use serde::{Deserialize, Serialize};

use super::documents::check_package;
use crate::commands::{config::validate_allowed_root, path_utils::resolve_workspace_path};

const MAX_FILE_BYTES: u64 = 128 * 1024 * 1024;
const MAX_SLIDES: usize = 1_000;
/// The pieces of a deck come from other people's devices: a base or a slide bigger than this is refused
const MAX_BASE_BYTES: usize = 64 * 1024 * 1024;
const MAX_SLIDE_BYTES: usize = 16 * 1024 * 1024;
/// A picture of a slide is at most this many pixels, whatever size the deck says it is
const MAX_PIXELS: f64 = 40_000_000.0;
const CACHE: usize = 8;

#[derive(Serialize, Clone, Debug, Default)]
pub struct Parts {
    /// The deck without its slides, as JSON
    pub base: String,
    /// Each slide as JSON
    pub slides: Vec<String>,
}

#[derive(Serialize, Clone, Debug, Default)]
pub struct Opened {
    pub parts: Parts,
    /// What the editor does not show of the file (it is kept and written back)
    pub notes: Vec<String>,
}

/// The deck without its slides as JSON. The model keeps the bytes of pictures, sounds and fonts out of its own JSON, so they are written
/// into it here, beside each media item as `dataB64`, and `parse_base` puts them back.
fn base_json(p: &Presentation) -> Result<String, String> {
    let mut base = p.clone();
    base.slides.clear();
    let mut v = serde_json::to_value(&base).map_err(|e| e.to_string())?;
    if let Some(items) = v.get_mut("media").and_then(|m| m.as_array_mut()) {
        for (item, m) in items.iter_mut().zip(&base.media) {
            if !m.data.is_empty() {
                item["dataB64"] = serde_json::Value::String(BASE64_STANDARD.encode(&*m.data));
            }
        }
    }
    serde_json::to_string(&v).map_err(|e| e.to_string())
}

/// The deck from the base text, with the bytes of its media back in place
fn parse_base(base: &str) -> Result<Presentation, String> {
    let mut v: serde_json::Value = serde_json::from_str(base).map_err(|e| format!("The deck could not be read: {e}"))?;
    let data: Vec<Option<Vec<u8>>> = v.get("media").and_then(|m| m.as_array()).map(|items| items.iter().map(|i| i.get("dataB64").and_then(|d| d.as_str()).and_then(|d| BASE64_STANDARD.decode(d).ok())).collect()).unwrap_or_default();
    let mut p: Presentation = serde_json::from_value(v.take()).map_err(|e| format!("The deck could not be read: {e}"))?;
    for (m, bytes) in p.media.iter_mut().zip(data) {
        if let Some(b) = bytes {
            m.data = Arc::new(b);
        }
    }
    p.slides.clear();
    Ok(p)
}

fn split(p: &Presentation) -> Result<Parts, String> {
    Ok(Parts { base: base_json(p)?, slides: p.slides.iter().map(|s| serde_json::to_string(&**s).map_err(|e| e.to_string())).collect::<Result<_, _>>()? })
}

/// The deck from its pieces; two slides with the same id (two people added one at once) get their own
pub fn assemble(base: &str, slides: &[String]) -> Result<Presentation, String> {
    if slides.len() > MAX_SLIDES {
        return Err(format!("A deck has at most {MAX_SLIDES} slides here."));
    }
    if base.len() > MAX_BASE_BYTES || slides.iter().any(|s| s.len() > MAX_SLIDE_BYTES) {
        return Err("The deck is too big.".to_string());
    }
    let mut p = parse_base(base)?;
    let parsed: Vec<Slide> = slides.iter().map(|s| serde_json::from_str(s).map_err(|e| format!("A slide could not be read: {e}"))).collect::<Result<_, _>>()?;
    // Slides made on other devices were given ids from the same base: a new id must clear every id any of them uses
    let used = parsed.iter().flat_map(|s| std::iter::once(s.id.0).chain(s.shapes.iter().map(|x| x.id.0))).max().unwrap_or(0);
    p.next_id = p.next_id.max(used.saturating_add(1));
    for mut slide in parsed {
        if p.slides.iter().any(|o| o.id == slide.id) {
            slide.id = SlideId(p.alloc_id().ok_or("The deck has used every id.")?);
        }
        p.slides.push(Arc::new(slide));
    }
    Ok(p)
}

fn guarded<T>(what: &str, f: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
    catch_unwind(AssertUnwindSafe(f)).map_err(|_| format!("{what} could not be done safely."))?
}

// ────────────────────────────
// Files
// ────────────────────────────

pub fn open(name: &str, bytes: &[u8]) -> Result<Opened, String> {
    if bytes.len() as u64 > MAX_FILE_BYTES {
        return Err("This file is bigger than 128 MB. It was not opened.".to_string());
    }
    let lower = name.to_ascii_lowercase();
    if !(lower.ends_with(".pptx") || lower.ends_with(".pptm") || lower.ends_with(".potx") || lower.ends_with(".ppsx")) {
        return Err("Nexsync opens .pptx decks (and .pptm, .potx, .ppsx).".to_string());
    }
    if deckcraft_pptx::is_encrypted(bytes) {
        return Err("This deck is protected with a password. Remove the password and add it again.".to_string());
    }
    let names = check_package(bytes)?;
    let pres = guarded("The deck could not be read; it", || deckcraft_pptx::import(bytes).map_err(|e| format!("This deck could not be read: {e}")))?;
    if pres.slides.len() > MAX_SLIDES {
        return Err(format!("This deck has {} slides; the editor opens up to {MAX_SLIDES}.", pres.slides.len()));
    }
    let mut notes = Vec::new();
    if names.iter().any(|n| n.ends_with("vbaProject.bin")) {
        notes.push("A macro project. It is never run and is not written back.".to_string());
    }
    let with_anim = pres.slides.iter().filter(|s| !s.animations.is_empty()).count();
    if with_anim > 0 {
        notes.push(format!("{with_anim} slide{} with animations: kept in the file, not shown or edited here yet.", if with_anim == 1 { "" } else { "s" }));
    }
    notes.push("Comments, charts, tables and videos are kept in the file and not edited here yet.".to_string());
    Ok(Opened { parts: split(&pres)?, notes })
}

/// A new deck with a title slide
pub fn blank() -> Result<Opened, String> {
    let p = defaults::blank_presentation(deckcraft_geom::Size::new(960.0, 540.0), deckcraft_model::theme::Theme::default(), true);
    Ok(Opened { parts: split(&p)?, notes: Vec::new() })
}

pub fn export(base: &str, slides: &[String]) -> Result<Vec<u8>, String> {
    let p = assemble(base, slides)?;
    guarded("The file could not be written; it", || deckcraft_pptx::export(&p).map_err(|e| format!("The file could not be written: {e}")))
}

// ────────────────────────────
// Drawing
// ────────────────────────────

static BASES: Mutex<Vec<(String, Arc<Presentation>)>> = Mutex::new(Vec::new());

/// Keeps a deck's base for drawing; returns its id (a hash of the text), the same for the same base
pub fn register(base: &str) -> Result<String, String> {
    if base.len() > MAX_BASE_BYTES {
        return Err("The deck is too big.".to_string());
    }
    let id = blake3::hash(base.as_bytes()).to_hex().to_string();
    let mut all = BASES.lock().unwrap_or_else(|p| p.into_inner());
    if all.iter().any(|(k, _)| *k == id) {
        return Ok(id);
    }
    let p = parse_base(base)?;
    if !(p.slide_size.width.is_finite() && p.slide_size.height.is_finite() && (1.0..=20_000.0).contains(&p.slide_size.width) && (1.0..=20_000.0).contains(&p.slide_size.height)) {
        return Err("The slide size of this deck is not a size Nexsync draws.".to_string());
    }
    all.push((id.clone(), Arc::new(p)));
    if all.len() > CACHE {
        all.remove(0);
    }
    Ok(id)
}

fn base_of(id: &str) -> Result<Arc<Presentation>, String> {
    BASES.lock().unwrap_or_else(|p| p.into_inner()).iter().find(|(k, _)| k == id).map(|(_, p)| p.clone()).ok_or_else(|| "unknown base".to_string())
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Frame {
    pub id: u32,
    pub name: String,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    pub rot: f64,
    /// `shape`, `picture`, `group`, `table`, `chart`, `media` and so on
    pub kind: &'static str,
    pub placeholder: bool,
    /// How the first paragraph's text looks as drawn, for the box typed into
    pub look: Option<Look>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Look {
    pub font: String,
    pub size: f64,
    /// `RRGGBB`
    pub color: String,
    pub bold: bool,
    pub italic: bool,
    pub align: &'static str,
    pub line: f64,
}

fn look_of(ctx: &Ctx, s: &Shape) -> Option<Look> {
    use deckcraft_model::text::{Align, Spacing};
    let t = s.text.as_ref()?;
    let para = t.paragraphs.iter().find(|p| !p.runs.is_empty()).or(t.paragraphs.first())?;
    let run = resolve::run(ctx, s, para, &para.runs.first().map(|r| r.props.clone()).unwrap_or_default());
    let pp = resolve::para(ctx, s, para);
    Some(Look {
        font: resolve::font_family(ctx, &run),
        size: run.size.unwrap_or(18.0),
        color: resolve::text_color(ctx, &run).hex().trim_start_matches('#').chars().take(6).collect(),
        bold: run.bold.unwrap_or(false),
        italic: run.italic.unwrap_or(false),
        align: match pp.align { Some(Align::Center) => "center", Some(Align::Right) => "right", Some(Align::Justify) => "justify", _ => "left" },
        line: match pp.line_spacing { Some(Spacing::Pct(p)) => p, _ => 1.0 },
    })
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Rendered {
    /// PNG, base64
    pub png: String,
    pub width_pt: f64,
    pub height_pt: f64,
    pub frames: Vec<Frame>,
}

fn kind_name(k: &ShapeKind) -> &'static str {
    match k {
        ShapeKind::Shape => "shape",
        ShapeKind::Picture { .. } => "picture",
        ShapeKind::Group { .. } => "group",
        ShapeKind::Connector { .. } => "connector",
        ShapeKind::Table(_) => "table",
        ShapeKind::Chart(_) => "chart",
        ShapeKind::Media(_) => "media",
        _ => "other",
    }
}

/// A slide drawn at `scale` pixels per point, with the box of each of its shapes
pub fn render(base_id: &str, slide_json: &str, scale: f64) -> Result<Rendered, String> {
    let base = base_of(base_id)?;
    if slide_json.len() > MAX_SLIDE_BYTES {
        return Err("The slide is too big.".to_string());
    }
    if base.slide_size.width * scale * base.slide_size.height * scale > MAX_PIXELS {
        return Err("The slide would be drawn too large.".to_string());
    }
    let slide: Slide = serde_json::from_str(slide_json).map_err(|e| format!("The slide could not be read: {e}"))?;
    if !(0.05..=8.0).contains(&scale) {
        return Err("That size is not available.".to_string());
    }
    let mut p = (*base).clone();
    p.slides = vec![Arc::new(slide)];
    guarded("The slide could not be drawn; it", || {
        let img = deckcraft_render::render_slide(&p, 0, &deckcraft_render::RenderOpts { scale, ..Default::default() });
        let png = BASE64_STANDARD.encode(img.to_png());
        let frames = match Ctx::for_slide(&p, &p.slides[0]) {
            Some(ctx) => p.slides[0]
                .shapes
                .iter()
                .filter(|s| !s.hidden)
                .map(|s| {
                    let x = resolve::xfrm(&ctx, s);
                    Frame { id: s.id.0, name: s.name.clone(), x: x.x, y: x.y, w: x.w, h: x.h, rot: x.rot, kind: kind_name(&s.kind), placeholder: s.ph.is_some(), look: look_of(&ctx, s) }
                })
                .collect(),
            None => Vec::new(),
        };
        Ok(Rendered { png, width_pt: p.slide_size.width, height_pt: p.slide_size.height, frames })
    })
}

// ────────────────────────────
// Edits
// ────────────────────────────

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Layout {
    pub id: u32,
    pub name: String,
}

pub fn layouts(base_id: &str) -> Result<Vec<Layout>, String> {
    let base = base_of(base_id)?;
    Ok(base.masters.iter().flat_map(|m| m.layouts.iter().map(|l| Layout { id: l.id.0, name: l.name.clone() })).collect())
}

/// A new slide on a layout, its placeholders in place and empty
pub fn new_slide(base_id: &str, layout: u32) -> Result<String, String> {
    let mut p = (*base_of(base_id)?).clone();
    if p.layout(LayoutId(layout)).is_none() {
        return Err("That layout is not in the deck.".to_string());
    }
    let slide = defaults::new_slide(&mut p, LayoutId(layout)).ok_or("The deck has used every id.")?;
    serde_json::to_string(&slide).map_err(|e| e.to_string())
}

/// A shape to put on a slide. `kind` is `textBox` or a preset name (`rect`, `roundRect`, `ellipse`, `triangle`, `rightArrow`).
pub fn new_shape(kind: &str, id: u32, x: f64, y: f64, w: f64, h: f64) -> Result<String, String> {
    const PRESETS: &[&str] = &["rect", "roundRect", "ellipse", "triangle", "rightArrow", "star5", "diamond", "hexagon", "cloud"];
    let text_box = kind == "textBox";
    if !text_box && !PRESETS.contains(&kind) {
        return Err("That shape is not one Nexsync adds yet.".to_string());
    }
    let xfrm = Xfrm { x, y, w: w.max(8.0), h: h.max(8.0), ..Default::default() };
    let shape = if text_box {
        Shape { id: ShapeId(id), name: format!("TextBox {id}"), xfrm: Some(xfrm), text_box: true, text: Some(TextBody::from_text("Text")), ..Default::default() }
    } else {
        Shape {
            id: ShapeId(id),
            name: format!("{kind} {id}"),
            xfrm: Some(xfrm),
            geom: Geom::Preset { name: kind.to_string(), adj: vec![] },
            fill: Some(Fill::solid(ColorRef::scheme(SchemeSlot::Accent1))),
            line: Some(Line::none()),
            text: Some(TextBody::default()),
            ..Default::default()
        }
    };
    serde_json::to_string(&shape).map_err(|e| e.to_string())
}

#[derive(Deserialize, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ShapeEdit {
    /// All of the shape's text, paragraphs separated by line breaks; the look of the first paragraph and run is kept
    pub text: Option<String>,
    /// `RRGGBB`, or an empty string for no fill
    pub fill: Option<String>,
    pub bold: Option<bool>,
    pub italic: Option<bool>,
    pub size: Option<f64>,
    /// `RRGGBB`
    pub color: Option<String>,
    pub x: Option<f64>,
    pub y: Option<f64>,
    pub w: Option<f64>,
    pub h: Option<f64>,
    pub rot: Option<f64>,
    pub underline: Option<bool>,
    /// A font family name
    pub font: Option<String>,
    /// `left`, `center`, `right` or `justify`, for every paragraph
    pub align: Option<String>,
    /// The outline: `RRGGBB`, or an empty string for none
    pub line: Option<String>,
    /// The outline's width in points
    pub line_width: Option<f64>,
    /// The characters (start, end) of the text that the look edits apply to; none means all of it. Paragraph edits (bullets, spacing)
    /// apply to the paragraphs the range touches.
    pub range: Option<[usize; 2]>,
    /// `none`, `dot`, `dash`, `num`, `alpha` or `roman`
    pub bullet: Option<String>,
    /// Line spacing as a multiple of the text's height (1.0 is single)
    pub line_spacing: Option<f64>,
    /// Space before and after a paragraph, in points
    pub space_before: Option<f64>,
    pub space_after: Option<f64>,
    /// Moves the paragraphs in (+1) or out (-1) a level
    pub level: Option<i8>,
}

/// Sets the text of a body, keeping the look of the characters around the change and each paragraph's own settings; a body with
/// fields or breaks in it takes the look of its first paragraph and run instead
fn set_text(body: &mut TextBody, new: &str) {
    use deckcraft_model::text::{RunKind, RunProps};
    let plain = body.paragraphs.iter().all(|p| p.runs.iter().all(|r| matches!(r.kind, RunKind::Text)));
    let mut old: Vec<(char, RunProps)> = Vec::new();
    for (i, p) in body.paragraphs.iter().enumerate() {
        if !plain {
            break;
        }
        for r in &p.runs {
            old.extend(r.text.chars().map(|c| (c, r.props.clone())));
        }
        if i + 1 < body.paragraphs.len() {
            old.push(('\n', p.end_props.clone()));
        }
    }
    if !plain {
        let first = body.paragraphs.first();
        let (para, run) = first.map(|p| (p.props.clone(), p.runs.first().map(|r| r.props.clone()).unwrap_or_default())).unwrap_or_default();
        let level = first.map_or(0, |p| p.level);
        body.paragraphs = new
            .split('\n')
            .map(|line| {
                let mut p = Paragraph::new("");
                p.level = level;
                p.props = para.clone();
                if !line.is_empty() {
                    p.runs = vec![Run { text: line.to_string(), props: run.clone(), kind: RunKind::Text }];
                }
                p
            })
            .collect();
        return;
    }
    let new: Vec<char> = new.chars().collect();
    let pre = old.iter().zip(&new).take_while(|(a, b)| a.0 == **b).count();
    let suf = old.iter().rev().zip(new.iter().rev()).take_while(|(a, b)| a.0 == **b).count().min(old.len() - pre).min(new.len() - pre);
    let ins = if pre > 0 { old[pre - 1].1.clone() } else { old.first().map(|o| o.1.clone()).unwrap_or_default() };
    let mut chars: Vec<(char, RunProps)> = old[..pre].to_vec();
    chars.extend(new[pre..new.len() - suf].iter().map(|c| (*c, ins.clone())));
    chars.extend_from_slice(&old[old.len() - suf..]);
    let head = old[..pre].iter().filter(|o| o.0 == '\n').count();
    let tail = old[old.len() - suf..].iter().filter(|o| o.0 == '\n').count();
    let (was, now) = (body.paragraphs.len(), chars.iter().filter(|o| o.0 == '\n').count() + 1);
    let from_old = |j: usize| -> Paragraph {
        let at = if j <= head { j } else if j + tail >= now { was.saturating_sub(now - j) } else { head };
        let mut p = body.paragraphs.get(at.min(was.saturating_sub(1))).cloned().unwrap_or_default();
        p.runs.clear();
        p
    };
    let mut out = Vec::with_capacity(now);
    for (j, line) in chars.split(|o| o.0 == '\n').enumerate() {
        let mut p = from_old(j);
        for (c, props) in line {
            match p.runs.last_mut() {
                Some(r) if r.props == *props => r.text.push(*c),
                _ => p.runs.push(Run { text: c.to_string(), props: props.clone(), kind: RunKind::Text }),
            }
        }
        out.push(p);
    }
    body.paragraphs = out;
}

/// Splits runs so the characters from..to (counting a paragraph break as one) are runs of their own, and applies `f` to those
fn format_range(t: &mut TextBody, from: usize, to: usize, f: &dyn Fn(&mut deckcraft_model::text::RunProps)) {
    let mut pos = 0;
    for p in &mut t.paragraphs {
        let len: usize = p.runs.iter().map(|r| r.text.chars().count()).sum();
        if from < pos + len && to > pos {
            let (a, b) = (from.saturating_sub(pos), to.saturating_sub(pos));
            let mut at = 0;
            let mut runs = Vec::with_capacity(p.runs.len() + 2);
            for r in std::mem::take(&mut p.runs) {
                let n = r.text.chars().count();
                let (lo, hi) = (a.clamp(at, at + n) - at, b.clamp(at, at + n) - at);
                at += n;
                if lo >= hi {
                    runs.push(r);
                    continue;
                }
                let cut = |i: usize| r.text.char_indices().nth(i).map_or(r.text.len(), |(b, _)| b);
                let (x, y) = (cut(lo), cut(hi));
                for (s, hit) in [(&r.text[..x], false), (&r.text[x..y], true), (&r.text[y..], false)] {
                    if s.is_empty() {
                        continue;
                    }
                    let mut piece = Run { text: s.to_string(), props: r.props.clone(), kind: r.kind.clone() };
                    if hit {
                        f(&mut piece.props);
                    }
                    runs.push(piece);
                }
            }
            p.runs = runs;
        }
        pos += len + 1;
    }
}

pub fn edit_shape(shape_json: &str, edit: &ShapeEdit) -> Result<String, String> {
    let mut s: Shape = serde_json::from_str(shape_json).map_err(|e| format!("The shape could not be read: {e}"))?;
    if let Some(text) = &edit.text {
        if text.len() > 200_000 {
            return Err("That is too much text for a shape.".to_string());
        }
        set_text(s.text.get_or_insert_with(Default::default), text);
    }
    if let Some(hex) = &edit.fill {
        s.fill = Some(if hex.is_empty() { Fill::None } else { Fill::solid(ColorRef::rgb(Rgba::from_hex(hex).ok_or("That is not a colour.")?)) });
    }
    if let Some(hex) = &edit.line {
        let width = edit.line_width.unwrap_or(1.5).clamp(0.0, 100.0);
        s.line = Some(if hex.is_empty() { Line::none() } else { Line::solid(ColorRef::rgb(Rgba::from_hex(hex).ok_or("That is not a colour.")?), width) });
    } else if let (Some(w), Some(line)) = (edit.line_width, s.line.as_mut()) {
        line.width = Some(w.clamp(0.0, 100.0));
    }
    if let (Some(a), Some(t)) = (&edit.align, s.text.as_mut()) {
        use deckcraft_model::text::Align;
        let align = match a.as_str() {
            "left" => Align::Left,
            "center" => Align::Center,
            "right" => Align::Right,
            "justify" => Align::Justify,
            _ => return Err("That alignment is not offered.".to_string()),
        };
        for p in &mut t.paragraphs {
            p.props.align = Some(align);
        }
    }
    if edit.bold.is_some() || edit.italic.is_some() || edit.size.is_some() || edit.color.is_some() || edit.underline.is_some() || edit.font.is_some() {
        let color = edit.color.as_deref().map(|c| Rgba::from_hex(c).ok_or("That is not a colour.")).transpose()?;
        let apply = |r: &mut deckcraft_model::text::RunProps| {
            if let Some(b) = edit.bold {
                r.bold = Some(b);
            }
            if let Some(i) = edit.italic {
                r.italic = Some(i);
            }
            if let Some(z) = edit.size {
                r.size = Some(z.clamp(1.0, 400.0));
            }
            if let Some(c) = color {
                r.fill = Some(Fill::solid(ColorRef::rgb(c)));
            }
            if let Some(u) = edit.underline {
                r.underline = Some(if u { "sng" } else { "none" }.to_string());
            }
            if let Some(f) = edit.font.as_deref().filter(|f| !f.is_empty() && f.len() < 64) {
                r.font = Some(f.to_string());
            }
        };
        if let Some(t) = s.text.as_mut() {
            match edit.range {
                Some([from, to]) if from < to => format_range(t, from, to, &apply),
                _ => {
                    for p in &mut t.paragraphs {
                        p.runs.iter_mut().for_each(|r| apply(&mut r.props));
                        apply(&mut p.end_props);
                    }
                }
            }
        }
    }
    if edit.bullet.is_some() || edit.line_spacing.is_some() || edit.space_before.is_some() || edit.space_after.is_some() || edit.level.is_some() {
        use deckcraft_model::text::{Bullet, Spacing};
        let bullet = match edit.bullet.as_deref() {
            None => None,
            Some("none") => Some(Bullet::None),
            Some("dot") => Some(Bullet::Char { char: "\u{2022}".to_string() }),
            Some("dash") => Some(Bullet::Char { char: "\u{2013}".to_string() }),
            Some("num") => Some(Bullet::AutoNum { scheme: "arabicPeriod".to_string(), start_at: 1 }),
            Some("alpha") => Some(Bullet::AutoNum { scheme: "alphaLcPeriod".to_string(), start_at: 1 }),
            Some("roman") => Some(Bullet::AutoNum { scheme: "romanLcPeriod".to_string(), start_at: 1 }),
            Some(_) => return Err("That bullet is not offered.".to_string()),
        };
        if let Some(t) = s.text.as_mut() {
            let [from, to] = edit.range.unwrap_or([0, usize::MAX]);
            let mut pos = 0;
            for p in &mut t.paragraphs {
                let len: usize = p.runs.iter().map(|r| r.text.chars().count()).sum();
                // A caret (from == to) is in the paragraph that holds it
                if pos <= to && from <= pos + len {
                    if let Some(b) = &bullet {
                        let on = !matches!(b, Bullet::None);
                        p.props.bullet = Some(b.clone());
                        p.props.margin_left = Some(if on { 27.0 + 27.0 * f64::from(p.level) } else { 0.0 });
                        p.props.indent = Some(if on { -27.0 } else { 0.0 });
                    }
                    if let Some(l) = edit.line_spacing {
                        p.props.line_spacing = Some(Spacing::Pct(l.clamp(0.1, 10.0)));
                    }
                    if let Some(v) = edit.space_before {
                        p.props.space_before = Some(Spacing::Pts(v.clamp(0.0, 1000.0)));
                    }
                    if let Some(v) = edit.space_after {
                        p.props.space_after = Some(Spacing::Pts(v.clamp(0.0, 1000.0)));
                    }
                    if let Some(d) = edit.level {
                        p.level = (i16::from(p.level) + i16::from(d)).clamp(0, 8) as u8;
                    }
                }
                pos += len + 1;
            }
        }
    }
    if edit.x.is_some() || edit.y.is_some() || edit.w.is_some() || edit.h.is_some() || edit.rot.is_some() {
        let mut x = s.xfrm.unwrap_or_default();
        x.x = edit.x.unwrap_or(x.x);
        x.y = edit.y.unwrap_or(x.y);
        x.w = edit.w.unwrap_or(x.w).max(4.0);
        x.h = edit.h.unwrap_or(x.h).max(4.0);
        x.rot = edit.rot.unwrap_or(x.rot);
        s.xfrm = Some(x);
    }
    serde_json::to_string(&s).map_err(|e| e.to_string())
}

#[derive(Deserialize, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SlideEdit {
    /// The speaker notes, paragraphs separated by line breaks
    pub notes: Option<String>,
    /// A transition's id (`fade`, `push`, `wipe`...), or `none`
    pub transition: Option<String>,
    pub hidden: Option<bool>,
    /// The background: `RRGGBB`, or an empty string to follow the layout
    pub background: Option<String>,
    /// Seconds after which the slide moves on by itself; 0 or less for never
    pub advance_after: Option<f64>,
    pub advance_on_click: Option<bool>,
    /// How long the transition takes, in seconds
    pub duration: Option<f64>,
}

const TRANSITIONS_OFFERED: &[&str] = &["none", "fade", "push", "wipe", "split", "reveal", "cut", "uncover", "cover", "flash", "dissolve", "checker", "blinds", "clock", "zoom", "randomBar"];

/// The settings of a slide that are not its shapes
pub fn edit_slide(slide_json: &str, edit: &SlideEdit) -> Result<String, String> {
    let mut s: Slide = serde_json::from_str(slide_json).map_err(|e| format!("The slide could not be read: {e}"))?;
    if let Some(n) = &edit.notes {
        if n.len() > 200_000 {
            return Err("That is too much for notes.".to_string());
        }
        s.notes = TextBody::from_text(n);
    }
    if edit.transition.is_some() || edit.advance_after.is_some() || edit.advance_on_click.is_some() || edit.duration.is_some() {
        if let Some(t) = &edit.transition {
            if !TRANSITIONS_OFFERED.contains(&t.as_str()) {
                return Err("That transition is not offered.".to_string());
            }
        }
        let mut tr = s.transition.take().unwrap_or(deckcraft_model::anim::Transition { duration_ms: 700, ..Default::default() });
        if let Some(t) = &edit.transition {
            tr.kind = t.clone();
            tr.option.clear();
        }
        if let Some(a) = edit.advance_after {
            tr.advance_after_ms = if a > 0.0 { Some((a.min(86_400.0) * 1000.0) as u32) } else { None };
        }
        if let Some(c) = edit.advance_on_click {
            tr.advance_on_click = c;
        }
        if let Some(d) = edit.duration {
            tr.duration_ms = (d.clamp(0.1, 60.0) * 1000.0) as u32;
        }
        // A slide with nothing special about how it is left has no transition at all
        s.transition = if tr.kind == "none" && tr.advance_after_ms.is_none() && tr.advance_on_click && tr.sound.is_none() && !tr.stop_sound { None } else { Some(tr) };
    }
    if let Some(h) = edit.hidden {
        s.hidden = h;
    }
    if let Some(hex) = &edit.background {
        s.background = if hex.is_empty() { None } else { Some(deckcraft_model::Background::Fill { fill: Fill::solid(ColorRef::rgb(Rgba::from_hex(hex).ok_or("That is not a colour.")?)) }) };
    }
    serde_json::to_string(&s).map_err(|e| e.to_string())
}

/// A table to put on a slide, `rows` by `cols`
pub fn new_table(id: u32, rows: usize, cols: usize, x: f64, y: f64, w: f64, h: f64) -> Result<String, String> {
    if !(1..=30).contains(&rows) || !(1..=20).contains(&cols) {
        return Err("A table has 1 to 30 rows and 1 to 20 columns.".to_string());
    }
    let (w, h) = (w.max(40.0), h.max(20.0));
    let shape = Shape {
        id: ShapeId(id),
        name: format!("Table {id}"),
        xfrm: Some(Xfrm { x, y, w, h, ..Default::default() }),
        kind: ShapeKind::Table(Table::new(rows, cols, w, h / rows as f64)),
        ..Default::default()
    };
    serde_json::to_string(&shape).map_err(|e| e.to_string())
}

#[derive(Deserialize, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TableEdit {
    /// A row or column is added before (or removed at) this number
    pub insert_row: Option<usize>,
    pub delete_row: Option<usize>,
    pub insert_col: Option<usize>,
    pub delete_col: Option<usize>,
    /// The text of every cell, row by row; only the cells that differ are changed
    pub cells: Option<Vec<Vec<String>>>,
    /// The first row is a header; rows are banded
    pub header: Option<bool>,
    pub banded: Option<bool>,
}

pub fn edit_table(shape_json: &str, edit: &TableEdit) -> Result<String, String> {
    let mut s: Shape = serde_json::from_str(shape_json).map_err(|e| format!("The shape could not be read: {e}"))?;
    let ShapeKind::Table(t) = &mut s.kind else { return Err("That is not a table.".to_string()) };
    if let Some(at) = edit.insert_row {
        if t.n_rows() >= 30 {
            return Err("A table has at most 30 rows.".to_string());
        }
        t.insert_row(at);
    }
    if let Some(at) = edit.insert_col {
        if t.n_cols() >= 20 {
            return Err("A table has at most 20 columns.".to_string());
        }
        t.insert_col(at);
    }
    if let Some(at) = edit.delete_row {
        if !t.delete_row(at) {
            return Err("A table keeps at least one row.".to_string());
        }
    }
    if let Some(at) = edit.delete_col {
        if !t.delete_col(at) {
            return Err("A table keeps at least one column.".to_string());
        }
    }
    if let Some(grid) = &edit.cells {
        for (r, row) in grid.iter().enumerate() {
            for (c, text) in row.iter().enumerate() {
                if text.len() > 50_000 {
                    return Err("That is too much text for a cell.".to_string());
                }
                if let Some(cell) = t.cell_mut(r, c).filter(|cell| cell.text.text() != *text) {
                    set_text(&mut cell.text, text);
                }
            }
        }
    }
    if let Some(h) = edit.header {
        t.first_row = h;
    }
    if let Some(b) = edit.banded {
        t.band_row = b;
    }
    let (w, h) = (t.width(), t.height());
    let x = s.xfrm.get_or_insert_with(Default::default);
    x.w = w;
    x.h = h;
    serde_json::to_string(&s).map_err(|e| e.to_string())
}

/// The shapes joined into one group that is as big as they are together
pub fn group(shapes: &[String], id: u32) -> Result<String, String> {
    let kids: Vec<Shape> = shapes.iter().map(|j| serde_json::from_str(j).map_err(|e| format!("A shape could not be read: {e}"))).collect::<Result<_, _>>()?;
    if kids.len() < 2 {
        return Err("Choose two or more shapes to group.".to_string());
    }
    let mut bounds: Option<(f64, f64, f64, f64)> = None;
    for k in &kids {
        let Some(x) = k.xfrm else { return Err("Move the placeholder before grouping it.".to_string()) };
        let (l, t, r, b) = (x.x, x.y, x.x + x.w, x.y + x.h);
        bounds = Some(bounds.map_or((l, t, r, b), |(a, c, d, e)| (a.min(l), c.min(t), d.max(r), e.max(b))));
    }
    let (l, t, r, b) = bounds.unwrap_or_default();
    let frame = Xfrm { x: l, y: t, w: r - l, h: b - t, ..Default::default() };
    let g = Shape { id: ShapeId(id), name: format!("Group {id}"), xfrm: Some(frame), kind: ShapeKind::Group { children: kids, child: frame }, ..Default::default() };
    serde_json::to_string(&g).map_err(|e| e.to_string())
}

/// The shapes of a group, put where they are on the slide
pub fn ungroup(shape_json: &str) -> Result<Vec<String>, String> {
    let g: Shape = serde_json::from_str(shape_json).map_err(|e| format!("The shape could not be read: {e}"))?;
    let (ShapeKind::Group { children, child }, Some(frame)) = (&g.kind, g.xfrm) else { return Err("That is not a group.".to_string()) };
    let (sx, sy) = (if child.w > 0.0 { frame.w / child.w } else { 1.0 }, if child.h > 0.0 { frame.h / child.h } else { 1.0 });
    children
        .iter()
        .map(|k| {
            let mut k = k.clone();
            if let Some(x) = k.xfrm.as_mut() {
                x.x = frame.x + (x.x - child.x) * sx;
                x.y = frame.y + (x.y - child.y) * sy;
                x.w *= sx;
                x.h *= sy;
            }
            serde_json::to_string(&k).map_err(|e| e.to_string())
        })
        .collect()
}

/// A slide moved to another layout: its placeholders follow the new layout, and the new layout's placeholders it did not have are added
/// (empty, with ids from `first_id` up)
pub fn apply_layout(base_id: &str, slide_json: &str, layout: u32, first_id: u32) -> Result<String, String> {
    let mut p = (*base_of(base_id)?).clone();
    if p.layout(LayoutId(layout)).is_none() {
        return Err("That layout is not in the deck.".to_string());
    }
    let mut slide: Slide = serde_json::from_str(slide_json).map_err(|e| format!("The slide could not be read: {e}"))?;
    let fresh = defaults::new_slide(&mut p, LayoutId(layout)).ok_or("The deck has used every id.")?;
    let same = |a: &Shape, b: &Shape| matches!((&a.ph, &b.ph), (Some(x), Some(y)) if x.kind == y.kind && x.idx == y.idx);
    for mut s in fresh.shapes {
        if let Some(mine) = slide.shapes.iter_mut().find(|m| same(m, &s)) {
            mine.xfrm = None;
        } else {
            s.id = ShapeId(first_id + slide.shapes.len() as u32);
            slide.shapes.push(s);
        }
    }
    slide.layout = LayoutId(layout);
    serde_json::to_string(&slide).map_err(|e| e.to_string())
}

/// Replaces `find` with `with` in a shape's text and table cells, in runs (a match across two looks is not found); returns the shape and
/// how many were replaced. `first` stops after one.
pub fn replace_text(shape_json: &str, find: &str, with: &str, match_case: bool, first: bool) -> Result<(String, usize), String> {
    let mut s: Shape = serde_json::from_str(shape_json).map_err(|e| format!("The shape could not be read: {e}"))?;
    let mut left = if first { 1 } else { usize::MAX };
    let mut done = 0;
    let mut body = |t: &mut TextBody| {
        for r in t.paragraphs.iter_mut().flat_map(|p| p.runs.iter_mut()) {
            let (text, n) = replace_in(&r.text, find, with, match_case, left);
            if n > 0 {
                r.text = text;
                left = left.saturating_sub(n);
                done += n;
            }
        }
    };
    if let Some(t) = s.text.as_mut() {
        body(t);
    }
    if let ShapeKind::Table(t) = &mut s.kind {
        t.rows.iter_mut().flat_map(|r| r.cells.iter_mut()).for_each(|c| body(&mut c.text));
    }
    Ok((serde_json::to_string(&s).map_err(|e| e.to_string())?, done))
}

fn replace_in(s: &str, find: &str, with: &str, match_case: bool, mut limit: usize) -> (String, usize) {
    let f: Vec<char> = find.chars().collect();
    let c: Vec<char> = s.chars().collect();
    if f.is_empty() {
        return (s.to_string(), 0);
    }
    let same = |a: char, b: char| a == b || (!match_case && a.to_lowercase().eq(b.to_lowercase()));
    let (mut out, mut i, mut n) = (String::new(), 0, 0);
    while i < c.len() {
        if limit > 0 && i + f.len() <= c.len() && (0..f.len()).all(|k| same(c[i + k], f[k])) {
            out.push_str(with);
            i += f.len();
            n += 1;
            limit -= 1;
        } else {
            out.push(c[i]);
            i += 1;
        }
    }
    (out, n)
}


const MAX_PICTURE_BYTES: usize = 20 * 1024 * 1024;

/// Puts a picture into the deck: the new base (which now holds the picture) and a picture shape for a slide
#[allow(clippy::too_many_arguments)]
pub fn add_picture(base: &str, name: &str, data_b64: &str, id: u32, x: f64, y: f64, w: f64, h: f64) -> Result<(String, String), String> {
    if data_b64.len() > MAX_PICTURE_BYTES * 4 / 3 + 8 {
        return Err("That picture is bigger than 20 MB.".to_string());
    }
    let bytes = BASE64_STANDARD.decode(data_b64).map_err(|_| "That is not a picture Nexsync can read.".to_string())?;
    let kind = if bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
        "image/png"
    } else if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        "image/jpeg"
    } else if bytes.starts_with(b"GIF8") {
        "image/gif"
    } else {
        return Err("Add a PNG, JPEG or GIF picture.".to_string());
    };
    let mut p = parse_base(base)?;
    let file = name.rsplit(['/', char::from(92)]).next().unwrap_or("picture").chars().filter(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_')).take(60).collect::<String>();
    let media = p.add_media(if file.is_empty() { "picture" } else { &file }, kind, bytes).ok_or("The deck has used every id.")?;
    let shape = Shape {
        id: ShapeId(id),
        name: format!("Picture {id}"),
        xfrm: Some(Xfrm { x, y, w: w.max(8.0), h: h.max(8.0), ..Default::default() }),
        kind: ShapeKind::Picture { fill: deckcraft_model::style::PictureFill { media, ..Default::default() } },
        ..Default::default()
    };
    Ok((base_json(&p)?, serde_json::to_string(&shape).map_err(|e| e.to_string())?))
}

/// The text of a shape, paragraphs separated by line breaks
pub fn text_of(shape_json: &str) -> Result<String, String> {
    let s: Shape = serde_json::from_str(shape_json).map_err(|e| e.to_string())?;
    Ok(s.text.map(|t| t.text()).unwrap_or_default())
}

// ────────────────────────────
// Commands
// ────────────────────────────

#[tauri::command]
pub async fn deck_new() -> Result<Opened, String> {
    tokio::task::spawn_blocking(blank).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn deck_open(app_handle: tauri::AppHandle, path: String, rel: String) -> Result<Opened, String> {
    validate_allowed_root(&app_handle, &path)?;
    let file = resolve_workspace_path(&path, rel.trim_start_matches('/'))?;
    let meta = std::fs::metadata(&file).map_err(|_| "That file is gone.".to_string())?;
    if !meta.is_file() || meta.len() > MAX_FILE_BYTES {
        return Err("That file is not one Nexsync can open as a deck.".to_string());
    }
    let name = rel.clone();
    tokio::task::spawn_blocking(move || open(&name, &std::fs::read(&file).map_err(|e| e.to_string())?)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn deck_register(base: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || register(&base)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn deck_render(base_id: String, slide: String, scale: f64) -> Result<Rendered, String> {
    tokio::task::spawn_blocking(move || render(&base_id, &slide, scale)).await.map_err(|e| e.to_string())?
}

#[tauri::command(async)]
pub fn deck_layouts(base_id: String) -> Result<Vec<Layout>, String> {
    layouts(&base_id)
}

#[tauri::command(async)]
pub fn deck_new_slide(base_id: String, layout: u32) -> Result<String, String> {
    new_slide(&base_id, layout)
}

#[tauri::command(async)]
pub fn deck_new_shape(kind: String, id: u32, x: f64, y: f64, w: f64, h: f64) -> Result<String, String> {
    new_shape(&kind, id, x, y, w, h)
}

#[tauri::command(async)]
pub fn deck_edit_shape(shape: String, edit: ShapeEdit) -> Result<String, String> {
    edit_shape(&shape, &edit)
}

#[tauri::command(async)]
pub fn deck_edit_slide(slide: String, edit: SlideEdit) -> Result<String, String> {
    edit_slide(&slide, &edit)
}

/// A picture for the deck: the new base that holds it, and the picture shape
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn deck_add_picture(base: String, name: String, data: String, id: u32, x: f64, y: f64, w: f64, h: f64) -> Result<(String, String), String> {
    tokio::task::spawn_blocking(move || add_picture(&base, &name, &data, id, x, y, w, h)).await.map_err(|e| e.to_string())?
}

#[tauri::command(async)]
#[allow(clippy::too_many_arguments)]
pub fn deck_new_table(id: u32, rows: usize, cols: usize, x: f64, y: f64, w: f64, h: f64) -> Result<String, String> {
    new_table(id, rows, cols, x, y, w, h)
}

#[tauri::command(async)]
pub fn deck_edit_table(shape: String, edit: TableEdit) -> Result<String, String> {
    edit_table(&shape, &edit)
}

#[tauri::command(async)]
pub fn deck_group(shapes: Vec<String>, id: u32) -> Result<String, String> {
    group(&shapes, id)
}

#[tauri::command(async)]
pub fn deck_ungroup(shape: String) -> Result<Vec<String>, String> {
    ungroup(&shape)
}

#[tauri::command(async)]
pub fn deck_apply_layout(base_id: String, slide: String, layout: u32, first_id: u32) -> Result<String, String> {
    apply_layout(&base_id, &slide, layout, first_id)
}

#[tauri::command(async)]
pub fn deck_replace(shape: String, find: String, with: String, match_case: bool, first: bool) -> Result<(String, usize), String> {
    replace_text(&shape, &find, &with, match_case, first)
}

#[tauri::command(async)]
pub fn deck_text_of(shape: String) -> Result<String, String> {
    text_of(&shape)
}

/// Writes the deck as the .pptx file `dest` names
#[tauri::command]
pub async fn deck_save(app_handle: tauri::AppHandle, path: String, dest: String, base: String, slides: Vec<String>) -> Result<usize, String> {
    validate_allowed_root(&app_handle, &path)?;
    let dest = crate::commands::workspace::export::check_destination(&path, &dest, &["pptx"])?;
    let bytes = tokio::task::spawn_blocking(move || export(&base, &slides)).await.map_err(|e| e.to_string())??;
    super::keep_versions(&path, &dest, true, &[]);
    std::fs::write(&dest, &bytes).map_err(|e| format!("Could not save the file: {e}"))?;
    super::keep_versions(&path, &dest, false, &bytes);
    Ok(bytes.len())
}

#[cfg(test)]
mod tests;
