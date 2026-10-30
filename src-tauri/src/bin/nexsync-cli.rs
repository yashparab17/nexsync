//! `nexsync-cli`: the document engines of Nexsync from the command line, for scripts and CI, with no window.
//!
//! ```text
//! nexsync-cli convert report.docx report.pdf     the format is the extension of the second name
//! nexsync-cli convert report.docx report.pdf --markup --comments   a PDF showing tracked changes and the comments beside the page
//! nexsync-cli text report.docx                   the text, a line for each paragraph and table row
//! nexsync-cli inspect report.docx                what the file holds, as JSON (words, comments, tracked changes, hidden text, names, links)
//! ```
//!
//! Documents only for now (docx, docm, dotx, dotm, doc, dot, odt, rtf, md, html, txt); `--password` opens a protected file. Exit status 0 when it
//! worked, 1 when the file could not be read or written (the reason is on standard error), 2 when it was called wrongly.

use std::{path::Path, process::ExitCode};

const USAGE: &str = "Usage:
  nexsync-cli convert <from> <to> [--password <password>] [--markup] [--comments]
  nexsync-cli text <file> [--password <password>]
  nexsync-cli inspect <file> [--password <password>]

The format of `convert` is the extension of <to>: docx, odt, rtf, md, html, txt, tex or pdf.
--markup shows tracked changes and --comments prints the comments beside the page; both are for PDF files.";

struct Args {
    command: String,
    files: Vec<String>,
    password: Option<String>,
    markup: bool,
    comments: bool,
}

fn parse(args: Vec<String>) -> Result<Args, String> {
    let mut it = args.into_iter();
    let command = it.next().ok_or("No command given.")?;
    let (mut files, mut password, mut markup, mut comments) = (Vec::new(), None, false, false);
    while let Some(a) = it.next() {
        if a == "--markup" {
            markup = true;
        } else if a == "--comments" {
            comments = true;
        } else if a == "--password" {
            password = Some(it.next().ok_or("--password needs a value.")?);
        } else if a.starts_with("--") {
            return Err(format!("Unknown option {a}."));
        } else {
            files.push(a);
        }
    }
    Ok(Args { command, files, password, markup, comments })
}

fn run(a: &Args) -> Result<(), (u8, String)> {
    let usage = |m: &str| (2, m.to_string());
    let read = |path: &str| std::fs::read(path).map_err(|e| (1, format!("{path}: {e}")));
    let fail = |e: String| (1, e);
    let pw = a.password.as_deref();
    match (a.command.as_str(), a.files.as_slice()) {
        ("convert", [from, to]) => {
            let ext = Path::new(to).extension().and_then(|e| e.to_str()).ok_or_else(|| usage("The second file needs an extension that names the format."))?;
            nexsync_lib::cli::load_fonts();
            let out = nexsync_lib::cli::convert(from, &read(from)?, ext, pw, a.markup, a.comments).map_err(fail)?;
            std::fs::write(to, out).map_err(|e| (1, format!("{to}: {e}")))
        }
        ("text", [file]) => {
            println!("{}", nexsync_lib::cli::text(file, &read(file)?, pw).map_err(fail)?);
            Ok(())
        }
        ("inspect", [file]) => {
            let inspect = nexsync_lib::cli::inspect(file, &read(file)?, pw).map_err(fail)?;
            println!("{}", serde_json::to_string_pretty(&inspect).map_err(|e| (1, e.to_string()))?);
            Ok(())
        }
        ("convert", _) => Err(usage("convert takes two files: the one to read and the one to write.")),
        ("text" | "inspect", _) => Err(usage("That command takes one file.")),
        (other, _) => Err(usage(&format!("Unknown command {other}."))),
    }
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.is_empty() || args.iter().any(|a| a == "--help" || a == "-h") {
        println!("{USAGE}");
        return ExitCode::from(if args.is_empty() { 2 } else { 0 });
    }
    let parsed = match parse(args) {
        Ok(p) => p,
        Err(m) => {
            eprintln!("{m}\n\n{USAGE}");
            return ExitCode::from(2);
        }
    };
    match run(&parsed) {
        Ok(()) => ExitCode::SUCCESS,
        Err((code, message)) => {
            eprintln!("{message}");
            if code == 2 {
                eprintln!("\n{USAGE}");
            }
            ExitCode::from(code)
        }
    }
}
