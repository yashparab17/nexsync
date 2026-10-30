//! Fonts Word has but the system font folders do not: on Windows, Word downloads its newer "cloud" fonts (Aptos, the default of recent
//! Word files, among them) into the user's font cache. Without them a document set in Aptos is laid out in a stand-in whose letters are
//! a different width, and its lines break in other places than in Word. They are added to the layout engine's font list once, before
//! the first document is laid out.
//!
//! The open fonts that are metric-compatible with Word's older ones travel with the app (`assets/fonts`, all under the SIL Open Font License,
//! see `assets/fonts/README.md`): Carlito stands in for Calibri, Caladea for Cambria, and Liberation Sans, Serif and Mono for Arial, Times New
//! Roman and Courier New. A computer without Word's fonts (a Mac, a Linux machine, a phone) then lays a document out with the same line widths,
//! so its lines and pages break where they do in Word. The layout engine already prefers them as stand-ins; they only have to be in its list.

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

/// The bundled faces: (file name, bytes)
pub const BUNDLED: &[(&str, &[u8])] = &[
    ("Carlito-Regular.ttf", include_bytes!("../../../../assets/fonts/Carlito-Regular.ttf")),
    ("Carlito-Bold.ttf", include_bytes!("../../../../assets/fonts/Carlito-Bold.ttf")),
    ("Carlito-Italic.ttf", include_bytes!("../../../../assets/fonts/Carlito-Italic.ttf")),
    ("Carlito-BoldItalic.ttf", include_bytes!("../../../../assets/fonts/Carlito-BoldItalic.ttf")),
    ("Caladea-Regular.ttf", include_bytes!("../../../../assets/fonts/Caladea-Regular.ttf")),
    ("Caladea-Bold.ttf", include_bytes!("../../../../assets/fonts/Caladea-Bold.ttf")),
    ("Caladea-Italic.ttf", include_bytes!("../../../../assets/fonts/Caladea-Italic.ttf")),
    ("Caladea-BoldItalic.ttf", include_bytes!("../../../../assets/fonts/Caladea-BoldItalic.ttf")),
    ("LiberationSans-Regular.ttf", include_bytes!("../../../../assets/fonts/LiberationSans-Regular.ttf")),
    ("LiberationSans-Bold.ttf", include_bytes!("../../../../assets/fonts/LiberationSans-Bold.ttf")),
    ("LiberationSans-Italic.ttf", include_bytes!("../../../../assets/fonts/LiberationSans-Italic.ttf")),
    ("LiberationSans-BoldItalic.ttf", include_bytes!("../../../../assets/fonts/LiberationSans-BoldItalic.ttf")),
    ("LiberationSerif-Regular.ttf", include_bytes!("../../../../assets/fonts/LiberationSerif-Regular.ttf")),
    ("LiberationSerif-Bold.ttf", include_bytes!("../../../../assets/fonts/LiberationSerif-Bold.ttf")),
    ("LiberationSerif-Italic.ttf", include_bytes!("../../../../assets/fonts/LiberationSerif-Italic.ttf")),
    ("LiberationSerif-BoldItalic.ttf", include_bytes!("../../../../assets/fonts/LiberationSerif-BoldItalic.ttf")),
    ("LiberationMono-Regular.ttf", include_bytes!("../../../../assets/fonts/LiberationMono-Regular.ttf")),
    ("LiberationMono-Bold.ttf", include_bytes!("../../../../assets/fonts/LiberationMono-Bold.ttf")),
    ("LiberationMono-Italic.ttf", include_bytes!("../../../../assets/fonts/LiberationMono-Italic.ttf")),
    ("LiberationMono-BoldItalic.ttf", include_bytes!("../../../../assets/fonts/LiberationMono-BoldItalic.ttf")),
];

/// Inter, laid out where Aptos is wanted and the computer has no Aptos: Aptos, the default of recent Word files, has no metric clone, and Inter is
/// the nearest open face of its kind (a clean grotesque of about the same width)
pub const INTER: &[(&str, &[u8])] = &[
    ("Inter-Regular.ttf", include_bytes!("../../../../assets/fonts/Inter-Regular.ttf")),
    ("Inter-Bold.ttf", include_bytes!("../../../../assets/fonts/Inter-Bold.ttf")),
    ("Inter-Italic.ttf", include_bytes!("../../../../assets/fonts/Inter-Italic.ttf")),
    ("Inter-BoldItalic.ttf", include_bytes!("../../../../assets/fonts/Inter-BoldItalic.ttf")),
];

/// The families Inter answers to
pub const APTOS: &[&str] = &["Aptos", "Aptos Display"];

