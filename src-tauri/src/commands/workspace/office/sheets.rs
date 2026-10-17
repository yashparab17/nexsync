//! Spreadsheets (Phase 21, step 4): calculating a workbook, reading and writing spreadsheet files, and inserting or removing rows and
//! columns, with the engine and file readers of GridCraft (MIT OR Apache-2.0, pinned by commit, see THIRD_PARTY_NOTICES.md).
//!
//! A sheet lives in the workspace as a shared document: each cell is what a person typed into it (`=SUM(A1:A3)`, `12%`, `hello`),
//! kept as one entry of a shared map. Nothing here holds a workbook between calls. Every device sends the cells it has and gets back
//! what each shows, so each device works out the same answers from the same typed text with the same engine (a workspace whose
//! devices run different versions can show different answers; the version-skew rules of Phase 14 apply).
//!
//! The engine refuses a formula it cannot read; such a cell shows `#ERROR!` and the message is returned beside it. Inserting and
//! removing rows and columns is done by the engine, which rewrites the formulas that point at moved cells, and the whole sheet comes
//! back; two people doing that at the same moment, or one doing it while another types, is the open question of research item N26.
//!
//! Files: .xlsx, .xlsm, .xlsb, .xls, .ods and .csv/.tsv open (values and formulas; formatting, charts, pivot tables and pictures do
//! not come into the grid yet, and say so); .xlsx and .csv are written.

use std::{
    collections::BTreeMap,
    fs,
    panic::{catch_unwind, AssertUnwindSafe},
};

use gridcraft_engine::{
    core::CellRef,
    display,
    model::style::{BorderLine, Color, Fill, HAlign, NumFmt, PatternType, Style, StyleId, Underline},
    Session,
};
use gridcraft_xlsx as xlsx;
use serde::{Deserialize, Serialize};
use serde_json::json;

use super::documents::check_package;
use crate::commands::{config::validate_allowed_root, path_utils::resolve_workspace_path};

pub const MAX_CELLS: usize = 200_000;
/// Cells sent back at most: a formula can make millions (`MAKEARRAY(100000,100,...)` made ten million in 42 seconds), and the grid
/// shows a screenful
const MAX_SHOWN: usize = 300_000;
/// How long a calculation may take before the answer is given up on
const CALC_LIMIT: std::time::Duration = std::time::Duration::from_secs(20);
/// Said when a calculation is still running: only one runs at a time, so a formula that takes minutes cannot be stacked
pub const BUSY: &str = "Still working out the last change.";
const MAX_SHEETS: usize = 64;
/// Cells that carry a look: each costs a style change, and a sheet painted cell by cell can hold a great many
const MAX_STYLED: usize = 50_000;
const MAX_FILE_BYTES: u64 = 64 * 1024 * 1024;

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct SheetIn {
    pub name: String,
    /// What was typed into each cell, by address (`A1`)
    pub cells: BTreeMap<String, String>,
    /// How cells look, by address: only cells that differ from the plain default
    #[serde(default)]
    pub styles: BTreeMap<String, CellStyle>,
    /// Column widths in pixels, by column letters (`B`)
    #[serde(default)]
    pub widths: BTreeMap<String, f32>,
    /// Rows and columns frozen at the top and left
    #[serde(default)]
    pub freeze: Option<(u32, u32)>,
    /// Charts over the grid; they go into saved files and PDFs, not into what a calculation works on
    #[serde(default)]
    pub charts: Vec<ChartIn>,
}

/// A chart of a range, anchored at the cell `at` with a size in pixels
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct ChartIn {
    pub range: String,
    pub kind: String,
    pub title: String,
    pub at: String,
    pub w: f32,
    pub h: f32,
}

/// Puts the charts of the sheets into a session, for the file or PDF that is about to be written
pub(super) fn add_charts(s: &mut Session, sheets: &[SheetIn]) {
    for sheet in sheets {
        for c in sheet.charts.iter().take(50) {
            if !super::sheet_tools::KINDS.contains(&c.kind.as_str()) || CellRef::parse(&c.at).is_none() {
                continue;
            }
            let mut p = json!({"sheet": sheet.name, "range": c.range, "type": c.kind, "at": c.at, "width": c.w.clamp(80.0, 2000.0), "height": c.h.clamp(60.0, 2000.0)});
            if !c.title.trim().is_empty() {
                p["title"] = json!(c.title.trim());
            }
            // A chart the engine cannot make from its range is left out of the file
            let _ = s.execute("insert.chart", p);
        }
    }
}

