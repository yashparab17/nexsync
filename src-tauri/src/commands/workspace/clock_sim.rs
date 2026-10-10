//! What a wrong clock does to who wins when two devices change the same field at the same time (RESEARCH.md §8f).
//!
//! A field two devices changed while apart shows the write with the highest (time, replica, count), and the time is
//! the device's own clock. A write made after seeing another is forced above it (`RecordState::write`), so clocks cannot
//! reverse cause and effect. What is left is the contest between writes that did not see each other: the faster clock
//! wins it, whatever happened first. This measures how often, for a device whose clock is off by some amount, and what
//! two ways of making the contest fairer would cost.
//!
//! Run the table with `cargo test clock_sim -- --nocapture`.

use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

use rand::{rngs::StdRng, Rng, SeedableRng};
use serde_json::json;

use super::crdt::{RecordState, Sibling};

const SECOND: i64 = 1_000;
const MINUTE: i64 = 60 * SECOND;
const HOUR: i64 = 60 * MINUTE;
const DAY: i64 = 24 * HOUR;
const ROUNDS: usize = 4_000;
/// Two devices edit within half an hour of each other, each unaware of the other
const WINDOW: i64 = 30 * MINUTE;

#[derive(Clone, Copy)]
enum Rule {
    /// What the app does: highest (time, replica, count)
    Clock,
    /// Time rounded down to a bucket, and a fixed hash of the write decides inside the bucket
    Bucket(i64),
}

fn hashed(s: &Sibling) -> u64 {
    let mut h = DefaultHasher::new();
    (&s.dot.r, s.dot.c).hash(&mut h);
    h.finish()
}

fn pick(rule: Rule, siblings: &[Sibling]) -> &Sibling {
    match rule {
        Rule::Clock => siblings.iter().max_by_key(|s| (s.ts, s.dot.r.clone(), s.dot.c)).unwrap(),
        Rule::Bucket(width) => siblings.iter().max_by_key(|s| (s.ts / width as u64, hashed(s))).unwrap(),
    }
}

#[derive(Default, Clone, Copy)]
struct Tally {
    /// How often the device with the wrong clock won
    off_wins: usize,
    /// How often the write that really happened last lost
    inversions: usize,
    rounds: usize,
}

/// Device "on" has the right clock, device "off" is `offset` milliseconds fast (negative: slow)
fn contest(offset: i64, rule: Rule, seed: u64) -> Tally {
    contest_with(0, offset, rule, seed)
}

/// Like `contest`, with each device's stamps moved by a shift (what the clock watch adds)
fn contest_with(on_shift: i64, off_shift: i64, rule: Rule, seed: u64) -> Tally {
    let mut rng = StdRng::seed_from_u64(seed);
    let mut state = RecordState::from_legacy([("position".to_string(), json!(0))].into(), 1_000);
    let mut real: i64 = 1_000_000_000_000;
    let mut tally = Tally::default();
    for round in 0..ROUNDS {
        real += 6 * HOUR;
        let (t_on, t_off) = (real + rng.gen_range(0..WINDOW), real + rng.gen_range(0..WINDOW));
        let mut on = state.clone();
        on.write("on", "position", json!(format!("on-{round}")), (t_on + on_shift).max(0) as u64, None);
        let mut off = state.clone();
        off.write("off", "position", json!(format!("off-{round}")), (t_off + off_shift).max(0) as u64, None);
        let merged = on.merge(&off);
        let siblings = &merged.fields["position"];
        assert_eq!(siblings.len(), 2, "the two writes did not see each other");
        let shown = if matches!(rule, Rule::Clock) {
            // The app's own answer, to check the closure above agrees with it
            let app = merged.resolved()["position"].clone();
            assert_eq!(app, pick(rule, siblings).value, "the simulation's clock rule is not the app's");
            app
        } else {
            pick(rule, siblings).value.clone()
        };
        let off_won = shown == json!(format!("off-{round}"));
        let off_really_later = t_off > t_on;
        tally.rounds += 1;
        tally.off_wins += usize::from(off_won);
        tally.inversions += usize::from(off_won != off_really_later);
        state = merged;
    }
    tally
}

/// After seeing another device's write, a write is shown whatever the clock says. This is the part that already works.
fn after_seeing(offset: i64) -> (usize, usize) {
    let mut rng = StdRng::seed_from_u64(9);
    let (mut shown_now, mut shown_if_unforced) = (0, 0);
    let mut real: i64 = 1_000_000_000_000;
    let mut state = RecordState::from_legacy([("title".to_string(), json!("t"))].into(), 1_000);
    for round in 0..ROUNDS {
        real += HOUR;
        let t_a = real;
        state.write("on", "title", json!(format!("a-{round}")), t_a as u64, None);
        // The slow or fast device has now received that write and edits afterwards, by its own clock
        let mut theirs = state.clone();
        let clock = (real + rng.gen_range(1..10 * MINUTE) + offset).max(0);
        theirs.write("off", "title", json!(format!("b-{round}")), clock as u64, None);
        shown_now += usize::from(theirs.resolved()["title"] == json!(format!("b-{round}")));
        // What stamping with the bare clock would have done
        shown_if_unforced += usize::from(clock > t_a);
        state = theirs;
    }
    (shown_now, shown_if_unforced)
}

