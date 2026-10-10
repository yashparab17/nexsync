//! Two Admins, one member list (RESEARCH.md §8k, N2). A simulation of a design that is not built.
//!
//! Today only the owner signs the member list, so two Admins cannot disagree about it: they ask the owner. If Admins'
//! signed actions became valid on their own (the owner's device being off should not stop a removal), two Admins could act
//! at the same time: remove each other, or one demotes a member while another removes them. This simulates random
//! histories of such actions and three ways to merge them, and counts what goes wrong. The rules are a choice, not a
//! proof of fairness.
//!
//! The actions: remove a member, or give a member a role. Each names every action its author had seen (its dependencies),
//! so two actions are concurrent when neither names the other. The owner is key 0 and can never be removed or demoted.
//!
//! Run the table with `cargo test membership_sim -- --nocapture`.

use std::collections::{BTreeMap, BTreeSet};

use rand::{rngs::StdRng, seq::SliceRandom, Rng, SeedableRng};

const KEYS: usize = 6;
const OWNER: usize = 0;
const ADMIN: u8 = 1;
const EDITOR: u8 = 2;
const VIEWER: u8 = 3;
const GONE: u8 = 9;

type Id = (usize, usize);

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Kind {
    Remove(usize),
    Role(usize, u8),
}

#[derive(Clone, Debug)]
struct Act {
    id: Id,
    kind: Kind,
    deps: BTreeSet<Id>,
}

#[derive(Clone, PartialEq, Eq, Debug)]
struct State {
    role: [u8; KEYS],
}

fn initial() -> State {
    // Key 0 is the owner (never in the table), 1 and 2 are Admins, 3 and 4 Editors, 5 a Viewer
    State { role: [0, ADMIN, ADMIN, EDITOR, EDITOR, VIEWER] }
}

/// Whether `actor` may do `kind` in `st`. Admins may not touch the owner and may not make Admins; with `admins_equal` they
/// may act on other Admins, otherwise only the owner may.
fn may(st: &State, admins_equal: bool, actor: usize, kind: Kind) -> bool {
    let (target, new_role) = match kind {
        Kind::Remove(t) => (t, None),
        Kind::Role(t, r) => (t, Some(r)),
    };
    if target == OWNER || st.role[target] == GONE {
        return false;
    }
    if actor == OWNER {
        return true;
    }
    if st.role[actor] != ADMIN || new_role == Some(ADMIN) {
        return false;
    }
    admins_equal || st.role[target] != ADMIN
}

