//! Which edit broke it (Phase 20, ideas): the version history already keeps a copy of a file whenever it is saved, synced or
//! snapshotted, so the edits made since the tests last passed can be put back one at a time in a scratch copy of the project, the
//! tests run, and the first edit after which they fail found by halving the list: a handful of runs for dozens of edits.
//!
//! What it can and cannot tell:
//! - It works on the versions this device kept. An edit made outside Nexsync (a program changing a file on disk) has no version and
//!   stays as it is in every step; a file that only the history knows from after the last pass is left out of the first step.
//! - It says when and how the file changed (saved here, or arrived by sync) and not who made the edit: history does not record
//!   authors for saves and syncs, only for versions somebody named.
//! - It assumes that once the tests fail they stay failing as more edits are added. Tests that fail now and then (see Unstable
//!   Tests) can make it point at the wrong edit, and it says so when the first and last steps do not behave as expected.
//!
//! Only the project's test task as this device approved it is run, in a copy under `.nexsync/bisect`, never in the project. The
//! copy has the project's shared files and a link to each folder of installed dependencies (such as `node_modules`), so nothing
//! is installed again; the copy is removed when the search ends.

use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};

use chrono::DateTime;
use rusqlite::params;
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::sync::oneshot;

use super::{env, tasks::approved_task};
use crate::commands::workspace::{
    helpers::get_workspace_id,
    syncignore::{Rules, PROJECTS_ROOT},
};
use crate::commands::{config::validate_allowed_root, editor_run::run_streaming_in};
use crate::database::WorkspaceDb;

const EVENT: &str = "project://bisect";
/// One run of the tests may take this long
const RUN_LIMIT: Duration = Duration::from_secs(15 * 60);
/// More edits than this are not searched: the answer would be too coarse to help
const MAX_EDITS: usize = 2_000;
static CANCEL: AtomicBool = AtomicBool::new(false);

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Edit {
    pub version_id: i64,
    /// Inside the project
    pub path: String,
    pub hash: String,
    pub created_at: String,
    /// `save`, `sync`, `auto`, `named`, ...
    pub source: String,
    pub label: Option<String>,
    pub author: Option<String>,
    /// The version of this file that this edit replaced
    pub before_id: Option<i64>,
}

/// One row of the version history
pub struct Recorded {
    id: i64,
    path: String,
    hash: String,
    created_at: String,
    source: String,
    label: Option<String>,
    author: Option<String>,
}

/// What each file held at the last pass: its content's hash and the version's id, or `None` for a file with no version then
pub type Baseline = BTreeMap<String, Option<(String, i64)>>;

/// The recorded versions of a project's files, oldest first
fn recorded(db: &WorkspaceDb, prefix: &str) -> Result<Vec<Recorded>, String> {
    let ws_id = get_workspace_id(db)?;
    let mut stmt = db
        .conn
        .prepare("SELECT id, path, hash, created_at, source, label, author FROM file_versions WHERE workspace_id = ?1 AND substr(path, 1, ?2) = ?3 ORDER BY id ASC")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![ws_id, prefix.len() as i64 + 1, format!("{prefix}/")], |r| Ok(Recorded { id: r.get(0)?, path: r.get::<_, String>(1)?[prefix.len() + 1..].to_string(), hash: r.get(2)?, created_at: r.get(3)?, source: r.get(4)?, label: r.get(5)?, author: r.get(6)? }))
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<_, _>>().map_err(|e| e.to_string())
}