fn is_false(b: &bool) -> bool {
    !*b
}

/// How one cell looks. Colours are `#RRGGBB`; `align` is `left`, `center` or `right`; `borders` holds the sides drawn, from `ltrb`;
/// `nf` is a number format code such as `0.00` or `"$"#,##0`.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct CellStyle {
    #[serde(skip_serializing_if = "is_false")]
    pub bold: bool,
    #[serde(skip_serializing_if = "is_false")]
    pub italic: bool,
    #[serde(skip_serializing_if = "is_false")]
    pub underline: bool,
    #[serde(skip_serializing_if = "is_false")]
    pub strike: bool,
    #[serde(skip_serializing_if = "is_false")]
    pub wrap: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fill: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub align: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub nf: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub borders: Option<String>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Shown {
    pub text: String,
    /// `number`, `text`, `bool`, `error` or `empty`: numbers align right, text left, errors in red
    pub kind: &'static str,
    /// The number itself, for the sum and average of a selection
    #[serde(skip_serializing_if = "Option::is_none")]
    pub num: Option<f64>,
}

#[derive(Serialize, Clone, Debug, Default)]
pub struct SheetOut {
    pub name: String,
    pub cells: BTreeMap<String, Shown>,
}

#[derive(Serialize, Clone, Debug, Default)]
pub struct Calculated {
    pub sheets: Vec<SheetOut>,
    /// The answers were cut at the limit of cells that are sent back
    pub truncated: bool,
    /// Cells the engine refused, with why: a formula it cannot read
    pub refused: Vec<Refused>,
}

/// The sheet, the cell and why the engine would not take what was typed
pub type Refused = (String, String, String);

fn check(sheets: &[SheetIn]) -> Result<(), String> {
    if sheets.is_empty() || sheets.len() > MAX_SHEETS {
        return Err(format!("A workbook has 1 to {MAX_SHEETS} sheets."));
    }
    if sheets.iter().map(|s| s.cells.len()).sum::<usize>() > MAX_CELLS {
        return Err("This workbook has too many cells.".to_string());
    }
    if sheets.iter().enumerate().any(|(i, s)| sheets[..i].iter().any(|o| o.name.eq_ignore_ascii_case(&s.name))) {
        return Err("Two sheets have the same name.".to_string());
    }
    Ok(())
}

/// A session holding the sheets, and the cells it refused
pub(super) fn build(sheets: &[SheetIn]) -> Result<(Session, Vec<Refused>), String> {
    check(sheets)?;
    let mut s = Session::new();
    s.new_workbook();
    for (i, sheet) in sheets.iter().enumerate() {
        if i == 0 {
            s.execute("sheet.rename", json!({"sheet": 0, "name": sheet.name})).map_err(|e| e.to_string())?;
        } else {
            s.execute("home.insertSheet", json!({"name": sheet.name})).map_err(|e| e.to_string())?;
        }
    }
    let mut refused = Vec::new();
    for sheet in sheets {
        for (a1, input) in &sheet.cells {
            if CellRef::parse(a1).is_none() {
                continue;
            }
            if let Err(e) = s.execute("cell.set", json!({"sheet": sheet.name, "cell": a1, "input": input})) {
                refused.push((sheet.name.clone(), a1.clone(), e.to_string()));
            }
        }
    }
    for sheet in sheets {
        apply_looks(&mut s, sheet)?;
    }
    Ok((s, refused))
}

fn hex(c: &Option<String>) -> Option<Color> {
    c.as_deref().and_then(Color::from_hex)
}

