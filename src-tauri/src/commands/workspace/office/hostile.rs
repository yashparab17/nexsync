//! Hostile-file tests for the document importer (Phase 21, untrusted file rules): a file from a teammate or the web must never close
//! the app, hang it, expand into memory, fetch anything or run anything. Each file is opened on a thread, as a command does.

use super::documents::import;

const W: &str = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

/// A minimal .docx whose body is `body` (inside w:body), after `doctype`, with `extra` more parts
fn package(doctype: &str, body: &str, extra: &[(&str, &str)]) -> Vec<u8> {
    use std::io::Write;
    let mut buf = std::io::Cursor::new(Vec::new());
    let mut w = zip::ZipWriter::new(&mut buf);
    let opts = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    let doc = format!(r#"<?xml version="1.0"?>{doctype}<w:document xmlns:w="{W}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>{body}</w:body></w:document>"#);
    let types = r#"<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>"#;
    let rels = r#"<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>"#;
    for (name, text) in [("[Content_Types].xml", types), ("_rels/.rels", rels), ("word/document.xml", &doc)].into_iter().chain(extra.iter().copied()) {
        w.start_file(name, opts).unwrap();
        w.write_all(text.as_bytes()).unwrap();
    }
    w.finish().unwrap();
    buf.into_inner()
}

/// Opens a hostile file on a thread and says whether it came back within 20 s, whatever it answered
fn opens_in_time(name: &'static str, bytes: Vec<u8>) -> bool {
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let _ = import(name, &bytes, None);
        let _ = tx.send(());
    });
    rx.recv_timeout(std::time::Duration::from_secs(20)).is_ok()
}

#[test]
fn an_entity_bomb_is_not_expanded() {
    let mut dtd = String::from(r#"<!DOCTYPE w:document [<!ENTITY a0 "aaaaaaaaaa">"#);
    for i in 1..10 {
        dtd.push_str(&format!(r#"<!ENTITY a{i} "{}">"#, format!("&a{};", i - 1).repeat(10)));
    }
    dtd.push_str("]>");
    let bytes = package(&dtd, "<w:p><w:r><w:t>&a9;</w:t></w:r></w:p>", &[]);
    assert!(opens_in_time("bomb.docx", bytes.clone()));
    // Whatever it shows, it is not the expanded text (10^10 characters)
    if let Ok(i) = import("bomb.docx", &bytes, None) {
        assert!(serde_json::to_string(&i.blocks).unwrap().len() < 1_000_000, "the entity was expanded");
    }
}

#[test]
fn deeply_nested_markup_does_not_overflow_the_stack() {
    for (name, open, close) in [("tables", "<w:tbl><w:tr><w:tc>", "</w:tc></w:tr></w:tbl>"), ("runs", "<w:p><w:r>", "</w:r></w:p>"), ("sdt", "<w:sdt><w:sdtContent>", "</w:sdtContent></w:sdt>")] {
        let depth = 20_000;
        let body = format!("{}<w:p/>{}", open.repeat(depth), close.repeat(depth));
        assert!(opens_in_time("deep.docx", package("", &body, &[])), "{name}");
    }
}

#[test]
fn malformed_and_truncated_packages_are_refused_not_fatal() {
    let good = package("", "<w:p><w:r><w:t>Hello</w:t></w:r></w:p>", &[]);
    assert!(import("g.docx", &good, None).is_ok());
    for cut in [10, good.len() / 3, good.len() / 2, good.len() - 5] {
        assert!(opens_in_time("cut.docx", good[..cut].to_vec()));
    }
    for body in ["<w:p><w:r><w:t>unclosed", "<w:p></w:r>", "<w:tbl><w:tr><w:tc></w:tr></w:tbl>", "<w:p><w:r><w:t>\u{0}\u{1}</w:t></w:r></w:p>"] {
        assert!(opens_in_time("bad.docx", package("", body, &[])), "{body}");
    }
    // A part list that is far too long
    let mut many = Vec::new();
    {
        use std::io::Write;
        let mut w = zip::ZipWriter::new(std::io::Cursor::new(&mut many));
        for i in 0..20_001 {
            w.start_file(format!("p{i}.xml"), zip::write::SimpleFileOptions::default()).unwrap();
            w.write_all(b"x").unwrap();
        }
        w.finish().unwrap();
    }
    assert!(import("many.docx", &many, None).unwrap_err().message.contains("too many parts"));
}

#[test]
fn a_remote_picture_is_listed_and_never_fetched_and_macros_are_noticed_not_run() {
    // A picture linked to an address: nothing connects (a listener on a free port sees no request)
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let url = format!("http://{}/x.png", listener.local_addr().unwrap());
    let rels = format!(
        r#"<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="{url}" TargetMode="External"/></Relationships>"#
    );
    let body = r#"<w:p><w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wp:extent cx="914400" cy="914400"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:blipFill><a:blip r:link="rId9"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>"#;
    let bytes = package("", body, &[("word/_rels/document.xml.rels", &rels), ("word/vbaProject.bin", "macro")]);
    let i = import("m.docm", &bytes, None).unwrap();
    assert!(i.inspect.external.iter().any(|t| t.contains("/x.png")), "the address is listed for the person to see");
    assert!(i.inspect.macros, "the macro part is noticed");
    assert!(listener.accept().is_err(), "nothing connected to the address");
}

#[test]
fn table_structure_goes_through_a_docx_and_back() {
    use super::documents::export;
    let html = "<table><thead><tr><th>Name</th><th colspan=\"2\">Scores</th></tr></thead><tbody><tr><td rowspan=\"2\">Ana</td><td>1</td><td>2</td></tr><tr><td>3</td><td>4</td></tr></tbody></table>";
    let bytes = export("docx", html, "T", "A", None).unwrap();
    use std::io::Read;
    let mut z = zip::ZipArchive::new(std::io::Cursor::new(bytes.clone())).unwrap();
    let mut xml = String::new();
    z.by_name("word/document.xml").unwrap().read_to_string(&mut xml).unwrap();
    assert!(xml.contains("<w:gridSpan"), "a merged cell across columns: {xml}");
    assert!(xml.contains("<w:vMerge"), "a merged cell down rows");
    assert!(xml.contains("<w:tblHeader"), "the header row repeats on each page");
    let back = import("t.docx", &bytes, None).unwrap();
    let json = serde_json::to_string(&back.blocks).unwrap();
    assert!(json.contains("\"colspan\":2") && json.contains("\"rowspan\":2"), "{json}");
}