/// What each file held at the last pass (`None`: it had no version then), and the edits since, leaving out ones that change nothing
pub fn plan(versions: Vec<Recorded>, good_ms: i64) -> (Baseline, Vec<Edit>) {
    let mut baseline: Baseline = BTreeMap::new();
    let mut after = Vec::new();
    for v in versions {
        let at = DateTime::parse_from_rfc3339(&v.created_at).map(|t| t.timestamp_millis()).unwrap_or(i64::MAX);
        if at <= good_ms {
            baseline.insert(v.path.clone(), Some((v.hash.clone(), v.id)));
        } else {
            after.push(v);
        }
    }
    // A file with no version from before has nothing to put back: it did not exist as far as history knows
    for v in &after {
        baseline.entry(v.path.clone()).or_insert(None);
    }
    let mut now = baseline.clone();
    let mut events = Vec::new();
    for Recorded { id, path, hash, created_at, source, label, author } in after {
        let before = now.get(&path).cloned().flatten();
        if before.as_ref().map(|b| &b.0) == Some(&hash) {
            continue;
        }
        now.insert(path.clone(), Some((hash.clone(), id)));
        events.push(Edit { version_id: id, path, hash, created_at, source, label, author, before_id: before.map(|b| b.1) });
    }
    (baseline, events)
}

/// The content each changed file has after the first `k` edits
pub fn state_at(baseline: &Baseline, events: &[Edit], k: usize) -> BTreeMap<String, Option<String>> {
    let mut state: BTreeMap<String, Option<String>> = baseline.iter().map(|(p, v)| (p.clone(), v.as_ref().map(|b| b.0.clone()))).collect();
    for e in &events[..k.min(events.len())] {
        state.insert(e.path.clone(), Some(e.hash.clone()));
    }
    state
}

#[derive(Debug, PartialEq)]
pub enum Outcome {
    /// The tests already fail with none of the edits applied: the versions do not describe the last pass
    BaselineFails,
    /// The tests pass with all the edits applied: nothing to find in the recorded versions
    NowPasses,
    /// The tests first fail after edit number `n` (0-based index into the list)
    Found(usize),
}

/// The search, one question at a time: `next` says how many edits to apply for the next run of the tests, and `record` takes the answer.
/// It is a value and not a loop so the caller can run the tests asynchronously between the steps.
pub struct Search {
    n: usize,
    stage: Stage,
}

enum Stage {
    Baseline,
    Now,
    Halving { good: usize, bad: usize },
    Done(Outcome),
}

impl Search {
    pub fn new(n: usize) -> Self {
        Self { n, stage: Stage::Baseline }
    }

    /// How many of the edits to apply for the next run, or `None` when the search is over
    pub fn next(&self) -> Option<usize> {
        match self.stage {
            Stage::Baseline => Some(0),
            Stage::Now => Some(self.n),
            Stage::Halving { good, bad } => Some(good + (bad - good) / 2),
            Stage::Done(_) => None,
        }
    }

    /// Whether the tests passed with the edits `next` asked for
    pub fn record(&mut self, passed: bool) {
        self.stage = match (&self.stage, passed) {
            (Stage::Baseline, false) => Stage::Done(Outcome::BaselineFails),
            (Stage::Baseline, true) => Stage::Now,
            (Stage::Now, true) => Stage::Done(Outcome::NowPasses),
            (Stage::Now, false) => self.halve(0, self.n),
            (Stage::Halving { good, bad }, ok) => {
                let mid = good + (bad - good) / 2;
                if ok { self.halve(mid, *bad) } else { self.halve(*good, mid) }
            }
            (Stage::Done(_), _) => return,
        };
    }

    fn halve(&self, good: usize, bad: usize) -> Stage {
        if bad - good > 1 { Stage::Halving { good, bad } } else { Stage::Done(Outcome::Found(bad - 1)) }
    }

    pub fn outcome(self) -> Option<Outcome> {
        match self.stage {
            Stage::Done(o) => Some(o),
            _ => None,
        }
    }
}

/// The whole search for callers that can answer at once
#[cfg(test)]
fn bisect(n: usize, mut passes: impl FnMut(usize) -> Result<bool, String>) -> Result<Outcome, String> {
    let mut s = Search::new(n);
    while let Some(k) = s.next() {
        s.record(passes(k)?);
    }
    Ok(s.outcome().unwrap())
}