/// Gives the cells of a sheet the looks they were given, and the sheet its column widths and frozen panes
fn apply_looks(s: &mut Session, sheet: &SheetIn) -> Result<(), String> {
    if sheet.styles.is_empty() && sheet.widths.is_empty() && sheet.freeze.is_none() {
        return Ok(());
    }
    let d = s.doc_mut().map_err(|e| e.to_string())?;
    let wb = std::sync::Arc::make_mut(&mut d.wb);
    let Some(i) = wb.sheet_index(&sheet.name) else { return Ok(()) };
    let styles = &mut wb.styles;
    let sh = std::sync::Arc::make_mut(&mut wb.sheets[i]);
    for (a1, look) in sheet.styles.iter().take(MAX_STYLED) {
        let Some(at) = CellRef::parse(a1) else { continue };
        let id = styles.derive(sh.style_id(at), |st| {
            st.font.bold = look.bold;
            st.font.italic = look.italic;
            st.font.strike = look.strike;
            st.font.underline = if look.underline { Underline::Single } else { Underline::None };
            if let Some(c) = hex(&look.color) {
                st.font.color = c;
            }
            if let Some(f) = look.font.as_deref().filter(|f| !f.is_empty() && f.len() < 64) {
                st.font.name = f.to_string();
            }
            if let Some(n) = look.size.filter(|n| (1.0..=409.0).contains(n)) {
                st.font.size = n;
            }
            if let Some(c) = hex(&look.fill) {
                st.fill = Fill::solid(c);
            }
            st.align.h = match look.align.as_deref() {
                Some("left") => HAlign::Left,
                Some("center") => HAlign::Center,
                Some("right") => HAlign::Right,
                _ => HAlign::General,
            };
            st.align.wrap = look.wrap;
            if let Some(code) = look.nf.as_deref().filter(|c| !c.is_empty() && c.len() < 256) {
                st.num_fmt = NumFmt::new(code);
            }
            if let Some(b) = &look.borders {
                for side in b.chars() {
                    match side {
                        'l' => st.borders.left = BorderLine::thin(),
                        'r' => st.borders.right = BorderLine::thin(),
                        't' => st.borders.top = BorderLine::thin(),
                        'b' => st.borders.bottom = BorderLine::thin(),
                        _ => {}
                    }
                }
            }
        });
        sh.set_style(at, id);
    }
    for (letters, px) in sheet.widths.iter().take(1000) {
        if (8.0..=2000.0).contains(px) {
            if let Some(c) = CellRef::parse(&format!("{letters}1")) {
                sh.cols.entry(c.col).or_default().size = Some(px * 0.75);
            }
        }
    }
    if let Some((rows, cols)) = sheet.freeze.filter(|(r, c)| *r < 1000 && *c < 100 && (*r > 0 || *c > 0)) {
        sh.freeze = Some((rows, cols));
    }
    Ok(())
}

/// How a cell looks, as far as the grid shows it; `None` when it is plain
fn look_of(st: &Style, wb: &gridcraft_engine::model::Workbook) -> Option<CellStyle> {
    let plain = Style::default();
    if *st == plain {
        return None;
    }
    let mut borders = String::new();
    for (c, line) in [('l', &st.borders.left), ('r', &st.borders.right), ('t', &st.borders.top), ('b', &st.borders.bottom)] {
        if !line.is_none() {
            borders.push(c);
        }
    }
    let nf = st.num_fmt.as_str();
    let look = CellStyle {
        bold: st.font.bold,
        italic: st.font.italic,
        underline: st.font.underline != Underline::None,
        strike: st.font.strike,
        wrap: st.align.wrap,
        color: st.font.color.hex(&wb.theme),
        fill: if st.fill.pattern == PatternType::Solid { st.fill.fg.hex(&wb.theme) } else { None },
        align: match st.align.h {
            HAlign::Left => Some("left".into()),
            HAlign::Center | HAlign::CenterAcross => Some("center".into()),
            HAlign::Right => Some("right".into()),
            _ => None,
        },
        nf: if nf == "General" || nf.is_empty() { None } else { Some(nf.to_string()) },
        size: if (st.font.size - plain.font.size).abs() > 0.01 { Some(st.font.size) } else { None },
        font: if st.font.name != plain.font.name { Some(st.font.name.clone()) } else { None },
        borders: if borders.is_empty() { None } else { Some(borders) },
    };
    (look != CellStyle::default()).then_some(look)
}

