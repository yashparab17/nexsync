//! Workspace management commands, storage, and models.

pub mod models;
pub mod helpers;
#[allow(clippy::module_inception)]
pub mod workspace;
pub mod loaders;
pub mod crdt;
pub mod catchup;
pub mod erase;
pub mod chatlog;
pub mod moderation;
pub mod announce;
pub mod bundle;
pub mod dm;
pub mod held;
pub mod invariants;
pub mod signing;
pub mod drafts;
#[cfg(test)]
mod crdt_sim;
#[cfg(test)]
mod clock_sim;
#[cfg(test)]
mod reach_sim;
pub mod filesystem;
pub mod registry;
pub mod tasks;
pub mod kanban;
pub mod yjs;
pub mod error_log;
pub mod trash;
pub mod data_sync;
pub mod workspace_delete;
pub mod versions;
pub mod export;
pub mod syncignore;
pub mod projects;
pub mod project_doctor;
pub mod project_scan;
pub mod project_env;
pub mod secret_scan;
pub mod project_tasks;
pub mod project_templates;
pub mod project_reports;
pub mod project_targets;
pub mod project_audit;
pub mod project_http;
pub mod office;
pub mod proof;
pub mod sheet_tools;
pub mod sheets;
pub mod deck;
pub mod project_lsp;
pub mod project_runtime;
pub mod project_containers;
pub mod project_bisect;
pub mod project_impact;
pub mod project_search;
pub mod project_generators;

// Re-exports for command invocation surface
pub use workspace::*;
pub use filesystem::*;
pub use registry::*;
pub use tasks::*;
pub use kanban::*;
pub use trash::*;
pub use erase::*;
pub use workspace_delete::*;
pub use yjs::*;
pub use error_log::*;