#[test]
fn a_write_made_after_seeing_another_is_shown_whatever_the_clock_says() {
    for offset in [-DAY, -HOUR, 0, HOUR, DAY] {
        let (now, _) = after_seeing(offset);
        assert_eq!(now, ROUNDS, "a write that had seen the other lost, with the clock {offset} ms off");
    }
    // And the floor is what does it: bare clock stamps would have lost them whenever the clock ran behind
    let (_, bare) = after_seeing(-HOUR);
    assert!(bare < ROUNDS / 10, "{bare}");
}

/// What the clock watch does to a pair whose clocks differ by `offset`: each reads the other's clock (late by the message
/// delay), moves to the middle, and the pair's stamps then differ by what is left. Returns the shift for each device.
fn corrected(offset: i64) -> (i64, i64) {
    use crate::commands::p2p::clock::SkewWatch;
    let key = |n: u8| iroh::SecretKey::from_bytes(&[n; 32]).public();
    let (mut right, mut odd) = (SkewWatch::default(), SkewWatch::default());
    let base = 1_000_000_000_000u64;
    for (i, delay) in [30i64, 90, 45, 200, 60].into_iter().enumerate() {
        let at = base + i as u64 * 60_000;
        // The odd device's clock reads `offset` more than true time; each message arrives `delay` late
        right.observe(key(2), (at as i64 + offset - delay) as u64, at);
        odd.observe(key(1), (at as i64 - delay) as u64, (at as i64 + offset) as u64);
    }
    (right.correction(&[key(2)]), offset + odd.correction(&[key(1)]))
}

#[test]
fn clock_sim_table() {
    let offsets: [(&str, i64); 11] = [
        ("1 day slow", -DAY), ("1 hour slow", -HOUR), ("10 min slow", -10 * MINUTE), ("1 min slow", -MINUTE), ("1 s slow", -SECOND), ("exact", 0),
        ("1 s fast", SECOND), ("1 min fast", MINUTE), ("10 min fast", 10 * MINUTE), ("1 hour fast", HOUR), ("1 day fast", DAY),
    ];
    let rules: [(&str, Rule); 4] = [("app: clock, no correction", Rule::Clock), ("1 min bucket + hash", Rule::Bucket(MINUTE)), ("1 hour bucket + hash", Rule::Bucket(HOUR)), ("hash only", Rule::Bucket(i64::MAX / 2))];
    println!("\nTwo devices change one field within {} minutes of each other, unaware of each other, {ROUNDS} times.", WINDOW / MINUTE);
    println!("The odd device's clock is off by the amount shown. Cells: share of contests it wins / share where the write that really came last lost.");
    print!("| odd device |");
    for (name, _) in &rules {
        print!(" {name} |");
    }
    print!(" app: clock, with the clock watch |");
    println!("\n|---|{}---|", "---|".repeat(rules.len()));
    let mut baseline_exact = Tally::default();
    let mut baseline_slow_day = Tally::default();
    for (label, offset) in offsets {
        print!("| {label} |");
        for (i, (_, rule)) in rules.iter().enumerate() {
            let t = contest(offset, *rule, 77);
            print!(" {:.0}% / {:.0}% |", 100.0 * t.off_wins as f64 / t.rounds as f64, 100.0 * t.inversions as f64 / t.rounds as f64);
            if i == 0 && offset == 0 {
                baseline_exact = t;
            }
            if i == 0 && offset == -DAY {
                baseline_slow_day = t;
            }
        }
        let (on_shift, off_shift) = corrected(offset);
        let t = contest_with(on_shift, off_shift, Rule::Clock, 77);
        println!(" {:.0}% / {:.0}% |", 100.0 * t.off_wins as f64 / t.rounds as f64, 100.0 * t.inversions as f64 / t.rounds as f64);
        if offset.abs() >= 10 * MINUTE {
            assert!(t.inversions * 100 / t.rounds < 3, "with the clock watch a device {label} still lost contests it should not");
        }
    }
    println!("\nA write made after seeing the other is shown in {}/{ROUNDS} rounds with the app's rule, whatever the clock; bare clock stamps would show it in {} of {ROUNDS} when the clock is an hour slow", after_seeing(-HOUR).0, after_seeing(-HOUR).1);
    // With the right clock the app never lets an earlier write beat a later one, and a day-slow device never wins
    assert_eq!(baseline_exact.inversions, 0);
    assert_eq!(baseline_slow_day.off_wins, 0);
}