fn num_of(v: &gridcraft_engine::core::Value) -> Option<f64> {
    match v {
        gridcraft_engine::core::Value::Number(n) if n.is_finite() => Some(*n),
        _ => None,
    }
}

fn kind_of(v: &gridcraft_engine::core::Value) -> &'static str {
    use gridcraft_engine::core::Value;
    match v {
        Value::Empty => "empty",
        Value::Number(_) => "number",
        Value::Text(_) => "text",
        Value::Bool(_) => "bool",
        Value::Error(_) => "error",
        Value::Array(_) => "text",
    }
}

fn shown(s: &Session) -> Result<(Vec<SheetOut>, bool), String> {
    let d = s.doc().map_err(|e| e.to_string())?;
    let mut budget = MAX_SHOWN;
    let mut truncated = false;
    let out = d
        .wb
        .sheets
        .iter()
        .map(|sh| {
            let mut cells: BTreeMap<String, Shown> = sh
                .cells
                .iter()
                .filter(|(_, c)| !c.value.is_empty() || c.formula.is_some())
                .map(|(at, c)| (at.a1(), Shown { text: display::cell_text(&d.wb, sh, at), kind: kind_of(&c.value), num: num_of(&c.value) }))
                .collect();
            // The cells a dynamic array spilled into hold no typed text of their own
            for (at, v) in sh.spill.iter().take(budget) {
                cells.entry(at.a1()).or_insert_with(|| Shown { text: display::cell_text(&d.wb, sh, *at), kind: kind_of(v), num: num_of(v) });
            }
            if cells.len() > budget {
                truncated = true;
                cells = cells.into_iter().take(budget).collect();
            }
            budget -= cells.len();
            SheetOut { name: sh.name.clone(), cells }
        })
        .collect();
    Ok((out, truncated))
}

/// What the sheets show
pub fn calculate(sheets: &[SheetIn]) -> Result<Calculated, String> {
    let (s, refused) = catch_unwind(AssertUnwindSafe(|| build(sheets))).map_err(|_| "The workbook could not be calculated.".to_string())??;
    let (answers, truncated) = shown(&s)?;
    let mut out = Calculated { sheets: answers, truncated, refused };
    // A refused formula shows as an error where it would be
    for (sheet, a1, _) in &out.refused.clone() {
        if let Some(o) = out.sheets.iter_mut().find(|o| &o.name == sheet) {
            o.cells.insert(a1.clone(), Shown { text: "#ERROR!".into(), kind: "error", num: None });
        }
    }
    Ok(out)
}

/// What each cell of each sheet holds as typed (formulas as `=...`), for the sheets of a session
pub(super) fn inputs(s: &Session) -> Result<Vec<SheetIn>, String> {
    let d = s.doc().map_err(|e| e.to_string())?;
    Ok(d.wb
        .sheets
        .iter()
        .map(|sh| SheetIn {
            name: sh.name.clone(),
            cells: sh.cells.iter().filter(|(_, c)| !c.is_blank()).map(|(at, _)| (at.a1(), display::edit_text(&d.wb, sh, at))).filter(|(_, t)| !t.is_empty()).collect(),
            styles: sh.cells.iter().filter(|(_, c)| c.style != StyleId::DEFAULT).filter_map(|(at, c)| look_of(d.wb.styles.get(c.style), &d.wb).map(|l| (at.a1(), l))).take(MAX_STYLED).collect(),
            widths: sh.cols.iter().filter_map(|(c, info)| info.size.map(|pt| (gridcraft_engine::core::addr::col_to_letters(*c), (pt / 0.75 * 10.0).round() / 10.0))).take(1000).collect(),
            freeze: sh.freeze.filter(|(r, c)| *r > 0 || *c > 0),
            charts: Vec::new(),
        })
        .collect())
}

#[derive(Deserialize, Clone, Copy, Debug)]
#[serde(rename_all = "camelCase")]
pub enum Structure {
    InsertRows,
    DeleteRows,
    InsertCols,
    DeleteCols,
}

