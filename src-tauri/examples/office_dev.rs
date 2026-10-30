//! Development only: serves the office engines (documents, sheets, slides) over HTTP on 127.0.0.1:7878 so the editors can be tried in a
//! browser with `npm run dev`, without the desktop shell. `cargo run --example office_dev` in `src-tauri`. Nothing here is part of the app.

use std::{
    io::{Read, Write},
    net::{TcpListener, TcpStream},
};

use nexsync_lib::lab::{deck, fonts, office, sheet_tools, sheets};
use serde_json::{json, Value};

fn call(cmd: &str, a: &Value) -> Result<Value, String> {
    let s = |k: &str| a.get(k).and_then(Value::as_str).unwrap_or("").to_string();
    let n = |k: &str| a.get(k).and_then(Value::as_f64).unwrap_or(0.0);
    let ok = |v: Result<Value, serde_json::Error>| v.map_err(|e| e.to_string());
    match cmd {
        "get_tasks" => Ok(json!([
            {"id": "t1", "title": "Write report", "description": "", "status": "todo", "priority": "high", "tags": ["docs"], "created_at": "", "updated_at": ""},
            {"id": "t2", "title": "Fix bug", "description": "", "status": "done", "priority": "low", "due_date": "2026-11-01", "tags": [], "created_at": "", "updated_at": ""}
        ])),
        "get_kanban" => Ok(json!([{"id": "c1", "title": "Doing", "position": 0, "cards": [{"id": "k1", "title": "Ship it", "description": "", "column_id": "c1", "position": 0, "tags": [], "checklist": [], "created_at": "", "updated_at": ""}]}])),
        "sheet_calculate" => ok(serde_json::to_value(sheets::calculate(&serde_json::from_value::<Vec<sheets::SheetIn>>(a["sheets"].clone()).map_err(|e| e.to_string())?)?)),
        "sheet_write_file" => {
            let book = serde_json::from_value::<Vec<sheets::SheetIn>>(a["sheets"].clone()).map_err(|e| e.to_string())?;
            let bytes = sheets::write_xlsx(&book)?;
            std::fs::write(s("path"), &bytes).map_err(|e| e.to_string())?;
            Ok(json!(bytes.len()))
        }
        "sheet_restructure" => {
            let op = serde_json::from_value(a["op"].clone()).map_err(|e| e.to_string())?;
            ok(serde_json::to_value(sheets::restructure(&serde_json::from_value::<Vec<sheets::SheetIn>>(a["sheets"].clone()).map_err(|e| e.to_string())?, &s("sheet"), op, n("at") as u32, n("count") as u32)?))
        }
        "sheet_sort" => ok(serde_json::to_value(sheet_tools::sort(&serde_json::from_value::<Vec<sheets::SheetIn>>(a["sheets"].clone()).map_err(|e| e.to_string())?, &s("sheet"), &s("range"), &s("column"), a["descending"].as_bool().unwrap_or(false), a["header"].as_bool().unwrap_or(false))?)),
        "sheet_chart" => {
            let spec = &a["spec"];
            let g = |k: &str| spec.get(k).and_then(Value::as_str).unwrap_or("").to_string();
            let f = |k: &str| spec.get(k).and_then(Value::as_f64).unwrap_or(0.0) as f32;
            let opts: sheets::ChartOpts = serde_json::from_value(spec.get("opts").cloned().unwrap_or(Value::Null)).unwrap_or_default();
            ok(serde_json::to_value(sheet_tools::chart_with(&serde_json::from_value::<Vec<sheets::SheetIn>>(a["sheets"].clone()).map_err(|e| e.to_string())?, &s("sheet"), &g("range"), &g("kind"), &g("title"), f("w"), f("h"), &opts)?))
        }
        "deck_edit_slide" => Ok(json!(deck::edit_slide(&s("slide"), &serde_json::from_value(a["edit"].clone()).map_err(|e| e.to_string())?)?)),
        "deck_add_picture" => {
            let (b, sh) = deck::add_picture(&s("base"), &s("name"), &s("data"), n("id") as u32, n("x"), n("y"), n("w"), n("h"))?;
            Ok(json!([b, sh]))
        }
        "office_import_file" => {
            let path = s("path");
            let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
            let o = office::import(&path, &bytes, None).map_err(|e| e.message)?;
            ok(serde_json::to_value(o))
        }
        "office_layout" => {
            let layout = serde_json::from_value(a["layout"].clone()).ok();
            let src = a.get("sourceId").and_then(Value::as_str);
            ok(serde_json::to_value(office::lay_out(&s("html"), &s("title"), layout.as_ref(), src)?))
        }
        "office_page" => ok(serde_json::to_value(office::draw_page(n("session") as u64, n("index") as usize, n("scale") as f32)?)),
        "office_margins" => ok(serde_json::to_value(office::draw_margins(&s("sourceId"), n("pages") as usize, n("index") as usize, n("scale") as f32)?)),
        "office_render" => ok(serde_json::to_value(office::render_pages(&s("html"), &s("title"), None, n("scale") as f32)?)),
        "deck_new" => ok(serde_json::to_value(deck::blank()?)),
        "deck_open_file" => {
            let path = s("path");
            ok(serde_json::to_value(deck::open(&path, &std::fs::read(&path).map_err(|e| e.to_string())?)?))
        }
        "deck_register" => Ok(json!(deck::register(&s("base"))?)),
        "deck_render" => ok(serde_json::to_value(deck::render(&s("baseId"), &s("slide"), n("scale"))?)),
        "deck_layouts" => ok(serde_json::to_value(deck::layouts(&s("baseId"))?)),
        "deck_new_slide" => Ok(json!(deck::new_slide(&s("baseId"), n("layout") as u32)?)),
        "deck_new_shape" => Ok(json!(deck::new_shape(&s("kind"), n("id") as u32, n("x"), n("y"), n("w"), n("h"))?)),
        "deck_edit_shape" => Ok(json!(deck::edit_shape(&s("shape"), &serde_json::from_value(a["edit"].clone()).map_err(|e| e.to_string())?)?)),
        "office_export_html" => {
            let layout: Option<office::Layout> = serde_json::from_value(a["layout"].clone()).ok();
            let bytes = office::export_with(&s("ext"), &s("html"), &s("title"), &s("author"), layout.as_ref(), a.get("sourceId").and_then(Value::as_str))?;
            if let Some(path) = a.get("path").and_then(Value::as_str) {
                std::fs::write(path, &bytes).map_err(|e| e.to_string())?;
            }
            Ok(json!(bytes.len()))
        }
        other => Err(format!("The lab does not serve {other}")),
    }
}

