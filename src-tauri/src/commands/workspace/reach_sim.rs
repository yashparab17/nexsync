//! How far a removed member's work reaches into a workspace (RESEARCH.md §8i, N3).
//!
//! After a removal, which values on screen came from that member, and on which of them did other people build? A write
//! does not record what its author had seen, so "built on" is not stored. It can be read from the stored times: a write
//! is stamped above every time its author's copy of the record held, so a write that saw another is always stamped
//! later. The converse does not hold, since a faster clock stamps a write that did not see it later too. This simulation
//! uses the real `RecordState` to count, for four members editing and merging copies at random, how much of the visible
//! state is the removed member's, how much of that others built on (the truth, kept by the simulation), what the stamp
//! check flags, and what a plain "undo everything by this member" would overwrite.
//!
//! Run the table with `cargo test reach_sim_table -- --nocapture`.

#![allow(clippy::needless_range_loop)]

use std::collections::{BTreeMap, HashMap, HashSet};

use rand::{rngs::StdRng, Rng, SeedableRng};
use serde_json::json;

use super::crdt::{RecordState, Sibling};

const MEMBERS: [&str; 4] = ["O", "A", "B", "M"];
const REMOVED: usize = 3;
const PATHS: [&str; 7] = ["title", "description", "status", "priority", "due_date", "assignee_id", "column_id"];
const RECORDS: usize = 40;
const STEPS: usize = 600;
const MINUTE: i64 = 60_000;

#[derive(Default, Clone)]
struct Reach {
    trials: usize,
    visible: usize,
    /// Visible fields whose shown value is the removed member's
    by_m: usize,
    /// Of those, ones where another member wrote in the same record after seeing it (the truth)
    built_on: usize,
    /// Ones the stamp check flags: another member's write in the same record is stamped later
    flagged: usize,
    false_pos: usize,
    missed: usize,
    /// Paths where the removed member wrote and someone else later wrote over it; restoring the old value would undo that
    stomped: usize,
    /// Writes of the removed member that nobody sees any more
    hidden_m: usize,
    vv_bytes: usize,
    state_bytes: usize,
}

fn rank(s: &Sibling) -> (u64, &str, u64) {
    (s.ts, s.dot.r.as_str(), s.dot.c)
}

/// `p_sync` is the chance that, after an edit, two random members merge their copies of every record. `offsets` are the
/// members' clock errors in minutes.
fn trial(seed: u64, p_sync: f64, offsets: [i64; 4]) -> Reach {
    let mut rng = StdRng::seed_from_u64(seed);
    let mut start = RecordState::default();
    for p in PATHS {
        start.write("O", p, json!("start"), 0, Some("O"));
    }
    let mut copies: Vec<Vec<RecordState>> = vec![vec![start.clone(); RECORDS]; 4];
    // What the author's copy had seen when each write was made: the truth the stamp check is judged against
    let mut seen: HashMap<(usize, String, u64), BTreeMap<String, u64>> = HashMap::new();
    for rec in 0..RECORDS {
        for (r, c) in &start.vv {
            seen.insert((rec, r.clone(), *c), BTreeMap::new());
        }
    }
    // (record, path, member, index in time) for every edit, in order
    let mut log: Vec<(usize, &str, usize)> = Vec::new();
    for t in 0..STEPS {
        if rng.gen_bool(0.5) {
            let m = rng.gen_range(0..4);
            let rec = rng.gen_range(0..RECORDS);
            let path = PATHS[rng.gen_range(0..PATHS.len())];
            let now = (t as i64 * MINUTE + 1_000_000 + offsets[m] * MINUTE).max(0) as u64;
            let st = &mut copies[m][rec];
            let before = st.vv.clone();
            st.write(MEMBERS[m], path, json!(t), now, Some(MEMBERS[m]));
            seen.insert((rec, MEMBERS[m].to_string(), st.vv[MEMBERS[m]]), before);
            log.push((rec, path, m));
        }
        if rng.gen_bool(p_sync) {
            let a = rng.gen_range(0..4);
            let b = (a + rng.gen_range(1..4)) % 4;
            for rec in 0..RECORDS {
                let merged = copies[a][rec].merge(&copies[b][rec]);
                copies[a][rec] = merged.clone();
                copies[b][rec] = merged;
            }
        }
    }

    let mut out = Reach { trials: 1, ..Default::default() };
    let mut finals: Vec<RecordState> = Vec::new();
    for rec in 0..RECORDS {
        let mut state = copies[0][rec].clone();
        for m in 1..4 {
            state = state.merge(&copies[m][rec]);
        }
        finals.push(state);
    }
    let mut shown_by: HashMap<(usize, &str), usize> = HashMap::new();
    for (rec, state) in finals.iter().enumerate() {
        out.vv_bytes += serde_json::to_vec(&state.vv).unwrap().len();
        out.state_bytes += serde_json::to_vec(state).unwrap().len();
        for (path, siblings) in &state.fields {
            let Some(top) = siblings.iter().max_by_key(|s| rank(s)) else { continue };
            out.visible += 1;
            let who = MEMBERS.iter().position(|n| *n == top.dot.r).unwrap_or(0);
            shown_by.insert((rec, PATHS.iter().find(|p| **p == path).unwrap()), who);
            if top.dot.r != "M" {
                continue;
            }
            out.by_m += 1;
            let others: Vec<&Sibling> = state.fields.values().flatten().filter(|w| w.dot.r != "M").collect();
            let truth = others.iter().any(|w| seen.get(&(rec, w.dot.r.clone(), w.dot.c)).and_then(|v| v.get(&top.dot.r)).is_some_and(|c| *c >= top.dot.c));
            let flag = others.iter().any(|w| w.ts > top.ts);
            out.built_on += usize::from(truth);
            out.flagged += usize::from(flag);
            out.false_pos += usize::from(flag && !truth);
            out.missed += usize::from(truth && !flag);
        }
    }
    // Undoing everything: every path the removed member wrote that someone else wrote to afterwards
    let mut stomped: HashSet<(usize, &str)> = HashSet::new();
    let mut hidden: HashSet<(usize, &str)> = HashSet::new();
    for (i, (rec, path, m)) in log.iter().enumerate() {
        if *m != REMOVED {
            continue;
        }
        if log[i + 1..].iter().any(|(r2, p2, m2)| r2 == rec && p2 == path && *m2 != REMOVED) {
            stomped.insert((*rec, *path));
        }
        if shown_by.get(&(*rec, *path)) != Some(&REMOVED) {
            hidden.insert((*rec, *path));
        }
    }
    out.stomped = stomped.len();
    out.hidden_m = hidden.len();
    out
}

