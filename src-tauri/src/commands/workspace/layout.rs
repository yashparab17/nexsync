//! Where things live in a workspace folder. One place says it, so the rest of the app names a folder by what it is for and never by
//! spelling a path out:
//!
//! ```text
//! <workspace>/
//!   .nexsync/            the workspace's own data (never shared as files)
//!   office/
//!     documents/         .docx .doc .odt .rtf
//!     sheets/            .xlsx .xls .ods .csv
//!     slides/            .pptx
//!   notes/               Markdown notes
//!   projects/            code projects
//!   assets/              pictures, audio, video, fonts
//!   others/              anything else a team keeps together (PDFs, archives, drafts)
//!   tasks/  kanban/      reserved
//! ```

pub const OFFICE: &str = "office";
pub const DOCUMENTS: &str = "office/documents";
pub const SHEETS: &str = "office/sheets";
pub const SLIDES: &str = "office/slides";
pub const NOTES: &str = "notes";
pub const PROJECTS: &str = "projects";
pub const ASSETS: &str = "assets";
pub const OTHERS: &str = "others";
pub const TASKS: &str = "tasks";
pub const KANBAN: &str = "kanban";

/// Every folder made when a workspace is made
pub const CREATED: &[&str] = &[DOCUMENTS, SHEETS, SLIDES, NOTES, PROJECTS, ASSETS, OTHERS, TASKS, KANBAN];

/// The top-level folders whose contents are shared with collaborators
pub const SYNCED: &[&str] = &[NOTES, OFFICE, OTHERS, ASSETS, PROJECTS];

/// The top-level folders a path inside the workspace may start with (the first is named in the message when one does not)
pub const ALLOWED: &[&str] = &[NOTES, OFFICE, OTHERS, ASSETS, TASKS, KANBAN, PROJECTS];

/// The top-level folders that count as the workspace's files, for the dashboard
pub const COUNTED: &[&str] = &[OTHERS, OFFICE, NOTES, PROJECTS];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_folder_made_sits_under_an_allowed_root_and_the_shared_roots_are_allowed() {
        for f in CREATED {
            assert!(ALLOWED.contains(&f.split('/').next().unwrap()), "{f}");
        }
        assert!(SYNCED.iter().all(|r| ALLOWED.contains(r)));
        assert_eq!(OTHERS, "others");
    }
}
