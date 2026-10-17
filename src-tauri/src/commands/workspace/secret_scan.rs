//! A look for secrets in text that is about to be shared (Phase 20, step 4): provider keys, private key blocks, tokens with known
//! prefixes and `password = "..."` lines. It is a heuristic. It misses secrets that look like anything else and flags some harmless
//! text, so what it finds is a warning with the line, never a block, and the person can leave a file on their own device or allow it.

use std::{collections::{HashMap, HashSet}, fs, path::{Path, PathBuf}, sync::{LazyLock, Mutex}};

use regex::Regex;
use serde::Serialize;

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Finding {
    pub line: usize,
    pub kind: &'static str,
}

struct Pattern {
    kind: &'static str,
    re: Regex,
}

static PATTERNS: LazyLock<Vec<Pattern>> = LazyLock::new(|| {
    [
        ("A private key", r"-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY"),
        ("An AWS access key", r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b"),
        ("A GitHub token", r"\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b|\bgithub_pat_[A-Za-z0-9_]{50,}\b"),
        ("A Slack token", r"\bxox[abprs]-[A-Za-z0-9-]{10,}"),
        ("A Google API key", r"\bAIza[0-9A-Za-z_-]{35}\b"),
        ("A Stripe live key", r"\b[sr]k_live_[0-9a-zA-Z]{20,}\b"),
        ("An npm token", r"\bnpm_[A-Za-z0-9]{36}\b"),
        ("A password or key written into the file", r#"(?i)\b(?:password|passwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token|private[_-]?key)\b["']?\s*[:=]\s*["']([^"'\s]{8,})["']"#),
    ]
    .into_iter()
    .map(|(kind, re)| Pattern { kind, re: Regex::new(re).unwrap() })
    .collect()
});

/// Values that are plainly stand-ins, so `password = "changeme"` in an example is not reported
fn placeholder(value: &str) -> bool {
    let v = value.to_lowercase();
    v.starts_with('<') || v.starts_with("${") || v.starts_with("{{") || v.starts_with("%")
        || ["changeme", "change-me", "your", "example", "placeholder", "xxxx", "****", "todo", "redacted", "dummy", "sample", "test", "secret", "password", "process.env", "env."].iter().any(|p| v.contains(p))
        || v.chars().all(|c| c == v.chars().next().unwrap_or('x'))
}

/// Every word any pattern needs, as one expression the engine searches for all at once: almost all source text has none of them, so
/// the per-line patterns below run only on the files and lines that could match
static NEEDS_A_LOOK: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)AKIA|ASIA|ghp_|gho_|ghu_|ghs_|ghr_|github_pat_|xox[abprs]-|AIza|_live_|npm_|PRIVATE KEY|passw|secret|api[_-]?key|access[_-]?token|auth[_-]?token|private[_-]?key").unwrap());

/// What looks like a secret in `text`, one finding per line at most, in line order
pub fn scan_text(text: &str) -> Vec<Finding> {
    let mut out = Vec::new();
    if !NEEDS_A_LOOK.is_match(text) {
        return out;
    }
    for (i, line) in text.lines().enumerate() {
        if line.len() > 2_000 || !NEEDS_A_LOOK.is_match(line) {
            continue;
        }
        for p in PATTERNS.iter() {
            let Some(c) = p.re.captures(line) else { continue };
            // The last pattern has the value in a group; the others are the secret itself
            if c.len() > 1 && c.get(1).is_some_and(|v| placeholder(v.as_str())) {
                continue;
            }
            out.push(Finding { line: i + 1, kind: p.kind });
            break;
        }
    }
    out
}

/// Files looked into: small ones, and only text (a zero byte early on says it is not)
pub const MAX_BYTES: u64 = 512 * 1024;

pub fn findings_in_file(path: &Path) -> Vec<Finding> {
    let Ok(bytes) = fs::read(path) else { return Vec::new() };
    if bytes.len() as u64 > MAX_BYTES || bytes[..bytes.len().min(1024)].contains(&0) {
        return Vec::new();
    }
    scan_text(&String::from_utf8_lossy(&bytes))
}

fn allowed_file(root: &Path) -> PathBuf {
    root.join(".nexsync").join("secret-allowed.json")
}

/// The files in `projects/` this device's owner said are fine to share although they look like they hold a secret
pub fn allowed(root: &Path) -> HashSet<String> {
    fs::read_to_string(allowed_file(root)).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

pub fn allow(root: &Path, rel: &str) -> Result<(), String> {
    if !rel.starts_with("projects/") || rel.contains("..") {
        return Err("That is not a project file.".to_string());
    }
    let mut all = allowed(root);
    all.insert(rel.to_string());
    fs::create_dir_all(root.join(".nexsync")).map_err(|e| e.to_string())?;
    fs::write(allowed_file(root), serde_json::to_string(&all).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

/// What the last look at each file found, with the size and time it had then
/// Size, time and whether it looked like a secret
type Looked = (u64, u128, bool);
static LOOKED: LazyLock<Mutex<HashMap<PathBuf, Looked>>> = LazyLock::new(|| Mutex::new(HashMap::new()));

/// Files kept from collaborators until the person decides: a project file that looks like it holds a secret is not listed, sent or
/// served until they choose Keep on This Device (a rule in `.nexignore`) or It Is Fine
pub struct Withhold {
    root: PathBuf,
    allowed: HashSet<String>,
}

impl Withhold {
    pub fn load(root: &Path) -> Self {
        Self { root: root.to_path_buf(), allowed: allowed(root) }
    }

    /// For one file with no listing at hand: looks the time up
    pub fn check(&self, rel: &str, size: u64) -> bool {
        self.check_at(rel, size, fs::metadata(self.root.join(rel)).ok().and_then(|m| m.modified().ok()))
    }

    /// The same, for a walk that already has the file's size and time from the directory listing, which costs nothing more
    pub fn check_at(&self, rel: &str, size: u64, modified: Option<std::time::SystemTime>) -> bool {
        if !rel.starts_with("projects/") || size > MAX_BYTES || self.allowed.contains(rel) || is_example_file(rel.rsplit('/').next().unwrap_or("")) {
            return false;
        }
        let path = self.root.join(rel);
        // A file is read again only when it changed since the last look: a listing is made on every connect and for every bundle
        let stamp = modified.and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_nanos());
        if let Some(stamp) = stamp {
            if let Some((len, at, hit)) = LOOKED.lock().unwrap_or_else(|p| p.into_inner()).get(&path) {
                if *len == size && *at == stamp {
                    return *hit;
                }
            }
        }
        let hit = !findings_in_file(&path).is_empty();
        if let Some(stamp) = stamp {
            let mut cache = LOOKED.lock().unwrap_or_else(|p| p.into_inner());
            if cache.len() > 200_000 {
                cache.clear();
            }
            cache.insert(path, (size, stamp, hit));
        }
        hit
    }
}

/// Files that exist to show the shape of a secret, not to hold one
pub fn is_example_file(name: &str) -> bool {
    let n = name.to_lowercase();
    ["example", "sample", "template", "fixture", ".test.", ".spec.", "readme"].iter().any(|p| n.contains(p))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn kinds(text: &str) -> Vec<(usize, &'static str)> {
        scan_text(text).into_iter().map(|f| (f.line, f.kind)).collect()
    }

    #[test]
    fn keys_and_tokens_are_found_by_their_shape() {
        // Built in pieces, so this file does not itself contain what a secret scanner (GitHub's push protection) looks for
        let text = format!("ok\nconst id = \"{}{}\";\n-----BEGIN OPENSSH {} KEY-----\nlet t = '{}_{}';\nSTRIPE={}_{}_{}\n", "AKIA", "ABCDEFGHIJKLMNOP", "PRIVATE", "ghp", "abcdefghijklmnopqrstuvwxyz0123456789", "sk", "live", "abcdefghijklmnopqrstuvwx");
        assert_eq!(kinds(&text), [(2, "An AWS access key"), (3, "A private key"), (4, "A GitHub token"), (5, "A Stripe live key")]);
    }

    #[test]
    fn a_password_written_into_a_file_is_found_but_stand_ins_are_not() {
        assert_eq!(kinds("db.password = \"s3cr3t-Value-91\"\n"), [(1, "A password or key written into the file")]);
        assert_eq!(kinds("{ \"apiKey\": \"a1b2c3d4e5f6\" }\n"), [(1, "A password or key written into the file")]);
        for harmless in ["password = \"changeme\"", "api_key = \"${API_KEY}\"", "password: \"<your password>\"", "secret = \"xxxxxxxxxx\"", "token = process.env.TOKEN", "const password = getPassword()"] {
            assert!(scan_text(harmless).is_empty(), "{harmless}");
        }
    }

    #[test]
    fn a_file_that_looks_like_it_holds_a_secret_is_withheld_until_allowed() {
        let ws = std::env::temp_dir().join(format!("nexsync-withhold-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(ws.join("projects/app")).unwrap();
        std::fs::write(ws.join("projects/app/config.ts"), format!("export const k = '{}{}';\n", "AKIA", "ABCDEFGHIJKLMNOP")).unwrap();
        std::fs::write(ws.join("projects/app/ok.ts"), "export const a = 1;\n").unwrap();
        assert!(Withhold::load(&ws).check("projects/app/config.ts", 60));
        assert!(!Withhold::load(&ws).check("projects/app/ok.ts", 20));
        allow(&ws, "projects/app/config.ts").unwrap();
        assert!(!Withhold::load(&ws).check("projects/app/config.ts", 60));
        assert!(allow(&ws, "../../etc/passwd").is_err());
        let _ = std::fs::remove_dir_all(ws);
    }

    #[test]
    fn example_files_are_left_alone() {
        assert!(is_example_file(".env.example") && is_example_file("config.sample.json") && !is_example_file("config.json"));
    }
}
