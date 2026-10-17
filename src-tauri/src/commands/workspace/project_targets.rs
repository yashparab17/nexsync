//! Tasks a project already names in its own files (Phase 20, ideas): the targets of a `Makefile`, the recipes of a `justfile`, the
//! tasks of a `Taskfile.yml`, the processes of a `Procfile` and the scripts in `scripts/`. They are listed next to the ones the
//! language's own tool gives, so a team that keeps its commands in one of these needs no recipe to see them. Like every
//! task, one runs only after this device approves its command.

use std::{fs, path::Path};

use super::projects::{valid_name, TaskSpec, ToolReq};

/// Most tasks taken from one file, and in all, so a long Makefile does not fill the list
const PER_FILE: usize = 10;
const IN_ALL: usize = 20;

fn read(dir: &Path, names: &[&str]) -> Option<String> {
    names.iter().find_map(|n| {
        let p = dir.join(n);
        (p.metadata().ok()?.len() <= 512 * 1024).then(|| fs::read_to_string(p).ok()).flatten()
    })
}

fn label(prefix: &str, name: &str) -> String {
    format!("{prefix} {name}")
}

fn task(source: &str, name: &str, command: String) -> TaskSpec {
    TaskSpec { id: format!("{source}-{name}"), label: label(source, name), command, ..Default::default() }
}

/// Targets of a Makefile: `name:` at the start of a line, not a variable (`:=`), a pattern (`%`) or a special target (`.PHONY`)
pub fn make_targets(text: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for line in text.lines() {
        if line.starts_with(['\t', ' ', '#', '.']) {
            continue;
        }
        let Some((head, rest)) = line.split_once(':') else { continue };
        if rest.starts_with('=') || rest.starts_with(':') || head.contains(['$', '%', '=', '(']) {
            continue;
        }
        // `a b: deps` names two targets
        for name in head.split_whitespace() {
            if valid_name(name) && !out.iter().any(|n| n == name) {
                out.push(name.to_string());
            }
        }
    }
    out
}

/// Recipes of a justfile that can run with no arguments and are not private (`_name`)
pub fn just_recipes(text: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for line in text.lines() {
        if line.starts_with(['\t', ' ', '#', '@']) || line.is_empty() {
            continue;
        }
        // `name arg:` needs an argument unless it has a default (`arg=1`), which `just name` accepts
        let Some((head, rest)) = line.split_once(':') else { continue };
        if rest.starts_with('=') || head.contains('=') && !head.split_whitespace().skip(1).all(|p| p.contains('=')) {
            continue;
        }
        let mut words = head.split_whitespace();
        let Some(name) = words.next() else { continue };
        if matches!(name, "set" | "alias" | "import" | "mod" | "export") || name.starts_with('_') || !valid_name(name) {
            continue;
        }
        if words.all(|p| p.contains('=')) && !out.iter().any(|n| n == name) {
            out.push(name.to_string());
        }
    }
    out
}

/// Names under `tasks:` of a Taskfile, read by indentation: no YAML parser for a list of keys
pub fn taskfile_tasks(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut inside = false;
    for line in text.lines() {
        if line.trim().is_empty() || line.trim_start().starts_with('#') {
            continue;
        }
        if !line.starts_with(' ') && !line.starts_with('\t') {
            inside = line.trim_end() == "tasks:";
            continue;
        }
        let indent = line.len() - line.trim_start().len();
        if inside && indent == 2 {
            if let Some((name, rest)) = line.trim().split_once(':') {
                // `ns:sub:` is a namespaced name, which `task name` does not run as written
                if !(rest.is_empty() || rest.starts_with(' ')) {
                    continue;
                }
                let name = name.trim().trim_matches(['"', '\'']);
                // `default` and names with a colon (namespaced) need more than `task name`
                if valid_name(name) && !out.iter().any(|n| n == name) {
                    out.push(name.to_string());
                }
            }
        }
    }
    out
}

/// `name: command` lines of a Procfile
pub fn procfile_processes(text: &str) -> Vec<(String, String)> {
    text.lines()
        .filter(|l| !l.trim_start().starts_with('#'))
        .filter_map(|l| {
            let (name, cmd) = l.split_once(':')?;
            let (name, cmd) = (name.trim(), cmd.trim());
            (valid_name(name) && !cmd.is_empty()).then(|| (name.to_string(), cmd.to_string()))
        })
        .collect()
}

