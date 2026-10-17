//! Sheets, the tools of the Data and Insert tabs (Phase 21): sorting a range, drawing a chart from a range, and a PDF of a sheet. Like the
//! rest of the sheet commands they hold no workbook between calls: the cells and looks come in, the engine does the work, the result
//! goes back. Charts come back as drawing primitives (shapes and text) that the page paints, so they look the same on every device.

use gridcraft_chart::{render, resolve, ApproxMeasure, Prim};
use serde::Deserialize;
use serde_json::json;
use std::panic::{catch_unwind, AssertUnwindSafe};

use super::sheets::{build, inputs, SheetIn};

const MAX_CHART_SIDE: f32 = 2000.0;
pub(super) const KINDS: [&str; 7] = ["column", "bar", "line", "pie", "doughnut", "area", "scatter"];

fn guarded<T>(f: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
    catch_unwind(AssertUnwindSafe(f)).map_err(|_| "That could not be done.".to_string())?
}

/// Sorts the rows of `range` (`A1:C20`) of a sheet by one column (`B`), keeping each row together with its looks. `header` says the
/// first row is a heading that stays put.
pub fn sort(sheets: &[SheetIn], sheet: &str, range: &str, column: &str, descending: bool, header: bool) -> Result<Vec<SheetIn>, String> {
    guarded(|| {
        let (mut s, _) = build(sheets)?;
        s.execute("sheet.activate", json!({"sheet": sheet})).map_err(|e| e.to_string())?;
        let order = if descending { "desc" } else { "asc" };
        s.execute("data.sort", json!({"range": range, "header": header, "keys": [{"column": column, "order": order}]})).map_err(|e| e.to_string())?;
        inputs(&s)
    })
}

/// A chart of `range` as shapes, `w` by `h` pixels
pub fn chart(sheets: &[SheetIn], sheet: &str, range: &str, kind: &str, title: &str, w: f32, h: f32) -> Result<Vec<Prim>, String> {
    if !KINDS.contains(&kind) {
        return Err("That kind of chart is not offered.".to_string());
    }
    if !(80.0..=MAX_CHART_SIDE).contains(&w) || !(60.0..=MAX_CHART_SIDE).contains(&h) {
        return Err("That chart size is not offered.".to_string());
    }
    guarded(|| {
        let (mut s, _) = build(sheets)?;
        s.execute("sheet.activate", json!({"sheet": sheet})).map_err(|e| e.to_string())?;
        let mut params = json!({"range": range, "type": kind, "at": "A1", "width": w, "height": h});
        if !title.trim().is_empty() {
            params["title"] = json!(title.trim());
        }
        s.execute("insert.chart", params).map_err(|e| e.to_string())?;
        let d = s.doc().map_err(|e| e.to_string())?;
        let i = d.wb.sheet_index(sheet).ok_or("That sheet is gone.")?;
        let sh = d.wb.sheet(i).ok_or("That sheet is gone.")?;
        let c = sh.charts.last().ok_or("The chart could not be made from that range.")?;
        let data = resolve(&d.wb, i, c);
        Ok(render(c, &data, w, h, &ApproxMeasure))
    })
}

/// The workbook as a PDF: every sheet, or only `sheet`, laid out on pages by each sheet's own page setup
pub fn pdf(sheets: &[SheetIn], sheet: Option<&str>) -> Result<Vec<u8>, String> {
    guarded(|| {
        let (mut s, _) = build(sheets)?;
        super::sheets::add_charts(&mut s, sheets);
        if let Some(name) = sheet {
            s.execute("sheet.activate", json!({"sheet": name})).map_err(|e| e.to_string())?;
        }
        let out = s.execute("file.exportPdf", json!({"sheets": if sheet.is_some() { "active" } else { "all" }})).map_err(|e| e.to_string())?;
        let b64 = out.get("base64").and_then(|v| v.as_str()).ok_or("The PDF could not be made.")?;
        use base64::Engine;
        base64::engine::general_purpose::STANDARD.decode(b64).map_err(|e| e.to_string())
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChartSpec {
    pub range: String,
    pub kind: String,
    pub title: String,
    pub w: f32,
    pub h: f32,
}

#[tauri::command]
pub async fn sheet_sort(sheets: Vec<SheetIn>, sheet: String, range: String, column: String, descending: bool, header: bool) -> Result<Vec<SheetIn>, String> {
    tokio::task::spawn_blocking(move || sort(&sheets, &sheet, &range, &column, descending, header)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn sheet_chart(sheets: Vec<SheetIn>, sheet: String, spec: ChartSpec) -> Result<Vec<Prim>, String> {
    tokio::task::spawn_blocking(move || chart(&sheets, &sheet, &spec.range, &spec.kind, &spec.title, spec.w, spec.h)).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    fn book() -> Vec<SheetIn> {
        let cells: BTreeMap<String, String> = [("A1", "Name"), ("B1", "Qty"), ("A2", "pens"), ("B2", "30"), ("A3", "ink"), ("B3", "10"), ("A4", "pads"), ("B4", "20")].iter().map(|(a, b)| (a.to_string(), b.to_string())).collect();
        vec![SheetIn { name: "S".into(), cells, ..Default::default() }]
    }

    #[test]
    fn a_range_sorts_by_a_column_with_its_heading_kept_on_top() {
        let sorted = sort(&book(), "S", "A1:B4", "B", false, true).unwrap();
        let c = &sorted[0].cells;
        assert_eq!((c["A1"].as_str(), c["A2"].as_str(), c["A3"].as_str(), c["A4"].as_str()), ("Name", "ink", "pads", "pens"));
        let down = sort(&book(), "S", "A1:B4", "B", true, true).unwrap();
        assert_eq!(down[0].cells["A2"], "pens");
        assert!(sort(&book(), "Nope", "A1:B4", "B", false, true).is_err());
    }

    #[test]
    fn a_chart_comes_back_as_shapes_and_text_and_odd_asks_are_refused() {
        let prims = chart(&book(), "S", "A1:B4", "column", "Stock", 480.0, 300.0).unwrap();
        assert!(prims.iter().any(|p| matches!(p, Prim::Rect { .. })) && prims.iter().any(|p| matches!(p, Prim::Text { text, .. } if text == "Stock")));
        assert!(chart(&book(), "S", "A1:B4", "pie", "", 480.0, 300.0).unwrap().iter().any(|p| matches!(p, Prim::Wedge { .. })));
        assert!(chart(&book(), "S", "A1:B4", "treemap", "", 480.0, 300.0).is_err());
        assert!(chart(&book(), "S", "A1:B4", "column", "", 1.0e9, 300.0).is_err());
    }

    #[test]
    fn a_sheet_goes_out_as_a_pdf_and_charts_go_into_the_xlsx() {
        let bytes = pdf(&book(), Some("S")).unwrap();
        assert!(bytes.starts_with(b"%PDF"));
        let mut with = book();
        with[0].charts.push(super::super::sheets::ChartIn { range: "A1:B4".into(), kind: "column".into(), title: "Stock".into(), at: "D2".into(), w: 400.0, h: 260.0 });
        let plain = super::super::sheets::write_xlsx(&book()).unwrap();
        let charted = super::super::sheets::write_xlsx(&with).unwrap();
        assert!(charted.len() > plain.len(), "{} vs {}", charted.len(), plain.len());
    }
}