fn study(p_sync: f64, offsets: [i64; 4], trials: usize) -> Reach {
    let mut all = Reach::default();
    for i in 0..trials {
        let r = trial(31_000 + i as u64 * 17, p_sync, offsets);
        all.trials += 1;
        all.visible += r.visible;
        all.by_m += r.by_m;
        all.built_on += r.built_on;
        all.flagged += r.flagged;
        all.false_pos += r.false_pos;
        all.missed += r.missed;
        all.stomped += r.stomped;
        all.hidden_m += r.hidden_m;
        all.vv_bytes += r.vv_bytes;
        all.state_bytes += r.state_bytes;
    }
    all
}

#[test]
fn a_write_that_saw_another_is_always_stamped_later_so_the_check_never_misses_one() {
    // Whatever the clocks say, in every mix of syncing and every clock error
    for p_sync in [0.02, 0.2, 1.0] {
        for offsets in [[0; 4], [0, 60, 0, 0], [0, -60, 0, 0], [0, 0, 0, -240], [0, 0, 0, 240]] {
            let r = study(p_sync, offsets, 4);
            assert_eq!(r.missed, 0, "p_sync {p_sync}, offsets {offsets:?}");
            assert!(r.flagged >= r.built_on);
        }
    }
}

#[test]
fn syncing_more_often_means_more_of_the_removed_members_work_has_others_built_on_it() {
    let rare = study(0.02, [0; 4], 8);
    let often = study(1.0, [0; 4], 8);
    assert!(often.built_on as f64 / often.by_m.max(1) as f64 > rare.built_on as f64 / rare.by_m.max(1) as f64);
    // With true clocks and no syncing at all nothing was built on anything
    let never = study(0.0, [0; 4], 4);
    assert_eq!(never.built_on, 0);
    assert_eq!(never.flagged, never.built_on + never.false_pos);
}

#[test]
#[ignore = "prints the table used in RESEARCH.md; run with --release"]
fn reach_sim_table() {
    let trials = 200;
    let sets: [(&str, [i64; 4]); 3] = [("true clocks", [0; 4]), ("member A 1 hour fast", [0, 60, 0, 0]), ("removed member 1 hour slow", [0, 0, 0, -60])];
    println!("\nFour members edit {STEPS} times across {RECORDS} records of {} fields, then member M is removed. {trials} trials per row.", PATHS.len());
    println!("| clocks | sync chance per edit | visible fields | shown from M | others built on it (truth) | flagged by stamps | flagged wrongly | missed | M's paths later overwritten by others | M's writes no longer shown | version vector bytes / record bytes |");
    println!("|---|---|---|---|---|---|---|---|---|---|---|");
    for (name, offsets) in sets {
        for p_sync in [0.02, 0.1, 0.3, 1.0] {
            let r = study(p_sync, offsets, trials);
            let k = r.trials.max(1) as f64;
            let pct = |a: usize, b: usize| 100.0 * a as f64 / b.max(1) as f64;
            println!(
                "| {name} | {p_sync} | {:.0} | {:.1} ({:.1}%) | {:.1} ({:.1}% of M's) | {:.1} | {:.1} | {} | {:.1} | {:.1} | {:.0} / {:.0} |",
                r.visible as f64 / k,
                r.by_m as f64 / k,
                pct(r.by_m, r.visible),
                r.built_on as f64 / k,
                pct(r.built_on, r.by_m),
                r.flagged as f64 / k,
                r.false_pos as f64 / k,
                r.missed,
                r.stomped as f64 / k,
                r.hidden_m as f64 / k,
                r.vv_bytes as f64 / (k * RECORDS as f64),
                r.state_bytes as f64 / (k * RECORDS as f64),
            );
        }
    }
}
