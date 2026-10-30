//! Fonts Word has but the system font folders do not: on Windows, Word downloads its newer "cloud" fonts (Aptos, the default of recent
//! Word files, among them) into the user's font cache. Without them a document set in Aptos is laid out in a stand-in whose letters are
//! a different width, and its lines break in other places than in Word. They are added to the layout engine's font list once, before
//! the first document is laid out.
//!
//! The open fonts that are metric-compatible with Word's older ones travel with the app (`assets/fonts`, all under the SIL Open Font License,
//! see `assets/fonts/README.md`): Carlito stands in for Calibri, Caladea for Cambria, Arimo for Arial, Tinos for Times New
//! Roman, Cousine for Courier New, and Intos for Aptos. A computer without Word's fonts (a Mac, a Linux machine, a phone) then lays a document
//! out with the same line widths, so its lines and pages break where they do in Word. The layout engine already prefers most of them as
//! stand-ins by name, so they only have to be in its list; Intos and Cousine are added under the Word names (see `ALIASES`).

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

macro_rules! files {
    ($($f:literal),*) => { &[$(($f, include_bytes!(concat!("../../../../assets/fonts/", $f)))),*] };
}

/// The files of one font: (file name, bytes)
pub type Files = &'static [(&'static str, &'static [u8])];

/// The bundled faces added under their own names: Carlito (for Calibri), Caladea (Cambria), Arimo (Arial) and Tinos (Times New Roman). The layout
/// engine already picks each of them by name when the computer lacks the Word font. Arimo is two variable files (weight 400 to 700), which the
/// engine reads as Regular, Bold and the other named weights.
pub const BUNDLED: Files = files!(
    "Carlito-Regular.ttf",
    "Carlito-Bold.ttf",
    "Carlito-Italic.ttf",
    "Carlito-BoldItalic.ttf",
    "Caladea-Regular.ttf",
    "Caladea-Bold.ttf",
    "Caladea-Italic.ttf",
    "Caladea-BoldItalic.ttf",
    "Arimo-VF.ttf",
    "Arimo-Italic-VF.ttf",
    "Tinos-Regular.ttf",
    "Tinos-Bold.ttf",
    "Tinos-Italic.ttf",
    "Tinos-BoldItalic.ttf"
);

/// Open fonts added under the name of the Word font they stand for, which the engine has no name for or no font like: (the Word family, the open
/// font's name, its files). Each is added only when the computer has no font of the Word name (so Word's own Aptos, or Courier New, is the one
/// used when it is there).
pub const ALIASES: &[(&str, &str, Files)] = &[
    // Intos (https://github.com/muglug/intos), built to have Aptos's letter widths, kerning and line metrics, and so to break lines and pages
    // where Word does
    ("Aptos", "Intos", files!("Intos-Regular.ttf", "Intos-Bold.ttf", "Intos-Italic.ttf", "Intos-BoldItalic.ttf")),
    ("Aptos Display", "Intos", files!("IntosDisplay-Regular.ttf", "IntosDisplay-Bold.ttf", "IntosDisplay-Italic.ttf", "IntosDisplay-BoldItalic.ttf")),
    ("Aptos Narrow", "Intos", files!("IntosNarrow-Regular.ttf", "IntosNarrow-Bold.ttf", "IntosNarrow-Italic.ttf", "IntosNarrow-BoldItalic.ttf")),
    ("Aptos Serif", "Intos", files!("IntosSerif-Regular.ttf", "IntosSerif-Bold.ttf", "IntosSerif-Italic.ttf", "IntosSerif-BoldItalic.ttf")),
    // Cousine has Courier New's widths; the engine's list for it has no open mono font
    ("Courier New", "Cousine", files!("Cousine-Regular.ttf", "Cousine-Bold.ttf", "Cousine-Italic.ttf", "Cousine-BoldItalic.ttf")),
];

/// The families an open font was added under, which the computer did not have, with the open font: a document set in one is laid out in it
static ALIASED: std::sync::Mutex<Vec<(String, String)>> = std::sync::Mutex::new(Vec::new());

/// Adds `files` (the faces of one open font called `open`) under the name `family`, unless the computer has a font of that name already;
/// returns whether the open font now answers to the name.
pub fn alias_font(family: &str, open: &str, files: Files) -> bool {
    let db = wordcraft_fonts::FontDb::global();
    if db.has_family(family) {
        return false;
    }
    let added = db.add_document_fonts(files.iter().map(|(_, bytes)| (bytes.to_vec(), family.to_string())).collect());
    if added > 0 {
        let mut said = ALIASED.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        if !said.iter().any(|(f, _)| f.eq_ignore_ascii_case(family)) {
            said.push((family.to_string(), open.to_string()));
        }
    }
    added > 0
}