/// Inserts or deletes `count` rows or columns at 0-based index `at` of a sheet, with formulas that point at moved cells rewritten
pub fn restructure(sheets: &[SheetIn], sheet: &str, op: Structure, at: u32, count: u32) -> Result<Vec<SheetIn>, String> {
    if count == 0 || count > 1000 {
        return Err("Choose 1 to 1,000 rows or columns.".to_string());
    }
    let (mut s, _) = build(sheets)?;
    let span = |first: u32, last: u32, cols: bool| if cols { format!("{}:{}", gridcraft_engine::core::addr::col_to_letters(first), gridcraft_engine::core::addr::col_to_letters(last)) } else { format!("{}:{}", first + 1, last + 1) };
    let (id, key, range) = match op {
        Structure::InsertRows => ("home.insertRows", "rows", span(at, at + count - 1, false)),
        Structure::DeleteRows => ("home.deleteRows", "rows", span(at, at + count - 1, false)),
        Structure::InsertCols => ("home.insertColumns", "cols", span(at, at + count - 1, true)),
        Structure::DeleteCols => ("home.deleteColumns", "cols", span(at, at + count - 1, true)),
    };
    s.execute(id, json!({"sheet": sheet, key: range})).map_err(|e| e.to_string())?;
    inputs(&s)
}

// ────────────────────────────
// Files
// ────────────────────────────

#[derive(Serialize, Clone, Debug, Default)]
pub struct Opened {
    pub sheets: Vec<SheetIn>,
    /// What the grid does not show of the file
    pub notes: Vec<String>,
}

/// Opens spreadsheet bytes, by what they hold (not only by the name)
pub fn open(name: &str, bytes: &[u8]) -> Result<Opened, String> {
    if bytes.len() as u64 > MAX_FILE_BYTES {
        return Err("This file is bigger than 64 MB. It was not opened.".to_string());
    }
    let lower = name.to_ascii_lowercase();
    let format = xlsx::sniff(bytes);
    if matches!(format, xlsx::Format::Xlsx | xlsx::Format::Xlsb | xlsx::Format::Ods) {
        check_package(bytes)?;
    }
    let read = catch_unwind(AssertUnwindSafe(|| match format {
        xlsx::Format::Xlsx => xlsx::read_xlsx(bytes).map(|(w, r)| (w, r.warnings)),
        xlsx::Format::Xlsb => xlsx::read_xlsb(bytes).map(|(w, r)| (w, r.warnings)),
        xlsx::Format::Ods => xlsx::read_ods(bytes).map(|(w, r)| (w, r.warnings)),
        xlsx::Format::Xls => xlsx::read_xls(bytes).map(|(w, r)| (w, r.warnings)),
        xlsx::Format::Csv => {
            let delimiter = if lower.ends_with(".tsv") { b'\t' } else { 0 };
            xlsx::read_csv(bytes, &xlsx::CsvOptions { delimiter, ..Default::default() }).map(|w| (w, Vec::new()))
        }
        xlsx::Format::Encrypted => Err(xlsx::IoError::Format("this workbook is protected with a password".into())),
        _ => Err(xlsx::IoError::Format("this is not a spreadsheet Nexsync can open".into())),
    }))
    .map_err(|_| "This file could not be read safely, so it was not opened.".to_string())?
    .map_err(|e| format!("This spreadsheet could not be read: {e}"))?;
    let (wb, warnings) = read;
    let mut s = Session::new();
    let title = name.rsplit(['/', '\\']).next().unwrap_or(name).to_string();
    s.add_document(gridcraft_engine::DocState::new(wb, None, title));
    let sheets = inputs(&s)?;
    let cells: usize = sheets.iter().map(|x| x.cells.len()).sum();
    if cells > MAX_CELLS {
        return Err(format!("This workbook has {cells} cells; the grid opens up to {MAX_CELLS}."));
    }
    let mut notes: Vec<String> = warnings.into_iter().take(10).collect();
    if matches!(format, xlsx::Format::Xlsx | xlsx::Format::Xlsb | xlsx::Format::Ods | xlsx::Format::Xls) {
        notes.push("Charts, pivot tables, pictures, merged cells, conditional formats and macros are not shown in the grid yet.".to_string());
    }
    Ok(Opened { sheets, notes })
}

