//! Spelling and grammar (Phase 21): the proofing of WordCraft (MIT OR Apache-2.0, pinned by commit, see THIRD_PARTY_NOTICES.md) over the
//! text of a document. It reports each problem word once, with what is wrong and what to write instead; the editor changes the word
//! where it stands. The English word list is built in, nothing is sent anywhere.

use serde::Serialize;
use wordcraft_proof::{check_text_with, suggest, IssueKind, Options, ProofLang};

const MAX_TEXT: usize = 8 * 1024 * 1024;
const MAX_PROBLEMS: usize = 300;

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Problem {
    /// The text the problem is in, as written
    pub text: String,
    /// `spelling` or `grammar`
    pub kind: &'static str,
    pub message: String,
    pub suggestions: Vec<String>,
}

/// The problems in `text`, each distinct one once, in the order they first appear
pub fn check(text: &str) -> Result<Vec<Problem>, String> {
    if text.len() > MAX_TEXT {
        return Err("This document is too long to check.".to_string());
    }
    let mut out: Vec<Problem> = Vec::new();
    for issue in std::panic::catch_unwind(|| check_text_with(text, &[(0..text.len(), ProofLang::En)], &Options::default(), true, false)).map_err(|_| "The check could not be done.".to_string())? {
        let Some(said) = text.get(issue.start..issue.end) else { continue };
        let kind = if issue.kind == IssueKind::Spelling { "spelling" } else { "grammar" };
        if out.iter().any(|p| p.text == said && p.kind == kind) {
            continue;
        }
        let suggestions = if issue.kind == IssueKind::Spelling { suggest(said, 6) } else { issue.suggestions.into_iter().take(6).collect() };
        out.push(Problem { text: said.to_string(), kind, message: issue.message, suggestions });
        if out.len() >= MAX_PROBLEMS {
            break;
        }
    }
    Ok(out)
}

#[tauri::command]
pub async fn proof_check(text: String) -> Result<Vec<Problem>, String> {
    tokio::task::spawn_blocking(move || check(&text)).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_misspelled_word_is_reported_once_with_suggestions_and_good_text_is_clean() {
        let found = check("This sentense has numbers. The sentense is short.").unwrap();
        let spelling: Vec<_> = found.iter().filter(|p| p.kind == "spelling").collect();
        assert_eq!(spelling.len(), 1, "{found:?}");
        assert_eq!(spelling[0].text, "sentense");
        assert!(spelling[0].suggestions.iter().any(|s| s == "sentence"), "{:?}", spelling[0].suggestions);
        assert!(check("The report is ready for review.").unwrap().iter().all(|p| p.kind != "spelling"));
        assert!(check(&"a ".repeat(5 * 1024 * 1024)).is_err());
    }
}
