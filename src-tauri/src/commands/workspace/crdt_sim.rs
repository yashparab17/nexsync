//! A simulation that measures how many edits each way of merging a card loses.
//!
//! Two or three devices start from the same card, go offline, each make a few edits, then exchange state until
//! they agree. For every edit we ask whether its effect is still there at the end, and, for the one scheme that
//! reports conflicts, whether it was at least shown to someone instead of disappearing.
//!
//! Strategies compared:
//! - `record-LWW`: the whole card is replaced by the copy that was edited last (what the app did before);
//! - `field-LWW`: one register per field and one value for each list (tags, comments, checklist), latest write wins;
//! - `fields+sets`: every field a register, every list a set of members, conflicts reported (what the app does now).
//!
//! Run with `cargo test crdt_sim -- --nocapture` to see the table.

use std::collections::BTreeMap;

use rand::{rngs::StdRng, seq::SliceRandom, Rng, SeedableRng};
use serde_json::{json, Value};

use super::crdt::{rfc3339_of, Crdt, RecordState};
use super::invariants::{check, RULES};
use super::models::{ChecklistItem, Comment, KanbanCard, Task};

#[derive(Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
enum Effect {
    Title(String),
    Description(String),
    Assignee(String),
    Due(String),
    Column(String),
    Tag(String),
    Comment(String),
    Item(String),
    Done(String),
}

impl Effect {
    /// Edits by the same device to the same thing replace each other, so only the last one counts
    fn slot(&self) -> String {
        match self {
            Effect::Title(_) => "title".into(),
            Effect::Description(_) => "description".into(),
            Effect::Assignee(_) => "assignee".into(),
            Effect::Due(_) => "due".into(),
            Effect::Column(_) => "column".into(),
            Effect::Tag(t) => format!("tag:{t}"),
            Effect::Comment(c) => format!("comment:{c}"),
            Effect::Item(i) => format!("item:{i}"),
            Effect::Done(i) => format!("done:{i}"),
        }
    }

    fn field_and_value(&self) -> Option<(&'static str, Value)> {
        Some(match self {
            Effect::Title(v) => ("title", json!(v)),
            Effect::Description(v) => ("description", json!(v)),
            Effect::Assignee(v) => ("assignee_id", json!(v)),
            Effect::Due(v) => ("due_date", json!(v)),
            Effect::Column(v) => ("column_id", json!(v)),
            _ => return None,
        })
    }

    fn present_in(&self, card: &KanbanCard) -> bool {
        match self {
            Effect::Title(v) => &card.title == v,
            Effect::Description(v) => &card.description == v,
            Effect::Assignee(v) => card.assignee_id.as_ref() == Some(v),
            Effect::Due(v) => card.due_date.as_ref() == Some(v),
            Effect::Column(v) => &card.column_id == v,
            Effect::Tag(t) => card.tags.contains(t),
            Effect::Comment(c) => card.comments.iter().any(|x| &x.id == c),
            Effect::Item(i) => card.checklist.iter().any(|x| &x.id == i),
            Effect::Done(i) => card.checklist.iter().any(|x| &x.id == i && x.done),
        }
    }
}

fn base_card() -> KanbanCard {
    KanbanCard {
        id: "k".into(),
        title: "Base title".into(),
        description: "Base".into(),
        column_id: "todo".into(),
        checklist: vec![
            ChecklistItem { id: "i1".into(), text: "first".into(), done: false },
            ChecklistItem { id: "i2".into(), text: "second".into(), done: false },
        ],
        created_at: "2026-01-01T00:00:00Z".into(),
        updated_at: "2026-01-01T00:00:00Z".into(),
        ..Default::default()
    }
}

