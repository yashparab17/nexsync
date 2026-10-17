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
    text::{Paragraph, Run, TextBody},
    Geom, LayoutId, Presentation, SchemeSlot, Shape, ShapeId, ShapeKind, Slide, SlideId,
};
use serde::{Deserialize, Serialize};

use super::office::check_package;
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
                    Frame { id: s.id.0, name: s.name.clone(), x: x.x, y: x.y, w: x.w, h: x.h, rot: x.rot, kind: kind_name(&s.kind), placeholder: s.ph.is_some() }
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
}

pub fn edit_shape(shape_json: &str, edit: &ShapeEdit) -> Result<String, String> {
    let mut s: Shape = serde_json::from_str(shape_json).map_err(|e| format!("The shape could not be read: {e}"))?;
    if let Some(text) = &edit.text {
        if text.len() > 200_000 {
            return Err("That is too much text for a shape.".to_string());
        }
        let first = s.text.as_ref().and_then(|t| t.paragraphs.first());
        let (para, run) = first.map(|p| (p.props.clone(), p.runs.first().map(|r| r.props.clone()).unwrap_or_default())).unwrap_or_default();
        let level = first.map_or(0, |p| p.level);
        let body = s.text.take().unwrap_or_default();
        s.text = Some(TextBody {
            paragraphs: text
                .split('\n')
                .map(|line| {
                    let mut p = Paragraph::new("");
                    p.level = level;
                    p.props = para.clone();
                    if !line.is_empty() {
                        p.runs = vec![Run { text: line.to_string(), props: run.clone(), kind: deckcraft_model::text::RunKind::Text }];
                    }
                    p
                })
                .collect(),
            ..body
        });
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
        if let Some(t) = s.text.as_mut() {
            for p in &mut t.paragraphs {
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
                p.runs.iter_mut().for_each(|r| apply(&mut r.props));
                apply(&mut p.end_props);
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
    if let Some(t) = &edit.transition {
        if !TRANSITIONS_OFFERED.contains(&t.as_str()) {
            return Err("That transition is not offered.".to_string());
        }
        s.transition = if t == "none" { None } else { Some(deckcraft_model::anim::Transition { kind: t.clone(), duration_ms: 700, ..Default::default() }) };
    }
    if let Some(h) = edit.hidden {
        s.hidden = h;
    }
    if let Some(hex) = &edit.background {
        s.background = if hex.is_empty() { None } else { Some(deckcraft_model::Background::Fill { fill: Fill::solid(ColorRef::rgb(Rgba::from_hex(hex).ok_or("That is not a colour.")?)) }) };
    }
    serde_json::to_string(&s).map_err(|e| e.to_string())
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

#[tauri::command]
pub fn deck_layouts(base_id: String) -> Result<Vec<Layout>, String> {
    layouts(&base_id)
}

#[tauri::command]
pub fn deck_new_slide(base_id: String, layout: u32) -> Result<String, String> {
    new_slide(&base_id, layout)
}

#[tauri::command]
pub fn deck_new_shape(kind: String, id: u32, x: f64, y: f64, w: f64, h: f64) -> Result<String, String> {
    new_shape(&kind, id, x, y, w, h)
}

#[tauri::command]
pub fn deck_edit_shape(shape: String, edit: ShapeEdit) -> Result<String, String> {
    edit_shape(&shape, &edit)
}

#[tauri::command]
pub fn deck_edit_slide(slide: String, edit: SlideEdit) -> Result<String, String> {
    edit_slide(&slide, &edit)
}

/// A picture for the deck: the new base that holds it, and the picture shape
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn deck_add_picture(base: String, name: String, data: String, id: u32, x: f64, y: f64, w: f64, h: f64) -> Result<(String, String), String> {
    tokio::task::spawn_blocking(move || add_picture(&base, &name, &data, id, x, y, w, h)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn deck_text_of(shape: String) -> Result<String, String> {
    text_of(&shape)
}

/// Writes the deck as the .pptx file `dest` names
#[tauri::command]
pub async fn deck_save(app_handle: tauri::AppHandle, path: String, dest: String, base: String, slides: Vec<String>) -> Result<usize, String> {
    validate_allowed_root(&app_handle, &path)?;
    let dest = super::export::check_destination(&path, &dest, &["pptx"])?;
    let bytes = tokio::task::spawn_blocking(move || export(&base, &slides)).await.map_err(|e| e.to_string())??;
    std::fs::write(&dest, &bytes).map_err(|e| format!("Could not save the file: {e}"))?;
    Ok(bytes.len())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn deck() -> (String, String, Vec<String>) {
        let o = blank().unwrap();
        let id = register(&o.parts.base).unwrap();
        (o.parts.base, id, o.parts.slides)
    }

    #[test]
    fn slides_get_notes_transitions_and_backgrounds_and_shapes_get_outlines_and_alignment() {
        let (_, id, slides) = deck();
        let s = edit_slide(&slides[0], &SlideEdit { notes: Some("Say hello
Then the numbers".into()), transition: Some("fade".into()), hidden: Some(true), background: Some("102030".into()) }).unwrap();
        let slide: Slide = serde_json::from_str(&s).unwrap();
        assert_eq!(slide.notes.text(), "Say hello
Then the numbers");
        assert_eq!(slide.transition.as_ref().map(|t| t.kind.as_str()), Some("fade"));
        assert!(slide.hidden && slide.background.is_some());
        let plain: Slide = serde_json::from_str(&edit_slide(&s, &SlideEdit { transition: Some("none".into()), background: Some(String::new()), ..Default::default() }).unwrap()).unwrap();
        assert!(plain.transition.is_none() && plain.background.is_none());
        assert!(edit_slide(&slides[0], &SlideEdit { transition: Some("evil".into()), ..Default::default() }).is_err());
        // The background shows in the picture
        assert_ne!(render(&id, &slides[0], 0.2).unwrap().png, render(&id, &s, 0.2).unwrap().png);
        let tb = new_shape("textBox", 90, 10.0, 10.0, 200.0, 60.0).unwrap();
        let edited = edit_shape(&tb, &ShapeEdit { align: Some("center".into()), underline: Some(true), font: Some("Arial".into()), line: Some("FF0000".into()), line_width: Some(3.0), ..Default::default() }).unwrap();
        let shape: Shape = serde_json::from_str(&edited).unwrap();
        assert!(shape.line.as_ref().is_some_and(|l| l.width == Some(3.0)));
        let para = &shape.text.as_ref().unwrap().paragraphs[0];
        assert_eq!(para.props.align, Some(deckcraft_model::text::Align::Center));
        assert_eq!(para.runs[0].props.font.as_deref(), Some("Arial"));
        assert!(edit_shape(&tb, &ShapeEdit { align: Some("sideways".into()), ..Default::default() }).is_err());
    }

    #[test]
    fn a_picture_goes_into_the_deck_and_out_in_the_file() {
        // A 1x1 PNG
        let png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
        let o = blank().unwrap();
        let (base, shape) = add_picture(&o.parts.base, "my pic.png", png, 50, 100.0, 100.0, 200.0, 120.0).unwrap();
        let mut slide: Slide = serde_json::from_str(&o.parts.slides[0]).unwrap();
        slide.shapes.push(serde_json::from_str(&shape).unwrap());
        let bytes = export(&base, &[serde_json::to_string(&slide).unwrap()]).unwrap();
        let back = open("a.pptx", &bytes).unwrap();
        let again = assemble(&back.parts.base, &back.parts.slides).unwrap();
        assert!(again.media.iter().any(|m| m.content_type == "image/png" && !m.data.is_empty()));
        assert!(again.slides[0].shapes.iter().any(|s| matches!(s.kind, ShapeKind::Picture { .. })));
        assert!(add_picture(&o.parts.base, "x.png", "AAAA", 51, 0.0, 0.0, 10.0, 10.0).is_err());
    }

    #[test]
    fn media_bytes_survive_the_pieces() {
        let mut p = defaults::blank_presentation(deckcraft_geom::Size::new(960.0, 540.0), deckcraft_model::theme::Theme::default(), true);
        p.add_media("a.png", "image/png", vec![1, 2, 3, 4, 5]).unwrap();
        let parts = split(&p).unwrap();
        let back = assemble(&parts.base, &parts.slides).unwrap();
        assert_eq!(back.media.len(), 1);
        assert_eq!(back.media[0].data.len(), 5, "picture bytes were lost in the base");
    }

    #[test]
    fn a_new_deck_has_a_title_slide_that_draws_with_boxes_for_its_shapes() {
        let (_, id, slides) = deck();
        assert_eq!(slides.len(), 1);
        let r = render(&id, &slides[0], 1.0).unwrap();
        let png = BASE64_STANDARD.decode(&r.png).unwrap();
        assert!(png.starts_with(b"\x89PNG") && png.len() > 1000);
        assert_eq!((r.width_pt, r.height_pt), (960.0, 540.0));
        // The title and the subtitle inherit their place from the layout; the boxes say where
        assert_eq!(r.frames.len(), 2);
        assert!(r.frames.iter().all(|f| f.placeholder && f.w > 100.0 && f.h > 20.0));
        assert_eq!(render("nope", &slides[0], 1.0).unwrap_err(), "unknown base");
        assert!(render(&id, &slides[0], 0.0).is_err());
    }

    #[test]
    fn text_shapes_and_fills_are_added_and_changed_and_the_slide_draws_differently() {
        let (base, id, mut slides) = deck();
        let before = render(&id, &slides[0], 1.0).unwrap().png;
        let mut slide: Slide = serde_json::from_str(&slides[0]).unwrap();
        let tb = new_shape("textBox", 900, 100.0, 100.0, 400.0, 80.0).unwrap();
        let tb = edit_shape(&tb, &ShapeEdit { text: Some("Hello\ndeck".into()), bold: Some(true), size: Some(40.0), color: Some("C00000".into()), ..Default::default() }).unwrap();
        assert_eq!(text_of(&tb).unwrap(), "Hello\ndeck");
        let rect = edit_shape(&new_shape("ellipse", 901, 50.0, 300.0, 200.0, 120.0).unwrap(), &ShapeEdit { fill: Some("2D64D2".into()), ..Default::default() }).unwrap();
        slide.shapes.push(serde_json::from_str(&tb).unwrap());
        slide.shapes.push(serde_json::from_str(&rect).unwrap());
        slides[0] = serde_json::to_string(&slide).unwrap();
        let after = render(&id, &slides[0], 1.0).unwrap();
        assert_ne!(before, after.png);
        assert!(after.frames.iter().any(|f| f.id == 900 && f.x == 100.0 && f.w == 400.0 && !f.placeholder));
        // The same edits survive a trip through a .pptx file
        let bytes = export(&base, &slides).unwrap();
        let back = open("deck.pptx", &bytes).unwrap();
        assert_eq!(back.parts.slides.len(), 1);
        let again: Slide = serde_json::from_str(&back.parts.slides[0]).unwrap();
        assert!(again.shapes.iter().any(|s| s.text.as_ref().is_some_and(|t| t.text() == "Hello\ndeck")));
        assert!(new_shape("blob", 1, 0.0, 0.0, 10.0, 10.0).is_err());
        assert!(edit_shape(&tb, &ShapeEdit { fill: Some("nonsense".into()), ..Default::default() }).is_err());
    }

    #[test]
    fn a_new_slide_follows_a_layout_and_two_slides_with_one_id_get_their_own() {
        let (base, id, slides) = deck();
        let all = layouts(&id).unwrap();
        assert!(all.len() > 5 && all.iter().any(|l| l.name.to_lowercase().contains("title")));
        let content = all.iter().find(|l| l.name.to_lowercase().contains("content")).unwrap();
        let fresh = new_slide(&id, content.id).unwrap();
        let s: Slide = serde_json::from_str(&fresh).unwrap();
        assert!(s.shapes.len() >= 2 && s.shapes.iter().all(|x| x.ph.is_some()));
        assert!(new_slide(&id, 999_999).is_err());
        // Two people added a slide at once: both have the same id
        let p = assemble(&base, &[slides[0].clone(), fresh.clone(), fresh]).unwrap();
        let mut ids: Vec<u32> = p.slides.iter().map(|s| s.id.0).collect();
        ids.sort();
        ids.dedup();
        assert_eq!(ids.len(), 3);
    }

    #[test]
    fn a_text_edit_keeps_the_look_of_the_first_run_and_moving_a_placeholder_gives_it_a_place() {
        let (_, id, slides) = deck();
        let slide: Slide = serde_json::from_str(&slides[0]).unwrap();
        let title = serde_json::to_string(&slide.shapes[0]).unwrap();
        let typed = edit_shape(&title, &ShapeEdit { text: Some("Quarterly review".into()), ..Default::default() }).unwrap();
        let moved = edit_shape(&typed, &ShapeEdit { x: Some(40.0), y: Some(30.0), w: Some(500.0), h: Some(90.0), ..Default::default() }).unwrap();
        let s: Shape = serde_json::from_str(&moved).unwrap();
        assert_eq!((s.xfrm.unwrap().x, s.xfrm.unwrap().w), (40.0, 500.0));
        assert!(s.ph.is_some());
        let mut slide = slide;
        slide.shapes[0] = s;
        let r = render(&id, &serde_json::to_string(&slide).unwrap(), 1.0).unwrap();
        assert!(r.frames.iter().any(|f| f.x == 40.0 && f.y == 30.0));
    }

    #[test]
    fn junk_encrypted_and_oversized_input_are_refused() {
        assert!(open("a.pptx", b"not a zip").is_err());
        assert!(open("a.docx", b"PK\x03\x04").unwrap_err().contains("opens .pptx"));
        assert!(assemble("{", &[]).is_err());
        // A deck from another device that claims a huge slide is not drawn
        let mut base: serde_json::Value = serde_json::from_str(&blank().unwrap().parts.base).unwrap();
        base["slideSize"] = serde_json::json!({"width": 1.0e7, "height": 1.0e7});
        assert!(register(&base.to_string()).unwrap_err().contains("not a size"));
        // A big but allowed size is not drawn at a size that would fill the memory
        base["slideSize"] = serde_json::json!({"width": 20000.0, "height": 20000.0});
        let id = register(&base.to_string()).unwrap();
        assert!(render(&id, "{}", 1.0).unwrap_err().contains("too large"));
        assert!(assemble(&blank().unwrap().parts.base, &["{".to_string()]).is_err());
    }
}