/// The families that Inter was added under, which the computer did not have (so a document set in them is laid out in Inter)
static ALIASED: std::sync::Mutex<Vec<String>> = std::sync::Mutex::new(Vec::new());

/// Adds Inter under the name `family`. A face the computer already has under that name (Word's own Aptos) is kept and Inter is not used; returns
/// whether Inter now answers to the name.
pub fn alias_inter(family: &str) -> bool {
    let files = INTER.iter().map(|(_, bytes)| (bytes.to_vec(), family.to_string())).collect();
    let added = wordcraft_fonts::FontDb::global().add_document_fonts(files);
    if added > 0 {
        let mut said = ALIASED.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        if !said.iter().any(|s| s.eq_ignore_ascii_case(family)) {
            said.push(family.to_string());
        }
    }
    added > 0
}

/// Which open font stands in for which of Word's (the layout engine picks them by these names when the computer has no font of the
/// requested name)
pub const STAND_INS: &[(&str, &str)] = &[("Calibri", "Carlito"), ("Cambria", "Caladea"), ("Arial", "Liberation Sans"), ("Times New Roman", "Liberation Serif"), ("Courier New", "Liberation Mono")];

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
            if aliased.iter().any(|a| a.eq_ignore_ascii_case(f)) {
                return Some(format!("{f} → Inter"));
            }
            let r = wordcraft_fonts::word::resolve(f, false, false);
            r.substituted.then(|| format!("{f} → {}", r.face.family))
        })
        .collect();
    out.sort();
    out.dedup();
    out
}

/// Every font the app adds to the layout engine: the bundled ones, then Word's downloaded ones, and last Inter for Aptos where Word's did not
/// bring it (so Word's own Aptos, when the computer has it, is the one used)
pub fn load_fonts() -> usize {
    let n = load_bundled_fonts() + load_cloud_fonts();
    n + APTOS.iter().filter(|f| alias_inter(f)).count()
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
        assert_eq!(BUNDLED.len(), 20);
        assert_eq!(INTER.len(), 4);
        for (name, bytes) in BUNDLED.iter().chain(INTER) {
            assert!(bytes.len() > 20_000 && matches!(&bytes[..4], [0, 1, 0, 0] | b"OTTO"), "{name} is a font file");
        }
        load_bundled_fonts();
        let db = wordcraft_fonts::FontDb::global();
        for (word, open) in STAND_INS {
            assert!(db.has_family(open), "{open} is in the font list, to stand in for {word}");
        }
    }

    #[test]
    fn a_family_inter_answers_to_is_laid_out_in_inter_and_named_so() {
        // (A name nobody has stands for Aptos, which this computer may have, in which case Word's is kept and Inter is not used for it)
        assert!(alias_inter("Zzyzx Aptos Test"));
        let db = wordcraft_fonts::FontDb::global();
        assert!(db.has_family("Zzyzx Aptos Test"));
        let plain = wordcraft_fonts::word::resolve("Zzyzx Aptos Test", false, false);
        let bold_italic = wordcraft_fonts::word::resolve("Zzyzx Aptos Test", true, true);
        assert!(!plain.substituted && !bold_italic.synth_bold && !bold_italic.synth_italic, "Inter has all four faces");
        assert_eq!(stand_ins(["Zzyzx Aptos Test".to_string()].iter()), vec!["Zzyzx Aptos Test → Inter".to_string()]);
        // A real family is not replaced: Carlito is there, so an alias under its name adds nothing
        load_bundled_fonts();
        assert!(!alias_inter("Carlito"));
    }

    #[test]
    fn a_font_the_computer_lacks_is_named_with_the_one_that_stands_in_for_it() {
        load_bundled_fonts();
        let fonts = ["Carlito".to_string(), "Zzyzx Display Pro".to_string()];
        let said = stand_ins(fonts.iter());
        assert_eq!(said.len(), 1, "{said:?}");
        assert!(said[0].starts_with("Zzyzx Display Pro → "), "{said:?}");
    }

    #[test]
    fn a_family_the_computer_lacks_is_laid_out_in_the_open_font_that_has_its_widths() {
        load_bundled_fonts();
        // Fonts no computer is likely to have under these names get the stand-in by name; they are not "Aptos" or other unknowns
        for (word, open) in [("Calibri", "Carlito"), ("Cambria", "Caladea"), ("Arial", "Liberation Sans"), ("Times New Roman", "Liberation Serif"), ("Courier New", "Liberation Mono")] {
            let r = wordcraft_fonts::word::resolve(open, false, false);
            assert!(!r.substituted, "{open} itself is found (for {word})");
            let bold = wordcraft_fonts::word::resolve(open, true, true);
            assert!(!bold.synth_bold && !bold.synth_italic, "{open} has a real bold italic");
        }
    }
}