/// One random edit by device `who`; the card is changed and the effect to look for later is returned
fn random_edit(rng: &mut StdRng, who: usize, n: usize, card: &mut KanbanCard) -> Effect {
    match rng.gen_range(0..9) {
        0 => {
            let v = format!("title-{who}-{n}");
            card.title = v.clone();
            Effect::Title(v)
        }
        1 => {
            let v = format!("description-{who}-{n}");
            card.description = v.clone();
            Effect::Description(v)
        }
        2 => {
            let v = format!("person-{who}");
            card.assignee_id = Some(v.clone());
            Effect::Assignee(v)
        }
        3 => {
            let v = format!("2026-03-{:02}", rng.gen_range(1..28));
            card.due_date = Some(v.clone());
            Effect::Due(v)
        }
        4 => {
            // A move goes somewhere else; putting a card back where it already is changes nothing
            let others: Vec<&str> = ["todo", "doing", "done"].into_iter().filter(|c| *c != card.column_id).collect();
            let v = others[rng.gen_range(0..others.len())].to_string();
            card.column_id = v.clone();
            Effect::Column(v)
        }
        5 => {
            let v = format!("tag-{who}-{n}");
            card.tags.push(v.clone());
            Effect::Tag(v)
        }
        6 => {
            let id = format!("c-{who}-{n}");
            card.comments.push(Comment { id: id.clone(), author: format!("p{who}"), text: "hi".into(), at: format!("2026-02-{:02}T00:00:00Z", 1 + n) });
            Effect::Comment(id)
        }
        7 => {
            let id = format!("i-{who}-{n}");
            card.checklist.push(ChecklistItem { id: id.clone(), text: "new".into(), done: false });
            Effect::Item(id)
        }
        _ => {
            let id = ["i1", "i2"][rng.gen_range(0..2)].to_string();
            if let Some(item) = card.checklist.iter_mut().find(|i| i.id == id) {
                item.done = true;
            }
            Effect::Done(id)
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Strategy {
    RecordLww,
    FieldLww,
    FieldsAndSets,
}

#[derive(Default, Debug)]
struct Tally {
    edits: u64,
    lost: u64,
    shown_as_conflict: u64,
    diverged_trials: u64,
    trials: u64,
    lost_by_kind: BTreeMap<String, u64>,
}

struct Device {
    card: KanbanCard,
    state: RecordState,
    id: String,
    at: u64,
}

fn run_trial(strategy: Strategy, seed: u64, tally: &mut Tally) {
    let mut rng = StdRng::seed_from_u64(seed);
    let devices_n = rng.gen_range(2..=3);
    let whole = strategy == Strategy::FieldLww;
    let base = base_card();
    let base_state = RecordState::from_legacy(base.paths(whole), 1_000);

    let mut devices: Vec<Device> = (0..devices_n)
        .map(|i| Device { card: base.clone(), state: base_state.clone(), id: format!("d{i}"), at: 2_000 })
        .collect();
    let mut intended: Vec<Effect> = Vec::new();

    for (who, device) in devices.iter_mut().enumerate() {
        let mut slots: BTreeMap<String, Effect> = BTreeMap::new();
        for n in 0..rng.gen_range(1..=4) {
            // Every device's clock is a little different, as real ones are
            device.at += rng.gen_range(1..400);
            let effect = random_edit(&mut rng, who, n, &mut device.card);
            slots.insert(effect.slot(), effect);
            match strategy {
                Strategy::RecordLww => device.card.updated_at = rfc3339_of(device.at),
                _ => {
                    let id = device.id.clone();
                    let desired = device.card.paths(whole);
                    device.state.diff_write(&id, &desired, device.at, None);
                }
            }
        }
        intended.extend(slots.into_values());
    }

    // Everyone sends everyone their state, twice over, in a random order
    let order: Vec<usize> = (0..devices_n).collect();
    for _ in 0..2 {
        let mut pairs: Vec<(usize, usize)> = order.iter().flat_map(|&i| order.iter().filter(move |&&j| j != i).map(move |&j| (i, j))).collect();
        pairs.shuffle(&mut rng);
        for (from, to) in pairs {
            match strategy {
                Strategy::RecordLww => {
                    let theirs = (devices[from].card.updated_at.clone(), from, devices[from].card.clone());
                    let ours = (devices[to].card.updated_at.clone(), to, devices[to].card.clone());
                    // Later edit wins; the sender's index breaks a tie so every device picks the same one
                    if (theirs.0.as_str(), theirs.1) > (ours.0.as_str(), ours.1) && theirs.2 != ours.2 {
                        devices[to].card = theirs.2;
                        devices[to].card.updated_at = theirs.0;
                    }
                }
                _ => {
                    let theirs = devices[from].state.clone();
                    devices[to].state = devices[to].state.merge(&theirs);
                }
            }
        }
    }

    let finals: Vec<KanbanCard> = devices
        .iter()
        .map(|d| match strategy {
            Strategy::RecordLww => d.card.clone(),
            _ => KanbanCard::materialize(&base, &d.state.resolved()),
        })
        .collect();
    tally.trials += 1;
    if finals.windows(2).any(|w| w[0] != w[1]) {
        tally.diverged_trials += 1;
    }

    let conflicts = if strategy == Strategy::FieldsAndSets { devices[0].state.conflicts() } else { Vec::new() };
    for effect in &intended {
        tally.edits += 1;
        if effect.present_in(&finals[0]) {
            continue;
        }
        let shown = effect.field_and_value().is_some_and(|(field, value)| conflicts.iter().any(|c| c.field == field && c.options.iter().any(|o| o.value == value)));
        if shown {
            tally.shown_as_conflict += 1;
        } else {
            tally.lost += 1;
            *tally.lost_by_kind.entry(effect.slot().split(':').next().unwrap_or("").to_string()).or_default() += 1;
        }
    }
}

fn run(strategy: Strategy, trials: u64) -> Tally {
    let mut tally = Tally::default();
    for seed in 0..trials {
        run_trial(strategy, seed, &mut tally);
    }
    tally
}

fn row(name: &str, t: &Tally) -> String {
    let pct = |n: u64| 100.0 * n as f64 / t.edits as f64;
    format!(
        "| {name:<12} | {:>6} | {:>5} ({:>5.1}%) | {:>5} ({:>5.1}%) | {:>4} |",
        t.edits,
        t.lost,
        pct(t.lost),
        t.shown_as_conflict,
        pct(t.shown_as_conflict),
        t.diverged_trials
    )
}

#[test]
fn field_merging_loses_fewer_edits_and_every_scheme_converges() {
    let trials = 3000;
    let lww = run(Strategy::RecordLww, trials);
    let fields = run(Strategy::FieldLww, trials);
    let full = run(Strategy::FieldsAndSets, trials);

    println!("\nOffline editing of one card by 2-3 devices, {trials} trials each");
    println!("| strategy     |  edits |        lost silently |  shown as conflict | diverged |");
    println!("{}", row("record-LWW", &lww));
    println!("{}", row("field-LWW", &fields));
    println!("{}", row("fields+sets", &full));

    for t in [&lww, &fields, &full] {
        assert_eq!(t.diverged_trials, 0, "devices must end up identical");
    }
    assert!(lww.lost > fields.lost, "per-field merging should lose less than whole-record merging");
    assert!(fields.lost > full.lost, "sets and kept conflicts should lose less than per-field registers alone");
    assert_eq!(full.lost, 0, "nothing is silently lost when lists are sets and collisions are kept");
}

// ────────────────────────────
// Rules about a whole record
// ────────────────────────────

/// Two or three devices edit one task while apart. Each device only makes an edit that leaves both rules true on its
/// own copy (a finished task keeps its assignee, a dated task keeps its assignee), so every device is correct at every
/// moment. Whatever rule is broken after they merge was broken by the merge, not by anyone.
#[derive(Default, Debug)]
struct RuleTally {
    trials: u64,
    edits_made: u64,
    edits_refused: u64,
    broken_trials: u64,
    broken_by_rule: BTreeMap<String, u64>,
    diverged: u64,
}

fn base_task() -> Task {
    Task {
        id: "t".into(),
        title: "Base".into(),
        status: "todo".into(),
        priority: "medium".into(),
        assignee_id: Some("p0".into()),
        created_at: "2026-01-01T00:00:00Z".into(),
        updated_at: "2026-01-01T00:00:00Z".into(),
        ..Default::default()
    }
}

fn rule_trial(whole_record: bool, seed: u64, tally: &mut RuleTally) {
    let on: Vec<String> = RULES.iter().map(|r| r.id.to_string()).collect();
    let mut rng = StdRng::seed_from_u64(seed);
    let devices_n = rng.gen_range(2..=3);
    let base = base_task();
    let base_state = RecordState::from_legacy(base.paths(false), 1_000);
    let mut devices: Vec<(Task, RecordState, u64)> = (0..devices_n).map(|_| (base.clone(), base_state.clone(), 2_000)).collect();

    for (who, (task, state, at)) in devices.iter_mut().enumerate() {
        for _ in 0..rng.gen_range(1..=4) {
            *at += rng.gen_range(1..400);
            let mut next = task.clone();
            match rng.gen_range(0..6) {
                0 => next.assignee_id = Some(format!("person-{who}")),
                1 => next.assignee_id = None,
                2 => next.status = "done".into(),
                3 => next.status = "todo".into(),
                4 => next.due_date = Some(format!("2026-03-{:02}", rng.gen_range(1..28))),
                _ => next.due_date = None,
            }
            // This device's own copy must satisfy the rules after every edit
            if !check(&next, &on).is_empty() {
                tally.edits_refused += 1;
                continue;
            }
            tally.edits_made += 1;
            *task = next;
            if whole_record {
                task.updated_at = rfc3339_of(*at);
            } else {
                state.diff_write(&format!("d{who}"), &task.paths(false), *at, None);
            }
        }
    }

    for _ in 0..2 {
        let mut pairs: Vec<(usize, usize)> = (0..devices_n).flat_map(|i| (0..devices_n).filter(move |&j| j != i).map(move |j| (i, j))).collect();
        pairs.shuffle(&mut rng);
        for (from, to) in pairs {
            if whole_record {
                let theirs = (devices[from].0.updated_at.clone(), from, devices[from].0.clone());
                let ours = (devices[to].0.updated_at.clone(), to, devices[to].0.clone());
                if (theirs.0.as_str(), theirs.1) > (ours.0.as_str(), ours.1) && theirs.2 != ours.2 {
                    devices[to].0 = theirs.2;
                }
            } else {
                let theirs = devices[from].1.clone();
                devices[to].1 = devices[to].1.merge(&theirs);
            }
        }
    }

    let finals: Vec<Task> = devices.iter().map(|(t, s, _)| if whole_record { t.clone() } else { Task::materialize(&base, &s.resolved()) }).collect();
    tally.trials += 1;
    if finals.windows(2).any(|w| w[0].paths(false) != w[1].paths(false)) {
        tally.diverged += 1;
    }
    let broken = check(&finals[0], &on);
    if !broken.is_empty() {
        tally.broken_trials += 1;
        for v in broken {
            *tally.broken_by_rule.entry(v.rule).or_default() += 1;
        }
    }
}

fn rule_run(whole_record: bool, trials: u64) -> RuleTally {
    let mut tally = RuleTally::default();
    for seed in 0..trials {
        rule_trial(whole_record, seed, &mut tally);
    }
    tally
}

#[test]
fn merging_field_by_field_can_break_rules_that_no_device_broke() {
    let trials = 5000;
    let lww = rule_run(true, trials);
    let fields = rule_run(false, trials);

    let line = |name: &str, t: &RuleTally| {
        let pct = |n: u64| 100.0 * n as f64 / t.trials as f64;
        let by = |rule: &str| t.broken_by_rule.get(rule).copied().unwrap_or(0);
        println!(
            "| {name:<12} | {:>6} | {:>5} ({:>4.1}%) | {:>5} ({:>4.1}%) | {:>5} ({:>4.1}%) | {:>8} |",
            t.trials,
            t.broken_trials,
            pct(t.broken_trials),
            by(super::invariants::FINISHED_HAS_OWNER),
            pct(by(super::invariants::FINISHED_HAS_OWNER)),
            by(super::invariants::SCHEDULED_HAS_OWNER),
            pct(by(super::invariants::SCHEDULED_HAS_OWNER)),
            t.diverged
        );
    };
    println!("\nOne task edited offline by 2-3 devices, each keeping both rules true on its own copy, {trials} trials each");
    println!("| strategy     | trials | ends broken     | finished, no owner | dated, no owner | diverged |");
    line("record-LWW", &lww);
    line("fields+sets", &fields);
    println!("edits made {} / refused by the device's own rules {} (fields)", fields.edits_made, fields.edits_refused);

    assert_eq!(lww.diverged + fields.diverged, 0, "devices must end up identical");
    assert_eq!(lww.broken_trials, 0, "taking one device's whole record keeps the rules, since that device kept them");
    assert!(fields.broken_trials > 0, "merging field by field can combine two correct records into a broken one");
}

// ────────────────────────────
// How far it scales
// ────────────────────────────

fn bytes<T: serde::Serialize>(value: &T) -> usize {
    serde_json::to_vec(value).unwrap().len()
}

/// `replicas` devices each make `edits` edits to one card while apart; returns the merged state's size in bytes, how
/// long folding all the copies together took in milliseconds, and whether folding in the opposite order agrees.
fn grow(replicas: usize, edits: usize) -> (usize, f64, bool) {
    let mut rng = StdRng::seed_from_u64(replicas as u64 * 1_000 + edits as u64);
    let base = base_card();
    let start = RecordState::from_legacy(base.paths(false), 1_000);
    let states: Vec<RecordState> = (0..replicas)
        .map(|who| {
            let (mut card, mut state, mut at) = (base.clone(), start.clone(), 2_000);
            for n in 0..edits {
                at += rng.gen_range(1..400);
                random_edit(&mut rng, who, n, &mut card);
                state.diff_write(&format!("d{who}"), &card.paths(false), at, None);
            }
            state
        })
        .collect();
    let clock = std::time::Instant::now();
    let forward = states.iter().skip(1).fold(states[0].clone(), |a, b| a.merge(b));
    let ms = clock.elapsed().as_secs_f64() * 1000.0;
    let backward = states.iter().rev().skip(1).fold(states[replicas - 1].clone(), |a, b| a.merge(b));
    (bytes(&forward), ms, forward.resolved() == backward.resolved())
}

/// Run with `cargo test scale -- --ignored --nocapture`. Times are from an unoptimised test build, so a release
/// build is faster; the sizes do not depend on the build.
#[test]
#[ignore = "a measurement, not a check; takes a while"]
fn scale_of_a_record_and_of_a_workspace() {
    println!("\nOne card, each device making 20 edits while apart, then everyone merges");
    println!("| devices | merged state | merge all | same either order |");
    for replicas in [2usize, 12, 50, 100, 200] {
        let (size, ms, same) = grow(replicas, 20);
        println!("| {replicas:>7} | {size:>9} B | {ms:>7.1} ms | {same:>17} |");
        assert!(same, "merging must not depend on order");
    }

    // Overwriting one field leaves one value however often it is done; adding comments and items adds content
    println!("\nOne card, one device editing it over and over (does history pile up?)");
    println!("| edits | overwrite the title | random edits (adds comments, items, tags) |");
    let overwrite = |times: usize| {
        let mut card = base_card();
        let mut state = RecordState::from_legacy(card.paths(false), 1_000);
        for n in 0..times {
            card.title = format!("version {n}");
            state.diff_write("d0", &card.paths(false), 2_000 + n as u64, None);
        }
        bytes(&state)
    };
    let counts = [10usize, 100, 1000, 10_000];
    let overwritten: Vec<usize> = counts.iter().map(|&n| overwrite(n)).collect();
    for (edits, same) in counts.iter().zip(&overwritten) {
        let random = if *edits <= 1000 { format!("{} B", grow(1, *edits).0) } else { "-".into() };
        println!("| {edits:>5} | {same:>17} B | {random:>40} |");
    }
    assert!(overwritten[3] < overwritten[0] * 2, "overwriting a field must not keep its history");

    // Edits travel one record at a time; the whole workspace goes only when someone joins or asks for a re-sync
    println!("\nA workspace of N tasks: what a join or a manual re-sync sends");
    println!("| tasks | wire size | export | first merge | re-sync when nothing changed |");
    for n in [1_000usize, 5_000, 20_000] {
        let conn = |ws: &str| {
            let c = rusqlite::Connection::open_in_memory().unwrap();
            c.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
            crate::database::schema::init_schema(&c).unwrap();
            c.execute("INSERT INTO workspace (id, name, description, path, created_at, updated_at) VALUES (?1, 'w', '', '/w', 't', 't')", [ws]).unwrap();
            c
        };
        let (a, b) = (conn("a"), conn("b"));
        let tasks: Vec<Task> = (0..n).map(|i| Task { id: format!("t{i}"), title: format!("Task {i}"), assignee_id: None, ..base_task() }).collect();
        super::data_sync::merge_state(&a, "a", super::data_sync::DataState { tasks, ..Default::default() }).unwrap();

        let clock = std::time::Instant::now();
        let state = super::data_sync::export_state(&a, "a").unwrap();
        let export = clock.elapsed().as_secs_f64();
        let wire = bytes(&state);
        let clock = std::time::Instant::now();
        super::data_sync::merge_state(&b, "b", state).unwrap();
        let first = clock.elapsed().as_secs_f64();
        let clock = std::time::Instant::now();
        let changed = super::data_sync::merge_state(&b, "b", super::data_sync::export_state(&a, "a").unwrap()).unwrap();
        let again = clock.elapsed().as_secs_f64();
        assert!(!changed, "a second identical exchange changes nothing");
        println!("| {n:>5} | {:>6.1} MB | {export:>5.2} s | {first:>9.2} s | {again:>9.2} s (incl. export) |", wire as f64 / 1e6);
    }
}