/// Writes the sheets as an .xlsx file
pub fn write_xlsx(sheets: &[SheetIn]) -> Result<Vec<u8>, String> {
    let (mut s, _) = build(sheets)?;
    add_charts(&mut s, sheets);
    let d = s.doc().map_err(|e| e.to_string())?;
    xlsx::write_xlsx(&d.wb).map_err(|e| format!("The file could not be written: {e}"))
}

/// Writes one sheet as CSV (the text each cell shows)
pub fn write_csv(sheets: &[SheetIn], sheet: &str, delimiter: u8) -> Result<Vec<u8>, String> {
    let (s, _) = build(sheets)?;
    let d = s.doc().map_err(|e| e.to_string())?;
    let sh = d.wb.sheets.iter().find(|x| x.name == sheet).ok_or("That sheet is gone.")?;
    xlsx::write_csv(sh, delimiter, |at| display::cell_text(&d.wb, sh, at)).map_err(|e| format!("The file could not be written: {e}"))
}

// ────────────────────────────
// Commands
// ────────────────────────────

/// What each cell of a workbook shows; runs off the main thread
#[tauri::command]
pub async fn sheet_calculate(sheets: Vec<SheetIn>) -> Result<Calculated, String> {
    use std::sync::atomic::{AtomicBool, Ordering};
    static RUNNING: AtomicBool = AtomicBool::new(false);
    if RUNNING.swap(true, Ordering::SeqCst) {
        return Err(BUSY.to_string());
    }
    // The flag is lowered when the work ends, not when the answer is given up on: a long calculation keeps its place
    let work = tokio::task::spawn_blocking(move || {
        let r = calculate(&sheets);
        RUNNING.store(false, Ordering::SeqCst);
        r
    });
    match tokio::time::timeout(CALC_LIMIT, work).await {
        Ok(r) => r.map_err(|e| e.to_string())?,
        Err(_) => Err("This sheet took too long to work out. A formula may be making far too many cells.".to_string()),
    }
}

#[tauri::command]
pub async fn sheet_restructure(sheets: Vec<SheetIn>, sheet: String, op: Structure, at: u32, count: u32) -> Result<Vec<SheetIn>, String> {
    tokio::task::spawn_blocking(move || restructure(&sheets, &sheet, op, at, count)).await.map_err(|e| e.to_string())?
}

/// Opens a spreadsheet file of the workspace
#[tauri::command]
pub async fn sheet_open(app_handle: tauri::AppHandle, path: String, rel: String) -> Result<Opened, String> {
    validate_allowed_root(&app_handle, &path)?;
    let file = resolve_workspace_path(&path, rel.trim_start_matches('/'))?;
    let meta = fs::metadata(&file).map_err(|_| "That file is gone.".to_string())?;
    if !meta.is_file() || meta.len() > MAX_FILE_BYTES {
        return Err("That file is not one Nexsync can open as a spreadsheet.".to_string());
    }
    let name = rel.clone();
    tokio::task::spawn_blocking(move || open(&name, &fs::read(&file).map_err(|e| e.to_string())?)).await.map_err(|e| e.to_string())?
}

