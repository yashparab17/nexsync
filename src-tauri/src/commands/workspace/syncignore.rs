//! Which paths of a workspace never leave the device (Phase 20, step 1).
//!
//! A project folder holds things that belong to one machine: installed dependencies, build output, caches, local
//! environment files and the `.git` folder. They are not synced to collaborators, not put in a bundle and not shown
//! in the explorer unless asked for. The rules, from weakest to strongest, in every folder from the workspace root down:
//! the built-in defaults (under `projects/` only), the folder's `.gitignore`, its `.nexignore`, and at the workspace root a
//! device-only `.nexignore.local`. They use Git's syntax, so a later rule or a `!rule` overrides an earlier one and a deeper
//! folder overrides a shallower one. A few things can never be re-included: see [`always_blocked`].

use std::{
    collections::HashMap,
    path::{Path, PathBuf},
};

use ignore::gitignore::{Gitignore, GitignoreBuilder};

/// The folder that holds projects, and the only one where dotfiles such as `.gitignore` or `.eslintrc` are shared
pub const PROJECTS_ROOT: &str = "projects";

/// A file in a project over this size is kept on the device, so one build artefact cannot flood every collaborator. A project
/// that wants it shared can say so in its recipe later; today the Projects page lists what was held back.
pub const MAX_PROJECT_FILE_BYTES: u64 = 25 * 1024 * 1024;

/// Whether a file of this size in this path stays on the device for size
pub fn too_big(rel: &str, size: u64) -> bool {
    size > MAX_PROJECT_FILE_BYTES && rel.split('/').next() == Some(PROJECTS_ROOT)
}

/// Lock files are written by a tool, not by people, and two of them merged line by line are often not valid: when two devices
/// changed one at the same time the newer whole file is taken without keeping a conflict copy, and the Projects page offers
/// to run the install that rewrites it
pub fn is_generated(rel: &str) -> bool {
    const LOCKS: &[&str] = &["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lockb", "bun.lock", "Cargo.lock", "poetry.lock", "uv.lock", "Pipfile.lock", "Gemfile.lock", "composer.lock", "go.sum", "mix.lock", "pubspec.lock", "Package.resolved", "gradle.lockfile"];
    rel.rsplit('/').next().is_some_and(|name| LOCKS.contains(&name))
}

/// The file a team shares, and the one only this device reads
pub const SHARED_FILE: &str = ".nexignore";
pub const LOCAL_FILE: &str = ".nexignore.local";

/// What is left on the device in every project unless the project says otherwise (`!pattern` in `.nexignore` re-includes)
const DEFAULTS: &[&str] = &[
    // JavaScript and web
    "node_modules/", ".pnpm-store/", "**/.yarn/cache/", "**/.yarn/unplugged/", "**/.yarn/install-state.gz", "dist/", "build/", "out/",
    ".next/", ".nuxt/", ".output/", ".svelte-kit/", ".astro/", ".turbo/", ".parcel-cache/", ".vite/", ".angular/", ".expo/",
    ".cache/", "coverage/",
    // Rust, Java, .NET
    "target/", ".gradle/", "obj/", "**/bin/Debug/", "**/bin/Release/",
    // Editors and systems
    ".idea/", ".vs/", ".DS_Store", "Thumbs.db",
    // Mobile
    "Pods/", "DerivedData/", ".dart_tool/", ".flutter-plugins", ".flutter-plugins-dependencies",
    // Python
    ".venv/", "venv/", "__pycache__/", "*.pyc", ".pytest_cache/", ".mypy_cache/", ".ruff_cache/", ".tox/", "*.egg-info/", ".eggs/",
    // Other
    "_build/", ".godot/", ".terraform/",
    // Local environment files: names are shared in `.env.example`, values stay put
    ".env", ".env.*", "!.env.example", "!.env.sample", "!.env.template",
];

/// Paths that are never synced and cannot be re-included: Git's own folder (every device has its own copy), the half of a
/// download that is not finished, and this device's private ignore list
pub fn always_blocked(rel: &str) -> bool {
    rel.split('/').any(|s| s == ".git" || s.ends_with(".nexsync-part") || s == LOCAL_FILE)
}

/// What the file sync and the explorer ask: is this path of the workspace kept on this device only?
pub struct Rules {
    root: PathBuf,
    layers: HashMap<String, Option<Gitignore>>,
}

impl Rules {
    pub fn load(workspace: &Path) -> Self {
        Self { root: workspace.to_path_buf(), layers: HashMap::new() }
    }

    /// The rules written in one folder (`""` is the workspace root), or `None` when it has none
    fn layer(&mut self, dir: &str) -> Option<&Gitignore> {
        let root = self.root.clone();
        self.layers
            .entry(dir.to_string())
            .or_insert_with(|| {
                let base = if dir.is_empty() { root.clone() } else { root.join(dir) };
                let mut builder = GitignoreBuilder::new(&base);
                let mut any = false;
                if dir == PROJECTS_ROOT {
                    // The defaults apply to every project, so they sit in the layer of the projects folder
                    for line in DEFAULTS {
                        let _ = builder.add_line(None, line);
                    }
                    any = true;
                }
                let mut files = vec![".gitignore", SHARED_FILE];
                if dir.is_empty() {
                    files.push(LOCAL_FILE);
                }
                for file in files {
                    let p = base.join(file);
                    if p.is_file() && builder.add(&p).is_none() {
                        any = true;
                    }
                }
                if any { builder.build().ok() } else { None }
            })
            .as_ref()
    }

