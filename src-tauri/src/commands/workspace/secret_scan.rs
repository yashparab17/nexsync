//! A look for secrets in text that is about to be shared (Phase 20, step 4): provider keys, private key blocks, tokens with known
//! prefixes and `password = "..."` lines. It is a heuristic. It misses secrets that look like anything else and flags some harmless
//! text, so what it finds is a warning with the line, never a block, and the person can leave a file on their own device or allow it.

use std::sync::LazyLock;

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

/// What looks like a secret in `text`, one finding per line at most, in line order
pub fn scan_text(text: &str) -> Vec<Finding> {
    let mut out = Vec::new();
    for (i, line) in text.lines().enumerate() {
        if line.len() > 2_000 {
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
    fn example_files_are_left_alone() {
        assert!(is_example_file(".env.example") && is_example_file("config.sample.json") && !is_example_file("config.json"));
    }
}