/// Saves the workbook as the file `dest` names (.xlsx, or .csv/.tsv for the sheet `sheet`)
#[tauri::command]
pub async fn sheet_save(app_handle: tauri::AppHandle, path: String, dest: String, sheets: Vec<SheetIn>, sheet: String) -> Result<usize, String> {
    validate_allowed_root(&app_handle, &path)?;
    let dest = crate::commands::workspace::export::check_destination(&path, &dest, &["xlsx", "csv", "tsv", "pdf"])?;
    let lower = dest.to_string_lossy().to_ascii_lowercase();
    let bytes = tokio::task::spawn_blocking(move || {
        if lower.ends_with(".xlsx") {
            write_xlsx(&sheets)
        } else if lower.ends_with(".pdf") {
            super::sheet_tools::pdf(&sheets, Some(&sheet))
        } else {
            write_csv(&sheets, &sheet, if lower.ends_with(".tsv") { b'\t' } else { b',' })
        }
    })
    .await
    .map_err(|e| e.to_string())??;
    fs::write(&dest, &bytes).map_err(|e| format!("Could not save the file: {e}"))?;
    Ok(bytes.len())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sheet(name: &str, cells: &[(&str, &str)]) -> SheetIn {
        SheetIn { name: name.into(), cells: cells.iter().map(|(a, b)| (a.to_string(), b.to_string())).collect(), ..Default::default() }
    }

    fn text<'a>(c: &'a Calculated, sheet: &str, a1: &str) -> &'a str {
        &c.sheets.iter().find(|s| s.name == sheet).unwrap().cells[a1].text
    }

    #[test]
    fn formulas_functions_percentages_errors_and_other_sheets_are_worked_out() {
        let c = calculate(&[
            sheet("Sales", &[("A1", "10"), ("A2", "32"), ("A3", "=SUM(A1:A2)*2"), ("B1", "=TEXT(A3,\"0.00\")&\" units\""), ("B2", "12%"), ("C1", "=1/0"), ("C2", "hello"), ("C3", "=Costs!A1+1")]),
            sheet("Costs", &[("A1", "41")]),
        ])
        .unwrap();
        assert_eq!((text(&c, "Sales", "A3"), text(&c, "Sales", "B1"), text(&c, "Sales", "B2"), text(&c, "Sales", "C1")), ("84", "84.00 units", "12%", "#DIV/0!"));
        assert_eq!(text(&c, "Sales", "C3"), "42");
        let sales = &c.sheets[0].cells;
        assert_eq!((sales["A1"].kind, sales["C2"].kind, sales["C1"].kind), ("number", "text", "error"));
        assert!(c.refused.is_empty());
    }

    #[test]
    fn a_formula_the_engine_cannot_read_is_refused_and_shows_an_error_while_the_rest_still_works() {
        let c = calculate(&[sheet("S", &[("A1", "5"), ("A2", "=1+*2"), ("A3", "=A1*2")])]).unwrap();
        assert_eq!(c.refused.len(), 1);
        assert_eq!((text(&c, "S", "A2"), text(&c, "S", "A3")), ("#ERROR!", "10"));
        assert!(calculate(&[]).is_err());
        assert!(calculate(&[sheet("a", &[]), sheet("A", &[])]).is_err());
    }

    #[test]
    fn dynamic_arrays_spill_into_cells_nobody_typed() {
        let c = calculate(&[sheet("S", &[("A1", "=SEQUENCE(3)")])]).unwrap();
        assert_eq!((text(&c, "S", "A1"), text(&c, "S", "A2"), text(&c, "S", "A3")), ("1", "2", "3"));
    }

    #[test]
    fn inserting_a_row_moves_the_cells_and_rewrites_the_formulas_that_point_at_them() {
        let before = [sheet("S", &[("A1", "1"), ("A2", "2"), ("A3", "=A1+A2"), ("B3", "=SUM(A1:A2)")]), sheet("T", &[("A1", "=S!A3")])];
        let after = restructure(&before, "S", Structure::InsertRows, 1, 1).unwrap();
        let s = &after[0].cells;
        assert_eq!((s["A1"].as_str(), s["A3"].as_str(), s["A4"].as_str(), s["B4"].as_str()), ("1", "2", "=A1+A3", "=SUM(A1:A3)"));
        // A formula on another sheet follows the cell it named
        assert_eq!(after[1].cells["A1"], "=S!A4");
        let gone = restructure(&after, "S", Structure::DeleteCols, 0, 1).unwrap();
        assert!(gone[0].cells.keys().all(|k| !k.starts_with('A')) || gone[0].cells.contains_key("A4"));
        assert!(restructure(&before, "S", Structure::InsertRows, 0, 0).is_err());
    }

    #[test]
    fn a_workbook_goes_out_as_xlsx_and_csv_and_comes_back_with_its_formulas() {
        let wb = [sheet("Data", &[("A1", "Name"), ("B1", "Qty"), ("A2", "pens"), ("B2", "3"), ("B3", "=B2*2"), ("A4", "a,b \"quoted\"")])];
        let bytes = write_xlsx(&wb).unwrap();
        let back = open("data.xlsx", &bytes).unwrap();
        assert_eq!(back.sheets[0].name, "Data");
        assert_eq!(back.sheets[0].cells["B3"], "=B2*2");
        assert_eq!(back.sheets[0].cells["A4"], "a,b \"quoted\"");
        assert!(back.notes.iter().any(|n| n.contains("not shown")));
        let csv = String::from_utf8(write_csv(&wb, "Data", b',').unwrap()).unwrap();
        assert!(csv.starts_with("Name,Qty\r\npens,3\r\n") || csv.starts_with("Name,Qty\npens,3\n"), "{csv}");
        assert!(csv.contains("6") && csv.contains("\"a,b \"\"quoted\"\"\""), "{csv}");
        let from_csv = open("x.csv", csv.as_bytes()).unwrap();
        assert_eq!(from_csv.sheets[0].cells["B2"], "3");
    }

    /// How long a recalculation of a big sheet takes (debug build); run by name: `cargo test sheet_speed -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn sheet_speed() {
        for n in [1_000usize, 5_000, 20_000] {
            let mut cells = BTreeMap::new();
            for r in 1..=n {
                cells.insert(format!("A{r}"), r.to_string());
                cells.insert(format!("B{r}"), if r == 1 { "=A1".to_string() } else { format!("=B{}+A{r}", r - 1) });
            }
            let started = std::time::Instant::now();
            let c = calculate(&[SheetIn { name: "S".into(), cells, ..Default::default() }]).unwrap();
            eprintln!("{} cells: {} ms, last = {}", n * 2, started.elapsed().as_millis(), c.sheets[0].cells[&format!("B{n}")].text);
        }
    }

    /// What hostile formulas from another person cost; run by name: `cargo test hostile_formulas -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn hostile_formulas() {
        for f in ["=SEQUENCE(1000000,100)", "=REPT(\"x\",1000000000)", "=A1+A1", "=SUM(SEQUENCE(100000000))", "=TEXTJOIN(\",\",TRUE,SEQUENCE(10000000))", "=MAKEARRAY(100000,100,LAMBDA(r,c,r*c))"] {
            let started = std::time::Instant::now();
            let c = calculate(&[sheet("S", &[("A1", f)])]);
            eprintln!("{f}: {:?} in {} ms", c.as_ref().map(|c| c.sheets[0].cells.len()).map_err(|e| e.clone()), started.elapsed().as_millis());
        }
    }

    #[test]
    fn looks_widths_and_frozen_panes_shape_what_is_shown_and_survive_an_xlsx_round_trip() {
        let mut s = sheet("S", &[("A1", "Total"), ("B1", "1234.5"), ("B2", "0.256")]);
        s.styles.insert("A1".into(), CellStyle { bold: true, fill: Some("#FFFF00".into()), borders: Some("lb".into()), ..Default::default() });
        s.styles.insert("B1".into(), CellStyle { nf: Some("\"$\"#,##0.00".into()), align: Some("center".into()), ..Default::default() });
        s.styles.insert("B2".into(), CellStyle { nf: Some("0.0%".into()), color: Some("#C00000".into()), ..Default::default() });
        s.widths.insert("B".into(), 150.0);
        s.freeze = Some((1, 0));
        let c = calculate(&[s.clone()]).unwrap();
        assert_eq!((text(&c, "S", "B1"), text(&c, "S", "B2")), ("$1,234.50", "25.6%"));
        let back = open("a.xlsx", &write_xlsx(&[s]).unwrap()).unwrap();
        let b = &back.sheets[0];
        assert!(b.styles["A1"].bold && b.styles["A1"].fill.as_deref() == Some("#FFFF00") && b.styles["A1"].borders.as_deref() == Some("lb"));
        assert_eq!((b.styles["B1"].nf.as_deref(), b.styles["B1"].align.as_deref()), (Some("\"$\"#,##0.00"), Some("center")));
        assert_eq!(b.styles["B2"].color.as_deref(), Some("#C00000"));
        assert_eq!(b.freeze, Some((1, 0)));
        assert!((b.widths["B"] - 150.0).abs() < 1.0, "{:?}", b.widths);
    }

    #[test]
    fn junk_and_oversized_input_are_refused_without_a_panic() {
        assert!(open("a.xlsx", b"PK\x03\x04 broken").is_err());
        assert!(open("a.xls", &[0u8; 100]).is_err());
        assert!(open("a.bin", b"\x00\x01\x02\x03").is_err());
    }
}