#[cfg(windows)]
fn link_dir(target: &Path, link: &Path) -> std::io::Result<()> {
    use std::os::windows::process::CommandExt;
    // A junction needs no special right, unlike a symbolic link
    // mklink wants backslashes
    let fix = |p: &Path| PathBuf::from(p.to_string_lossy().replace('/', "\\"));
    let status = std::process::Command::new("cmd").args(["/C", "mklink", "/J"]).arg(fix(link)).arg(fix(target)).creation_flags(0x0800_0000).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null()).status()?;
    if status.success() { Ok(()) } else { Err(std::io::Error::other("mklink failed")) }
}

#[cfg(unix)]
fn link_dir(target: &Path, link: &Path) -> std::io::Result<()> {
    std::os::unix::fs::symlink(target, link)
}

/// Removes the copy, taking links away first so what they point at is never touched
fn remove_scratch(dir: &Path) {
    if let Ok(rd) = fs::read_dir(dir) {
        for e in rd.filter_map(Result::ok) {
            let Ok(meta) = e.path().symlink_metadata() else { continue };
            let is_link = meta.file_type().is_symlink() || is_junction(&meta);
            if is_link {
                // A junction is removed as a folder, a symbolic link as a file
                if fs::remove_dir(e.path()).is_err() {
                    let _ = fs::remove_file(e.path());
                }
            }
        }
    }
    let _ = fs::remove_dir_all(dir);
}

#[cfg(windows)]
fn is_junction(meta: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    // FILE_ATTRIBUTE_REPARSE_POINT
    meta.file_attributes() & 0x400 != 0
}

#[cfg(not(windows))]
fn is_junction(_: &fs::Metadata) -> bool {
    false
}

/// A copy of the project's shared files, with a link to each folder at its top that the rules keep on the device
fn make_scratch(workspace: &Path, project_dir: &Path, prefix: &str, scratch: &Path) -> Result<(), String> {
    let mut rules = Rules::load(workspace);
    fs::create_dir_all(scratch).map_err(|e| e.to_string())?;
    let mut stack = vec![String::new()];
    while let Some(rel) = stack.pop() {
        let from = if rel.is_empty() { project_dir.to_path_buf() } else { project_dir.join(&rel) };
        let Ok(rd) = fs::read_dir(&from) else { continue };
        for e in rd.filter_map(Result::ok) {
            let Some(name) = e.file_name().to_str().map(str::to_owned) else { continue };
            let Ok(meta) = e.path().symlink_metadata() else { continue };
            let inside = if rel.is_empty() { name.clone() } else { format!("{rel}/{name}") };
            let kept = rules.ignored(&format!("{prefix}/{inside}"), meta.is_dir());
            if meta.is_symlink() || name == ".git" {
                continue;
            }
            if kept {
                // Dependencies stay where they are, linked; the device's own .env files are copied, the tests may read them
                if rel.is_empty() && meta.is_dir() {
                    let _ = link_dir(&e.path(), &scratch.join(&name));
                } else if rel.is_empty() && meta.is_file() && name.starts_with(".env") {
                    let _ = fs::copy(e.path(), scratch.join(&name));
                }
            } else if meta.is_dir() {
                fs::create_dir_all(scratch.join(&inside)).map_err(|e| e.to_string())?;
                stack.push(inside);
            } else if meta.is_file() {
                fs::copy(e.path(), scratch.join(&inside)).map_err(|e| e.to_string())?;
            }
        }
    }
    Ok(())
}

