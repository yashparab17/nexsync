//! Office documents, spreadsheets and slide decks (Phase 21): reading and writing their files, and the engines behind the editors.
//! `documents` (Word-style files and PDF), `sheets` and `sheet_tools` (workbooks), `slides` (decks), `proof` (spelling and grammar).

pub mod blocks;
pub mod documents;
pub mod merge;
pub mod presets;
pub mod proof;
pub mod sheet_tools;
pub mod sheets;
pub mod slides;
