//! Development only: how wide a text is in a font under different OpenType feature settings, to find which settings Word's line
//! widths agree with. `cargo run --example office_width -- "Inter" 12 "text"`; or with `-` as the text, lines `x0<TAB>x1<TAB>text`
//! on standard input (a line's extent in Word's PDF) are compared with the shaper's width.

use std::io::BufRead;

fn width(face: &wordcraft_fonts::FontFace, text: &str, feats: &[&str], size: f64) -> f64 {
    let f: Vec<_> = feats.iter().filter_map(|t| wordcraft_fonts::feature(t)).collect();
    let g = wordcraft_fonts::shape(face, text, &f, |c| c);
    g.iter().map(|x| x.x_advance).sum::<i32>() as f64 * size / face.upem
}

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let (family, size) = (&a[1], a[2].parse::<f64>().unwrap());
    let r = wordcraft_fonts::word::resolve(family, a.get(4).is_some_and(|b| b == "bold"), false);
    let face = r.face.get();
    if a[3] == "-" {
        let (mut n, mut sum_word, mut sum_k, mut sum_nk) = (0, 0.0, 0.0, 0.0);
        for l in std::io::stdin().lock().lines().map_while(Result::ok) {
            let p: Vec<&str> = l.splitn(3, '\t').collect();
            if p.len() < 3 {
                continue;
            }
            let word = p[1].parse::<f64>().unwrap() - p[0].parse::<f64>().unwrap();
            let env = std::env::var("FEATS").unwrap_or_default();
            let fs: Vec<&str> = env.split(',').filter(|x| !x.is_empty()).collect();
            let (k, nk) = (width(face, p[2], &fs, size), width(face, p[2], &[&fs[..], &["-kern"]].concat(), size));
            let spaces = p[2].matches(' ').count();
            println!("word {word:7.2}  kern {k:7.2} ({:+.2})  nokern {nk:7.2} ({:+.2})  spaces {spaces}  {}", word - k, word - nk, p[2].chars().take(40).collect::<String>());
            n += 1;
            sum_word += word;
            sum_k += k;
            sum_nk += nk;
        }
        println!("{n} lines: Word {sum_word:.1}, kerned {sum_k:.1} ({:+.3}%), unkerned {sum_nk:.1} ({:+.3}%)", (sum_word / sum_k - 1.0) * 100.0, (sum_word / sum_nk - 1.0) * 100.0);
        return;
    }
    println!("face {} {} upem {}", r.face.family, r.face.style, face.upem);
    for (name, feats) in [("default (kern on)", vec![]), ("-kern", vec!["-kern"]), ("tnum", vec!["tnum"]), ("ss04", vec!["ss04"])] {
        println!("{name:22} {:.2} pt", width(face, &a[3], &feats, size));
    }
}
