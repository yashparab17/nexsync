//! Fonts Word has but the system font folders do not: on Windows, Word downloads its newer "cloud" fonts (Aptos, the default of recent
//! Word files, among them) into the user's font cache. Without them a document set in Aptos is laid out in a stand-in whose letters are
//! a different width, and its lines break in other places than in Word. They are added to the layout engine's font list once, before
//! the first document is laid out.

use std::path::{Path, PathBuf};

/// Most font files read from the cache, and the largest one read (a cache holds a few hundred files at most)
const MAX_FILES: usize = 400;
const MAX_BYTES: u64 = 24 * 1024 * 1024;

/// Where Word keeps the fonts it downloaded (`%LOCALAPPDATA%\Microsoft\FontCache\4\CloudFonts`); nothing on other systems
pub fn cloud_font_dir() -> Option<PathBuf> {
    if !cfg!(windows) {
        return None;
    }
    let dir = PathBuf::from(std::env::var_os("LOCALAPPDATA")?).join("Microsoft").join("FontCache").join("4").join("CloudFonts");
    dir.is_dir().then_some(dir)
}

fn font_files(dir: &Path, out: &mut Vec<PathBuf>, depth: usize) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for e in entries.flatten() {
        let p = e.path();
        if out.len() >= MAX_FILES {
            return;
        }
        if p.is_dir() && depth < 2 {
            font_files(&p, out, depth + 1);
        } else if p.extension().and_then(|x| x.to_str()).is_some_and(|x| ["ttf", "otf", "ttc"].contains(&x.to_ascii_lowercase().as_str())) {
            out.push(p);
        }
    }
}

/// Adds the cloud fonts to the layout engine's font list; returns how many faces were added
pub fn load_cloud_fonts() -> usize {
    let Some(dir) = cloud_font_dir() else { return 0 };
    let mut files = Vec::new();
    font_files(&dir, &mut files, 0);
    let db = wordcraft_fonts::FontDb::global();
    files
        .iter()
        .filter(|p| std::fs::metadata(p).is_ok_and(|m| m.len() <= MAX_BYTES))
        .filter_map(|p| std::fs::read(p).ok())
        .map(|bytes| db.add_font(bytes))
        .sum()
}
