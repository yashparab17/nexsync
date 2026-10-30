//! `nexsync-cli`, run as a program: files in, files and text out, and the exit status.

use std::{path::PathBuf, process::Command};

fn cli(args: &[&str]) -> std::process::Output {
    Command::new(env!("CARGO_BIN_EXE_nexsync-cli")).args(args).output().expect("the tool runs")
}

fn dir(name: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("nexsync-cli-{name}-{}", std::process::id()));
    std::fs::create_dir_all(&d).unwrap();
    d
}

fn text(o: &std::process::Output) -> String {
    String::from_utf8_lossy(&o.stdout).into_owned()
}

#[test]
fn a_markdown_file_becomes_a_docx_whose_text_is_the_same_and_a_pdf() {
    let d = dir("convert");
    let md = d.join("report.md");
    std::fs::write(&md, "# Quarterly report\n\nSales rose in the second quarter.\n\nCosts stayed flat.\n").unwrap();
    let docx = d.join("report.docx");
    let made = cli(&["convert", md.to_str().unwrap(), docx.to_str().unwrap()]);
    assert!(made.status.success(), "{}", String::from_utf8_lossy(&made.stderr));
    assert!(std::fs::read(&docx).unwrap().starts_with(b"PK"), "a docx is a zip");

    let said = cli(&["text", docx.to_str().unwrap()]);
    assert!(said.status.success());
    let t = text(&said);
    for line in ["Quarterly report", "Sales rose in the second quarter.", "Costs stayed flat."] {
        assert!(t.lines().any(|l| l.trim() == line), "{line:?} is a line of {t:?}");
    }

    let pdf = d.join("report.pdf");
    assert!(cli(&["convert", docx.to_str().unwrap(), pdf.to_str().unwrap()]).status.success());
    let bytes = std::fs::read(&pdf).unwrap();
    assert!(bytes.starts_with(b"%PDF") && bytes.len() > 1_000, "{} bytes", bytes.len());
    std::fs::remove_dir_all(&d).ok();
}

#[test]
fn inspect_says_what_the_file_holds_as_json() {
    let d = dir("inspect");
    let md = d.join("note.md");
    std::fs::write(&md, "One two three four five.\n").unwrap();
    let docx = d.join("note.docx");
    assert!(cli(&["convert", md.to_str().unwrap(), docx.to_str().unwrap()]).status.success());
    let o = cli(&["inspect", docx.to_str().unwrap()]);
    assert!(o.status.success(), "{}", String::from_utf8_lossy(&o.stderr));
    let v: serde_json::Value = serde_json::from_str(&text(&o)).expect("JSON");
    assert_eq!(v["words"], 5);
    assert_eq!(v["comments"], 0);
    assert_eq!(v["revisions"], 0);
    assert_eq!(v["hiddenWords"], 0);
    assert_eq!(v["macros"], false);
    std::fs::remove_dir_all(&d).ok();
}

#[test]
fn it_says_what_went_wrong_and_exits_with_a_status_a_script_can_read() {
    let d = dir("errors");
    // Called wrongly: 2
    assert_eq!(cli(&[]).status.code(), Some(2));
    assert_eq!(cli(&["frobnicate", "x"]).status.code(), Some(2));
    assert_eq!(cli(&["convert", "only-one.docx"]).status.code(), Some(2));
    assert_eq!(cli(&["text", "a.docx", "--nonsense"]).status.code(), Some(2));
    // A file that is not there, or not a document: 1, with the reason on standard error
    let missing = cli(&["text", d.join("missing.docx").to_str().unwrap()]);
    assert_eq!(missing.status.code(), Some(1));
    assert!(!String::from_utf8_lossy(&missing.stderr).is_empty());
    let junk = d.join("junk.docx");
    std::fs::write(&junk, b"this is not a zip file").unwrap();
    let bad = cli(&["text", junk.to_str().unwrap()]);
    assert_eq!(bad.status.code(), Some(1), "{}", String::from_utf8_lossy(&bad.stderr));
    let sheet = d.join("data.csv");
    std::fs::write(&sheet, "a,b\n1,2\n").unwrap();
    let out = d.join("out.exe");
    let refused = cli(&["convert", junk.to_str().unwrap(), out.to_str().unwrap()]);
    assert_eq!(refused.status.code(), Some(1));
    assert!(!out.exists(), "nothing is written when it fails");
    // Help is not an error
    assert_eq!(cli(&["--help"]).status.code(), Some(0));
    std::fs::remove_dir_all(&d).ok();
}

#[test]
fn markup_and_comments_are_for_pdf_files_only() {
    let d = dir("markup");
    let md = d.join("a.md");
    std::fs::write(&md, "Some text.\n").unwrap();
    let docx = d.join("a.docx");
    assert!(cli(&["convert", md.to_str().unwrap(), docx.to_str().unwrap()]).status.success());
    let pdf = d.join("a.pdf");
    let ok = cli(&["convert", docx.to_str().unwrap(), pdf.to_str().unwrap(), "--markup", "--comments"]);
    assert!(ok.status.success(), "{}", String::from_utf8_lossy(&ok.stderr));
    assert!(std::fs::read(&pdf).unwrap().starts_with(b"%PDF"));
    let txt = d.join("a.txt");
    let no = cli(&["convert", docx.to_str().unwrap(), txt.to_str().unwrap(), "--markup"]);
    assert_eq!(no.status.code(), Some(1));
    assert!(String::from_utf8_lossy(&no.stderr).contains("PDF"), "{}", String::from_utf8_lossy(&no.stderr));
    assert!(!txt.exists());
    std::fs::remove_dir_all(&d).ok();
}