/// Puts each file of the state in the copy (or removes it)
fn apply(scratch: &Path, blobs: &Path, state: &BTreeMap<String, Option<String>>) -> Result<(), String> {
    for (path, hash) in state {
        let target = scratch.join(path);
        match hash {
            Some(h) => {
                if let Some(parent) = target.parent() {
                    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
                }
                fs::copy(blobs.join(h), &target).map_err(|_| format!("The saved copy of {path} is missing."))?;
            }
            None => {
                let _ = fs::remove_file(&target);
            }
        }
    }
    Ok(())
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Bisected {
    /// `found`, `baseline-fails`, `now-passes`, `nothing-recorded`, `too-many` or `cancelled`
    pub outcome: &'static str,
    pub culprit: Option<Edit>,
    pub edits: usize,
    pub steps: Vec<(String, bool)>,
    /// The end of the output of the last failing run
    pub log: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Progress {
    step: usize,
    steps: usize,
    text: String,
}

#[tauri::command]
pub fn project_bisect_cancel() {
    CANCEL.store(true, Ordering::SeqCst);
}

/// Finds the first edit after which the project's test task fails, going back to the last pass at `since` (milliseconds)
#[tauri::command]
pub async fn project_bisect(app: AppHandle, path: String, project: String, task_id: String, since: i64) -> Result<Bisected, String> {
    validate_allowed_root(&app, &path)?;
    let (dir, task) = approved_task(&path, &project, &task_id)?;
    if task.watch || task.interactive {
        return Err("Only a task that ends on its own can be searched.".to_string());
    }
    let prefix = format!("{PROJECTS_ROOT}/{project}");
    let db = WorkspaceDb::open_existing(&path)?;
    let (baseline, events) = plan(recorded(&db, &prefix)?, since);
    drop(db);
    let done = |outcome, edits, steps, log| Bisected { outcome, culprit: None, edits, steps, log };
    if events.is_empty() {
        return Ok(done("nothing-recorded", 0, Vec::new(), String::new()));
    }
    if events.len() > MAX_EDITS {
        return Ok(done("too-many", events.len(), Vec::new(), String::new()));
    }
    CANCEL.store(false, Ordering::SeqCst);

    let workspace = PathBuf::from(&path);
    let scratch = workspace.join(".nexsync").join("bisect").join(uuid::Uuid::new_v4().to_string());
    {
        let (w, d, p, s) = (workspace.clone(), dir.clone(), prefix.clone(), scratch.clone());
        tokio::task::spawn_blocking(move || make_scratch(&w, &d, &p, &s)).await.map_err(|e| e.to_string())??;
    }
    let blobs = workspace.join(".nexsync").join("versions");
    let cwd = if task.cwd.is_empty() { scratch.clone() } else { scratch.join(&task.cwd) };
    let env = env::values_for(&path, &project);
    let runtime = super::runtime::runtime_for(&path, &project, &cwd);
    let n = events.len();
    let planned_steps = 3 + (usize::BITS - n.leading_zeros()) as usize;

    let mut steps: Vec<(String, bool)> = Vec::new();
    let mut last_log = String::new();
    let mut search = Search::new(n);
    let outcome: Result<Outcome, String> = loop {
        let Some(k) = search.next() else { break Ok(search.outcome().unwrap()) };
        if CANCEL.load(Ordering::SeqCst) {
            break Err("cancelled".to_string());
        }
        let label = match k {
            0 => "The state at the last pass".to_string(),
            k if k == n => "The state now".to_string(),
            k => format!("After {k} of {n} edits"),
        };
        let _ = app.emit(EVENT, Progress { step: steps.len() + 1, steps: planned_steps, text: format!("{label}: running {}", task.label) });
        if let Err(e) = apply(&scratch, &blobs, &state_at(&baseline, &events, k)) {
            break Err(e);
        }
        let log = Arc::new(std::sync::Mutex::new(Vec::<String>::new()));
        let sink = {
            let log = log.clone();
            Arc::new(move |_: &'static str, text: String| {
                let mut l = log.lock().unwrap_or_else(|p| p.into_inner());
                l.push(text);
                if l.len() > 400 {
                    l.remove(0);
                }
            })
        };
        let (stop_tx, mut stop_rx) = oneshot::channel();
        let watcher = tokio::spawn(async move {
            let began = tokio::time::Instant::now();
            loop {
                tokio::time::sleep(Duration::from_millis(250)).await;
                if CANCEL.load(Ordering::SeqCst) || began.elapsed() > RUN_LIMIT {
                    let _ = stop_tx.send(());
                    return;
                }
            }
        });
        let result = run_streaming_in(&runtime, &cwd, &task.command, &env, &mut stop_rx, sink).await;
        watcher.abort();
        let (code, stopped) = match result {
            Ok(r) => r,
            Err(e) => break Err(e),
        };
        if stopped && CANCEL.load(Ordering::SeqCst) {
            break Err("cancelled".to_string());
        }
        let ok = code == Some(0);
        if !ok {
            last_log = log.lock().unwrap_or_else(|p| p.into_inner()).iter().map(|l| l.trim_end().to_string()).collect::<Vec<_>>().join("\n");
        }
        steps.push((label, ok));
        search.record(ok);
    };

    tokio::task::spawn_blocking({
        let scratch = scratch.clone();
        move || remove_scratch(&scratch)
    })
    .await
    .ok();
    let tail = |s: String| {
        let skip = s.chars().count().saturating_sub(6_000);
        s.chars().skip(skip).collect::<String>()
    };
    let log = tail(last_log);
    match outcome {
        Ok(Outcome::Found(i)) => Ok(Bisected { outcome: "found", culprit: Some(events[i].clone()), edits: n, steps, log }),
        Ok(Outcome::BaselineFails) => Ok(Bisected { outcome: "baseline-fails", culprit: None, edits: n, steps, log }),
        Ok(Outcome::NowPasses) => Ok(Bisected { outcome: "now-passes", culprit: None, edits: n, steps, log }),
        Err(e) if e == "cancelled" => Ok(Bisected { outcome: "cancelled", culprit: None, edits: n, steps, log }),
        Err(e) => Err(e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::workspace::versions;

    fn rec(id: i64, path: &str, hash: &str, at: &str) -> Recorded {
        Recorded { id, path: path.into(), hash: hash.into(), created_at: at.into(), source: "save".into(), label: None, author: None }
    }

    #[test]
    fn the_edit_after_which_tests_fail_is_found_in_a_few_runs() {
        for culprit in 0..37 {
            let mut runs = 0;
            let found = bisect(37, |k| {
                runs += 1;
                Ok(k <= culprit)
            })
            .unwrap();
            assert_eq!(found, Outcome::Found(culprit));
            assert!(runs <= 2 + 6, "{runs} runs for 37 edits");
        }
        assert_eq!(bisect(5, |k| Ok(k != 0)).unwrap(), Outcome::BaselineFails);
        assert_eq!(bisect(5, |_| Ok(true)).unwrap(), Outcome::NowPasses);
        assert!(bisect(5, |_| Err("stop".to_string())).is_err());
    }

    #[test]
    fn the_plan_puts_each_file_back_as_it_was_at_the_last_pass_and_skips_edits_that_change_nothing() {
        let good = DateTime::parse_from_rfc3339("2026-01-01T10:00:00+00:00").unwrap().timestamp_millis();
        let (baseline, events) = plan(
            vec![
                rec(1, "a.ts", "A1", "2026-01-01T09:00:00+00:00"),
                rec(2, "a.ts", "A2", "2026-01-01T09:30:00+00:00"),
                rec(3, "b.ts", "B1", "2026-01-01T09:40:00+00:00"),
                rec(4, "a.ts", "A3", "2026-01-01T10:05:00+00:00"),
                rec(5, "new.ts", "N1", "2026-01-01T10:06:00+00:00"),
                rec(6, "b.ts", "B1", "2026-01-01T10:07:00+00:00"),
                rec(7, "a.ts", "A4", "2026-01-01T10:08:00+00:00"),
            ],
            good,
        );
        // b.ts was saved again with the same content: not an edit
        assert_eq!(events.iter().map(|e| (e.path.as_str(), e.hash.as_str(), e.before_id)).collect::<Vec<_>>(), [("a.ts", "A3", Some(2)), ("new.ts", "N1", None), ("a.ts", "A4", Some(4))]);
        assert_eq!(baseline["a.ts"], Some(("A2".to_string(), 2)));
        assert_eq!(baseline["new.ts"], None);
        let s0 = state_at(&baseline, &events, 0);
        assert_eq!((s0["a.ts"].as_deref(), s0["b.ts"].as_deref(), s0["new.ts"].as_deref()), (Some("A2"), Some("B1"), None));
        let s2 = state_at(&baseline, &events, 2);
        assert_eq!((s2["a.ts"].as_deref(), s2["new.ts"].as_deref()), (Some("A3"), Some("N1")));
    }

    /// The whole search on a real project folder and a real history, with a test command that checks the files
    #[tokio::test(flavor = "multi_thread")]
    async fn a_scratch_copy_runs_the_command_for_each_step_and_leaves_the_project_alone() {
        let ws = std::env::temp_dir().join(format!("nexsync-bisect-{}", uuid::Uuid::new_v4()));
        let proj = ws.join("projects/app");
        fs::create_dir_all(proj.join("node_modules/dep")).unwrap();
        fs::write(proj.join("node_modules/dep/x.js"), "dep").unwrap();
        let db = WorkspaceDb::open(ws.to_str().unwrap()).unwrap();
        db.conn.execute("INSERT INTO workspace (id, name, description, path, created_at, updated_at) VALUES ('w1', 'w', '', ?1, 't', 't')", [ws.to_string_lossy()]).unwrap();
        let w = ws.to_str().unwrap();
        // Three saves of lib.txt after the pass; the second one breaks it ("BAD")
        let ids: Vec<i64> = ["good", "BAD", "still BAD"].iter().map(|c| versions::record_bytes(w, "projects/app/lib.txt", c.as_bytes(), "save", None).unwrap().unwrap()).collect();
        assert_eq!(ids.len(), 3);
        fs::write(proj.join("lib.txt"), "still BAD").unwrap();
        // Every version is "after" the pass, so the pass was before any: use a time in the past
        let (baseline, events) = plan(recorded(&db, "projects/app").unwrap(), 0);
        assert_eq!(events.len(), 3);
        let scratch = ws.join(".nexsync/bisect/t");
        make_scratch(&ws, &proj, "projects/app", &scratch).unwrap();
        assert_eq!(fs::read_to_string(scratch.join("lib.txt")).unwrap(), "still BAD");
        // The dependency folder is reachable through a link, not copied
        assert_eq!(fs::read_to_string(scratch.join("node_modules/dep/x.js")).unwrap(), "dep");
        let blobs = ws.join(".nexsync/versions");
        let mut seen = Vec::new();
        let found = bisect(events.len(), |k| {
            apply(&scratch, &blobs, &state_at(&baseline, &events, k))?;
            // The "tests": lib.txt exists and does not say BAD (absent at the baseline, which counts as passing here)
            let text = fs::read_to_string(scratch.join("lib.txt")).unwrap_or_default();
            seen.push((k, text.clone()));
            Ok(!text.contains("BAD"))
        })
        .unwrap();
        assert_eq!(found, Outcome::Found(1));
        assert_eq!(events[1].path, "lib.txt");
        remove_scratch(&scratch);
        // The project, and what the link pointed at, are as they were
        assert_eq!(fs::read_to_string(proj.join("lib.txt")).unwrap(), "still BAD");
        assert_eq!(fs::read_to_string(proj.join("node_modules/dep/x.js")).unwrap(), "dep");
        assert!(!scratch.exists());
        let _ = fs::remove_dir_all(&ws);
    }
}
