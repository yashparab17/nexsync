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
use super::models::{ChecklistItem, Comment, KanbanCard};

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