/// The tasks and the tools (`make`, `just`, `task`) the folder's own files call for
pub fn discover(dir: &Path) -> (Vec<TaskSpec>, Vec<ToolReq>) {
    let mut tasks: Vec<TaskSpec> = Vec::new();
    let mut tools: Vec<ToolReq> = Vec::new();
    let tool = |name: &str| ToolReq { name: name.into(), range: String::new() };
    if let Some(t) = read(dir, &["Makefile", "makefile", "GNUmakefile"]) {
        let found: Vec<_> = make_targets(&t).into_iter().take(PER_FILE).collect();
        if !found.is_empty() {
            tools.push(tool("make"));
        }
        tasks.extend(found.iter().map(|n| task("make", n, format!("make {n}"))));
    }
    if let Some(t) = read(dir, &["justfile", "Justfile", ".justfile"]) {
        let found: Vec<_> = just_recipes(&t).into_iter().take(PER_FILE).collect();
        if !found.is_empty() {
            tools.push(tool("just"));
        }
        tasks.extend(found.iter().map(|n| task("just", n, format!("just {n}"))));
    }
    if let Some(t) = read(dir, &["Taskfile.yml", "Taskfile.yaml", "taskfile.yml", "taskfile.yaml"]) {
        let found: Vec<_> = taskfile_tasks(&t).into_iter().take(PER_FILE).collect();
        if !found.is_empty() {
            tools.push(tool("task"));
        }
        tasks.extend(found.iter().map(|n| task("task", n, format!("task {n}"))));
    }
    // Every process of a Procfile keeps running, so Start All starts them together
    if let Some(t) = read(dir, &["Procfile", "Procfile.dev"]) {
        tasks.extend(procfile_processes(&t).into_iter().take(PER_FILE).map(|(n, c)| TaskSpec { watch: true, ..task("proc", &n, c) }));
    }
    if let Ok(rd) = fs::read_dir(dir.join("scripts")) {
        let mut names: Vec<String> = rd.filter_map(Result::ok).filter(|e| e.path().is_file()).map(|e| e.file_name().to_string_lossy().into_owned()).collect();
        names.sort();
        for file in names.into_iter().take(PER_FILE) {
            let Some((stem, ext)) = file.rsplit_once('.') else { continue };
            let run = match (ext, cfg!(windows)) {
                ("sh", false) => format!("sh scripts/{file}"),
                ("ps1", true) => format!("powershell -NoProfile -ExecutionPolicy Bypass -File scripts/{file}"),
                ("py", w) => format!("{} scripts/{file}", if w { "python" } else { "python3" }),
                _ => continue,
            };
            if valid_name(&file) && valid_name(stem) {
                tasks.push(task("script", stem, run));
            }
        }
    }
    tasks.truncate(IN_ALL);
    (tasks, tools)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn make_targets_skip_variables_patterns_and_special_targets() {
        let text = "CC := gcc\n.PHONY: all lint\nall: build\n\techo hi\nbuild test: deps\n%.o: %.c\nVAR=x\nFOO ?= 1\nlint:\n# note: not a target\nlint:\n$(OUT): x\n";
        assert_eq!(make_targets(text), ["all", "build", "test", "lint"]);
    }

    #[test]
    fn just_recipes_need_no_arguments_and_are_not_private() {
        let text = "set shell := [\"bash\"]\nname := \"x\"\nalias b := build\n\nbuild:\n  cargo build\n_helper:\n  true\ntest target='all':\n  run {{target}}\ndeploy env:\n  ./deploy {{env}}\n@quiet:\n  true\ndev: build\n  run\n";
        assert_eq!(just_recipes(text), ["build", "test", "dev"]);
    }

    #[test]
    fn taskfile_tasks_are_the_keys_one_level_under_tasks() {
        let text = "version: '3'\nvars:\n  A: b\ntasks:\n  build:\n    cmds:\n      - go build\n  \"lint\":\n    cmds: [x]\n  ns:sub:\n    cmds: [y]\nother:\n  notatask:\n";
        assert_eq!(taskfile_tasks(text), ["build", "lint"]);
    }

    #[test]
    fn procfile_lines_become_processes() {
        assert_eq!(procfile_processes("# c\nweb: npm start\nworker: node w.js\nbad line\n"), [("web".to_string(), "npm start".to_string()), ("worker".to_string(), "node w.js".to_string())]);
    }

    #[test]
    fn a_folder_with_a_makefile_and_a_procfile_gets_both_and_the_tools() {
        let d = std::env::temp_dir().join(format!("nexsync-targets-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(d.join("scripts")).unwrap();
        fs::write(d.join("Makefile"), "lint:\n\ttrue\n").unwrap();
        fs::write(d.join("Procfile"), "web: npm start\n").unwrap();
        fs::write(d.join("scripts/seed.py"), "").unwrap();
        fs::write(d.join("scripts/notes.txt"), "").unwrap();
        let (tasks, tools) = discover(&d);
        let ids: Vec<_> = tasks.iter().map(|t| t.id.as_str()).collect();
        assert_eq!(ids, ["make-lint", "proc-web", "script-seed"]);
        assert!(tasks[1].watch && !tasks[0].watch);
        assert_eq!(tools.iter().map(|t| t.name.as_str()).collect::<Vec<_>>(), ["make"]);
        let _ = fs::remove_dir_all(&d);
    }
}