/// Which open font stands in for which of Word's (the layout engine picks them by these names when the computer has no font of the
/// requested name; Courier New is an alias, see [`ALIASES`])
pub const STAND_INS: &[(&str, &str)] = &[("Calibri", "Carlito"), ("Cambria", "Caladea"), ("Arial", "Arimo"), ("Times New Roman", "Tinos")];

/// Adds the bundled fonts to the layout engine's font list; returns how many faces were added
pub fn load_bundled_fonts() -> usize {
    let db = wordcraft_fonts::FontDb::global();
    BUNDLED.iter().map(|(_, bytes)| db.add_font(bytes.to_vec())).sum()
}

/// The fonts of a document the computer does not have, each with the font its text is laid out in instead, as "Aptos → Carlito"
pub fn stand_ins<'a>(fonts: impl Iterator<Item = &'a String>) -> Vec<String> {
    let aliased = ALIASED.lock().unwrap_or_else(std::sync::PoisonError::into_inner).clone();
    let mut out: Vec<String> = fonts
        .filter_map(|f| {
            if let Some((_, open)) = aliased.iter().find(|(a, _)| a.eq_ignore_ascii_case(f)) {
                return Some(format!("{f} → {open}"));
            }
            let r = wordcraft_fonts::word::resolve(f, false, false);
            r.substituted.then(|| format!("{f} → {}", r.face.family))
        })
        .collect();
    out.sort();
    out.dedup();
    out
}

/// Every font the app adds to the layout engine: the bundled ones, then Word's downloaded ones, and last the aliases for the Word families the
/// computer still lacks (so Word's own Aptos, when the computer has it, is the one used)
pub fn load_fonts() -> usize {
    let n = load_bundled_fonts() + load_cloud_fonts();
    n + ALIASES.iter().filter(|(family, open, files)| alias_font(family, open, files)).count()
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_bundled_fonts_are_all_real_faces_and_give_the_families_that_stand_in_for_word_s() {
        assert_eq!(BUNDLED.len(), 14);
        assert_eq!(ALIASES.len(), 5);
        for (name, bytes) in BUNDLED.iter().chain(ALIASES.iter().flat_map(|(_, _, files)| files.iter())) {
            assert!(bytes.len() > 20_000 && matches!(&bytes[..4], [0, 1, 0, 0] | b"OTTO"), "{name} is a font file");
        }
        load_bundled_fonts();
        let db = wordcraft_fonts::FontDb::global();
        for (word, open) in STAND_INS {
            assert!(db.has_family(open), "{open} is in the font list, to stand in for {word}");
        }
    }

    #[test]
    fn the_open_fonts_have_a_real_bold_and_italic_not_a_slanted_or_thickened_one() {
        load_bundled_fonts();
        for (_, open) in STAND_INS {
            let plain = wordcraft_fonts::word::resolve(open, false, false);
            assert!(!plain.substituted, "{open} itself is found");
            let both = wordcraft_fonts::word::resolve(open, true, true);
            assert!(!both.synth_bold && !both.synth_italic, "{open} has a real bold italic");
            let bold = wordcraft_fonts::word::resolve(open, true, false);
            assert!(!bold.synth_bold, "{open} has a real bold");
        }
    }

    #[test]
    fn a_family_an_open_font_answers_to_is_laid_out_in_it_and_named_so() {
        // (A name nobody has stands for Aptos or Courier New, which this computer may have, in which case Word's is kept and the open font is not used)
        for (open, files) in [("Intos", ALIASES[0].2), ("Cousine", ALIASES[4].2)] {
            let family = format!("Zzyzx {open} Test");
            assert!(alias_font(&family, open, files));
            let db = wordcraft_fonts::FontDb::global();
            assert!(db.has_family(&family));
            let plain = wordcraft_fonts::word::resolve(&family, false, false);
            let bold_italic = wordcraft_fonts::word::resolve(&family, true, true);
            assert!(!plain.substituted && !bold_italic.synth_bold && !bold_italic.synth_italic, "{open} has all four faces");
            assert_eq!(stand_ins([family.clone()].iter()), vec![format!("{family} → {open}")]);
        }
        // A real family is not replaced: Carlito is there, so an alias under its name adds nothing
        load_bundled_fonts();
        assert!(!alias_font("Carlito", "Cousine", ALIASES[4].2));
    }

    #[test]
    fn a_font_the_computer_lacks_is_named_with_the_one_that_stands_in_for_it() {
        load_bundled_fonts();
        let fonts = ["Carlito".to_string(), "Zzyzx Display Pro".to_string()];
        let said = stand_ins(fonts.iter());
        assert_eq!(said.len(), 1, "{said:?}");
        assert!(said[0].starts_with("Zzyzx Display Pro → "), "{said:?}");
    }
}