fn handle(mut stream: TcpStream) {
    let mut buf = Vec::new();
    let mut chunk = [0u8; 65536];
    let (mut head_end, mut want) = (None, 0usize);
    loop {
        let n = stream.read(&mut chunk).unwrap_or(0);
        if n == 0 {
            break;
        }
        buf.extend_from_slice(&chunk[..n]);
        if head_end.is_none() {
            if let Some(i) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
                head_end = Some(i + 4);
                let head = String::from_utf8_lossy(&buf[..i]).to_lowercase();
                want = head.lines().find_map(|l| l.strip_prefix("content-length:")).and_then(|v| v.trim().parse().ok()).unwrap_or(0);
            }
        }
        if let Some(h) = head_end {
            if buf.len() >= h + want {
                break;
            }
        }
    }
    let cors = "Access-Control-Allow-Origin: *\r\nAccess-Control-Allow-Headers: *\r\nAccess-Control-Allow-Methods: POST, OPTIONS\r\n";
    let Some(h) = head_end else { return };
    if buf.starts_with(b"OPTIONS") {
        let _ = stream.write_all(format!("HTTP/1.1 204 No Content\r\n{cors}Content-Length: 0\r\n\r\n").as_bytes());
        return;
    }
    let body: Value = serde_json::from_slice(&buf[h..]).unwrap_or(Value::Null);
    let cmd = body.get("cmd").and_then(Value::as_str).unwrap_or("");
    let (code, out) = match call(cmd, body.get("args").unwrap_or(&Value::Null)) {
        Ok(v) => (200, json!({"ok": v})),
        Err(e) => (200, json!({"err": e})),
    };
    let text = out.to_string();
    let _ = stream.write_all(format!("HTTP/1.1 {code} OK\r\n{cors}Content-Type: application/json\r\nContent-Length: {}\r\n\r\n{text}", text.len()).as_bytes());
}

fn main() {
    eprintln!("cloud fonts added: {}", fonts::load_cloud_fonts());
    let listener = TcpListener::bind("127.0.0.1:7878").expect("port 7878 is busy");
    eprintln!("office lab on http://127.0.0.1:7878");
    for stream in listener.incoming().flatten() {
        std::thread::spawn(move || handle(stream));
    }
}
