//! Workspace management commands, storage, and models.

pub mod models;
pub mod helpers;
#[allow(clippy::module_inception)]
pub mod workspace;
pub mod loaders;
pub mod crdt;
pub mod catchup;
pub mod invariants;
pub mod signing;
pub mod drafts;
#[cfg(test)]
mod crdt_sim;
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

// Re-exports for command invocation surface
pub use workspace::*;
pub use filesystem::*;
pub use registry::*;
pub use tasks::*;
pub use kanban::*;
pub use trash::*;
pub use workspace_delete::*;
pub use yjs::*;
pub use error_log::*;