    /// Whether `rel` (workspace-relative, no leading slash) is kept on this device
    pub fn ignored(&mut self, rel: &str, is_dir: bool) -> bool {
        if always_blocked(rel) {
            return true;
        }
        let parts: Vec<&str> = rel.split('/').filter(|s| !s.is_empty()).collect();
        // A folder that is ignored takes everything in it along, whatever a rule inside says
        for end in 1..=parts.len() {
            let dir = end < parts.len() || is_dir;
            if self.decide(&parts[..end], dir) {
                return true;
            }
        }
        false
    }

    /// The nearest folder with an opinion wins; inside one folder the later rule wins
    fn decide(&mut self, parts: &[&str], is_dir: bool) -> bool {
        for depth in (0..parts.len()).rev() {
            let dir = parts[..depth].join("/");
            let inside = parts[depth..].join("/");
            if let Some(layer) = self.layer(&dir) {
                let m = layer.matched(Path::new(&inside), is_dir);
                if m.is_ignore() {
                    return true;
                }
                if m.is_whitelist() {
                    return false;
                }
            }
        }
        false
    }
}

/// Whether a name inside `root` is skipped when listing for sync, before any rule: dotfiles in every shared folder but
/// `projects/`, where they are part of the project
pub fn hidden_name_skipped(root: &str, name: &str) -> bool {
    name.starts_with('.') && root != PROJECTS_ROOT
}

#[cfg(test)]
mod tests {
    use super::*;

    fn workspace() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("nexsync-ignore-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(dir.join("projects/app/src")).unwrap();
        dir
    }

    #[test]
    fn dependencies_and_build_output_stay_but_source_and_dotfiles_go() {
        let ws = workspace();
        let mut r = Rules::load(&ws);
        for kept in ["projects/app/node_modules/react/index.js", "projects/app/target/debug/x", "projects/app/.env", "projects/app/.venv/bin/python", "projects/app/__pycache__/a.pyc", "projects/app/dist"] {
            assert!(r.ignored(kept, kept.ends_with("dist")), "{kept} should stay on the device");
        }
        for shared in ["projects/app/src/main.ts", "projects/app/.gitignore", "projects/app/.env.example", "projects/app/.eslintrc.json", "projects/app/package.json", "projects/app/.github/workflows/ci.yml"] {
            assert!(!r.ignored(shared, false), "{shared} should sync");
        }
        let _ = std::fs::remove_dir_all(ws);
    }

    #[test]
    fn git_is_never_synced_and_cannot_be_brought_back() {
        let ws = workspace();
        std::fs::write(ws.join(SHARED_FILE), "!.git/\n!.nexignore.local\n").unwrap();
        let mut r = Rules::load(&ws);
        assert!(r.ignored("projects/app/.git/config", false));
        assert!(r.ignored("projects/app/.git", true));
        assert!(r.ignored("projects/app/src/.main.ts.4.nexsync-part", false));
        assert!(r.ignored(".nexignore.local", false));
        let _ = std::fs::remove_dir_all(ws);
    }

    #[test]
    fn gitignore_and_nexignore_add_rules_and_nexignore_can_bring_a_folder_back() {
        let ws = workspace();
        std::fs::write(ws.join("projects/app/.gitignore"), "generated/\n*.tmp\n").unwrap();
        std::fs::write(ws.join("projects/app/.nexignore"), "!dist/\nsecrets.json\n").unwrap();
        let mut r = Rules::load(&ws);
        assert!(r.ignored("projects/app/generated/a.ts", false));
        assert!(r.ignored("projects/app/x.tmp", false));
        assert!(r.ignored("projects/app/secrets.json", false));
        assert!(!r.ignored("projects/app/dist/index.js", false), "the project asked for dist to be shared");
        assert!(!r.ignored("projects/app/src/main.ts", false));
        let _ = std::fs::remove_dir_all(ws);
    }

    #[test]
    fn a_workspace_wide_nexignore_and_a_private_one_apply_to_every_project() {
        let ws = workspace();
        std::fs::write(ws.join(SHARED_FILE), "projects/*/notes-to-self.md\n").unwrap();
        std::fs::write(ws.join(LOCAL_FILE), "*.sqlite\n").unwrap();
        let mut r = Rules::load(&ws);
        assert!(r.ignored("projects/app/notes-to-self.md", false));
        assert!(r.ignored("projects/app/data.sqlite", false));
        assert!(!r.ignored("projects/app/readme.md", false));
        let _ = std::fs::remove_dir_all(ws);
    }

    #[test]
    fn big_files_in_projects_stay_and_lock_files_are_generated() {
        assert!(too_big("projects/app/data.bin", MAX_PROJECT_FILE_BYTES + 1));
        assert!(!too_big("projects/app/data.bin", MAX_PROJECT_FILE_BYTES));
        assert!(!too_big("assets/video.mp4", MAX_PROJECT_FILE_BYTES * 10));
        assert!(is_generated("projects/app/pnpm-lock.yaml") && is_generated("Cargo.lock") && !is_generated("projects/app/lock.ts"));
    }

    #[test]
    fn the_defaults_do_not_touch_other_folders() {
        let ws = workspace();
        let mut r = Rules::load(&ws);
        assert!(!r.ignored("notes/target/plan.md", false));
        assert!(hidden_name_skipped("notes", ".obsidian"));
        assert!(!hidden_name_skipped("projects", ".eslintrc"));
        let _ = std::fs::remove_dir_all(ws);
    }
}