fn effect(st: &mut State, kind: Kind) {
    match kind {
        Kind::Remove(t) => st.role[t] = GONE,
        Kind::Role(t, r) => {
            if st.role[t] != GONE {
                st.role[t] = r;
            }
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Rule {
    /// Apply in a fixed order (owner first, removals before role changes, lower key, earlier), skipping an action whose
    /// author no longer has the right in the list built so far
    Replay,
    /// Every action that was allowed when it was made counts, whoever its author has become since; removals stay removed
    Sticky,
    /// Sticky, except that when two Admins remove each other at the same time only the lower key's removal counts
    StickyPairBreak,
}

const RULES: [Rule; 3] = [Rule::Replay, Rule::Sticky, Rule::StickyPairBreak];

/// The order every device uses: an action only after what it names, and among those available the owner's before the
/// Admins', removals before role changes, then the lower key, then the earlier
fn canonical(acts: &BTreeMap<Id, Act>) -> Vec<Id> {
    let mut done: BTreeSet<Id> = BTreeSet::new();
    let mut out = Vec::new();
    while out.len() < acts.len() {
        let next = acts
            .values()
            .filter(|a| !done.contains(&a.id) && a.deps.iter().all(|d| done.contains(d) || !acts.contains_key(d)))
            .min_by_key(|a| (usize::from(a.id.0 != OWNER), usize::from(!matches!(a.kind, Kind::Remove(_))), a.id.0, a.id.1))
            .expect("a dependency cycle cannot happen");
        done.insert(next.id);
        out.push(next.id);
    }
    out
}

#[derive(Default, Clone, Copy)]
struct Counts {
    /// Actions allowed when made that did not take effect, because the author lost the right first
    skipped: usize,
    /// Role changes overwritten by a concurrent role change on the same member
    overwritten: usize,
}

/// The list every device with exactly these actions ends on
fn resolve(rule: Rule, admins_equal: bool, acts: &BTreeMap<Id, Act>) -> (State, Counts) {
    let mut st = initial();
    let mut counts = Counts::default();
    let order = canonical(acts);
    // Mutual removals: two removals that name each other's authors, neither having seen the other
    let suppressed: BTreeSet<Id> = if rule == Rule::StickyPairBreak {
        let removals: Vec<&Act> = acts.values().filter(|a| matches!(a.kind, Kind::Remove(_))).collect();
        let mut out = BTreeSet::new();
        for a in &removals {
            for b in &removals {
                let (Kind::Remove(ta), Kind::Remove(tb)) = (a.kind, b.kind) else { continue };
                if ta == b.id.0 && tb == a.id.0 && !a.deps.contains(&b.id) && !b.deps.contains(&a.id) && a.id.0 > b.id.0 {
                    out.insert(a.id);
                }
            }
        }
        out
    } else {
        BTreeSet::new()
    };
    let mut last_role: BTreeMap<usize, Id> = BTreeMap::new();
    for id in order {
        let a = &acts[&id];
        if suppressed.contains(&id) {
            counts.skipped += 1;
            continue;
        }
        if rule == Rule::Replay && !may(&st, admins_equal, a.id.0, a.kind) {
            counts.skipped += 1;
            continue;
        }
        if let Kind::Role(t, _) = a.kind {
            if st.role[t] == GONE {
                counts.overwritten += 1;
                continue;
            }
            if let Some(prev) = last_role.insert(t, id) {
                if !a.deps.contains(&prev) {
                    counts.overwritten += 1;
                }
            }
        }
        effect(&mut st, a.kind);
    }
    (st, counts)
}

struct History {
    acts: BTreeMap<Id, Act>,
    /// Pairs of actions that no one had seen when the other was made
    concurrent_pairs: usize,
}

/// Owner (0) and the two Admins (1, 2) act at random, each on the list their own copy of the actions shows, and
/// sometimes exchange what they have seen
fn generate(rng: &mut StdRng, rule: Rule, admins_equal: bool, steps: usize, p_sync: f64) -> History {
    let authors = [0usize, 1, 2];
    let mut seen: BTreeMap<usize, BTreeMap<Id, Act>> = authors.iter().map(|a| (*a, BTreeMap::new())).collect();
    let mut seq = 0;
    for _ in 0..steps {
        let a = authors[rng.gen_range(0..3)];
        if rng.gen_bool(p_sync) {
            let b = authors[rng.gen_range(0..3)];
            let theirs = seen[&b].clone();
            seen.get_mut(&a).unwrap().extend(theirs);
        }
        let (view, _) = resolve(rule, admins_equal, &seen[&a]);
        let target = rng.gen_range(1..KEYS);
        let kind = if rng.gen_bool(0.4) { Kind::Remove(target) } else { Kind::Role(target, [ADMIN, EDITOR, VIEWER][rng.gen_range(0..3)]) };
        // An Admin who has been removed in its own view cannot act; the owner always can
        if a != OWNER && view.role[a] != ADMIN {
            continue;
        }
        if !may(&view, admins_equal, a, kind) {
            continue;
        }
        seq += 1;
        let act = Act { id: (a, seq), kind, deps: seen[&a].keys().copied().collect() };
        seen.get_mut(&a).unwrap().insert(act.id, act);
    }
    let mut all = BTreeMap::new();
    for s in seen.values() {
        all.extend(s.clone());
    }
    let list: Vec<&Act> = all.values().collect();
    let mut concurrent_pairs = 0;
    for (i, x) in list.iter().enumerate() {
        for y in &list[i + 1..] {
            concurrent_pairs += usize::from(!x.deps.contains(&y.id) && !y.deps.contains(&x.id));
        }
    }
    History { acts: all, concurrent_pairs }
}

/// A random order in which a device could receive the actions: each only after the ones it names
fn arrival_order(rng: &mut StdRng, acts: &BTreeMap<Id, Act>) -> Vec<Id> {
    let mut left: Vec<Id> = acts.keys().copied().collect();
    left.shuffle(rng);
    let mut done: BTreeSet<Id> = BTreeSet::new();
    let mut out = Vec::new();
    while !left.is_empty() {
        let at = left.iter().position(|id| acts[id].deps.iter().all(|d| done.contains(d))).expect("actions only name earlier ones");
        let id = left.remove(at);
        done.insert(id);
        out.push(id);
    }
    out
}

#[derive(Default, Clone)]
struct Tally {
    histories: usize,
    with_concurrency: usize,
    /// Devices applying actions in the order they arrive (no merge rule) that did not end on the same list
    arrival_disagree: usize,
    /// Histories where, as actions arrived, a removed member was let back in at some point
    readmitted: usize,
    /// Histories where the list a device showed changed in a way that undid an earlier removal or promotion of a member
    skipped: usize,
    overwritten: usize,
    actions: usize,
    /// Histories ending with no Admin besides the owner
    no_admin_left: usize,
    owner_hurt: usize,
    /// Histories where two devices ended on different lists under the rule (must be none)
    diverged: usize,
}

fn study(rule: Rule, admins_equal: bool, steps: usize, p_sync: f64, trials: usize) -> Tally {
    let mut t = Tally::default();
    for i in 0..trials {
        let mut rng = StdRng::seed_from_u64(600_000 + i as u64 * 101 + steps as u64);
        let h = generate(&mut rng, rule, admins_equal, steps, p_sync);
        if h.acts.is_empty() {
            continue;
        }
        t.histories += 1;
        t.actions += h.acts.len();
        t.with_concurrency += usize::from(h.concurrent_pairs > 0);
        let (end, counts) = resolve(rule, admins_equal, &h.acts);
        t.skipped += counts.skipped;
        t.overwritten += counts.overwritten;
        t.no_admin_left += usize::from(!end.role.contains(&ADMIN));
        t.owner_hurt += usize::from(end.role[OWNER] != 0);

        // Four devices receive the same actions in different orders
        let mut naive_ends: Vec<State> = Vec::new();
        let mut readmit = false;
        for _ in 0..4 {
            let order = arrival_order(&mut rng, &h.acts);
            // No merge rule: apply what the author may do at that moment, in arrival order
            let mut st = initial();
            for id in &order {
                let a = &h.acts[id];
                if may(&st, admins_equal, a.id.0, a.kind) {
                    effect(&mut st, a.kind);
                }
            }
            naive_ends.push(st);
            // With the rule: recompute from what has arrived after each action
            let mut have: BTreeMap<Id, Act> = BTreeMap::new();
            let mut previous = initial();
            for id in &order {
                have.insert(*id, h.acts[id].clone());
                let (now, _) = resolve(rule, admins_equal, &have);
                readmit |= (0..KEYS).any(|k| previous.role[k] == GONE && now.role[k] != GONE);
                previous = now;
            }
            t.diverged += usize::from(previous != end);
        }
        t.arrival_disagree += usize::from(naive_ends.windows(2).any(|w| w[0] != w[1]));
        t.readmitted += usize::from(readmit);
    }
    t
}

#[test]
fn every_device_ends_on_the_same_list_the_owner_is_safe_and_sticky_rules_never_let_a_removed_member_back() {
    for rule in RULES {
        for admins_equal in [true, false] {
            let t = study(rule, admins_equal, 12, 0.3, 150);
            assert_eq!(t.diverged, 0, "{rule:?}");
            assert_eq!(t.owner_hurt, 0, "{rule:?}");
            // Only the plain sticky rule is monotone: a removal, once taken, stays
            if rule == Rule::Sticky {
                assert_eq!(t.readmitted, 0, "{rule:?} let a removed member back in");
            }
            // The other two can: the tiebreak of the pair-break rule undoes the first removal to arrive when its mirror arrives
            if rule == Rule::StickyPairBreak && admins_equal {
                assert!(study(rule, true, 12, 0.3, 600).readmitted > 0);
            }
        }
    }
}

#[test]
fn without_a_merge_rule_devices_that_receive_the_same_actions_can_end_on_different_lists() {
    let t = study(Rule::Sticky, true, 12, 0.3, 300);
    assert!(t.arrival_disagree > 0, "expected some disagreement, got none in {} histories", t.histories);
}

#[test]
#[ignore = "prints the table used in RESEARCH.md; run with --release"]
fn membership_sim_table() {
    let trials = 2_000;
    for admins_equal in [true, false] {
        println!(
            "\nAdmins {} act on other Admins; owner and two Admins act in total up to the number shown; {trials} histories per row",
            if admins_equal { "may" } else { "may not" }
        );
        println!("| actions | members sync before acting | rule | histories with concurrent actions | devices disagreeing with no rule | a removed member let back in | valid actions that did not take effect (per 100) | role changes overwritten (per 100) | no Admin left |");
        println!("|---|---|---|---|---|---|---|---|---|");
        for (steps, p_sync) in [(3, 0.3), (6, 0.1), (6, 0.3), (6, 0.7), (12, 0.3)] {
            for rule in RULES {
                let t = study(rule, admins_equal, steps, p_sync, trials);
                let h = t.histories.max(1) as f64;
                let a = t.actions.max(1) as f64;
                println!(
                    "| {steps} | {p_sync} | {rule:?} | {:.0}% | {:.1}% | {:.1}% | {:.1} | {:.1} | {:.1}% |",
                    100.0 * t.with_concurrency as f64 / h,
                    100.0 * t.arrival_disagree as f64 / h,
                    100.0 * t.readmitted as f64 / h,
                    100.0 * t.skipped as f64 / a,
                    100.0 * t.overwritten as f64 / a,
                    100.0 * t.no_admin_left as f64 / h,
                );
            }
        }
    }
}
