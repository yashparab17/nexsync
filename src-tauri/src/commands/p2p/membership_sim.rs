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
    /// Place in the arbiter's log (only the `Era` rule reads it; 0 until the arbiter has numbered the history)
    rank: usize,
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
    /// Epoch-resolved arbitration (Dougal, arXiv:2601.22963): an arbiter puts concurrent actions into one fixed order, a
    /// log every device replays from its start, skipping an action whose author lacked the right at that point. Modelled
    /// as the arbiter numbering the history in a random order that keeps causality; devices receive the log in order
    Era,
}

const RULES: [Rule; 4] = [Rule::Replay, Rule::Sticky, Rule::StickyPairBreak, Rule::Era];

/// The order every device uses: an action only after what it names, and among those available the owner's before the
/// Admins', removals before role changes, then the lower key, then the earlier
fn canonical(rule: Rule, acts: &BTreeMap<Id, Act>) -> Vec<Id> {
    let mut done: BTreeSet<Id> = BTreeSet::new();
    let mut out = Vec::new();
    while out.len() < acts.len() {
        let next = acts
            .values()
            .filter(|a| !done.contains(&a.id) && a.deps.iter().all(|d| done.contains(d) || !acts.contains_key(d)))
            .min_by_key(|a| if rule == Rule::Era { (a.rank, 0, 0, 0) } else { (0, usize::from(a.id.0 != OWNER), usize::from(!matches!(a.kind, Kind::Remove(_))), a.id.0 * 1_000_000 + a.id.1) })
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
    let order = canonical(rule, acts);
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
        if (rule == Rule::Replay || rule == Rule::Era) && !may(&st, admins_equal, a.id.0, a.kind) {
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
        let act = Act { id: (a, seq), kind, deps: seen[&a].keys().copied().collect(), rank: 0 };
        seen.get_mut(&a).unwrap().insert(act.id, act);
    }
    let mut all = BTreeMap::new();
    for s in seen.values() {
        all.extend(s.clone());
    }
    if rule == Rule::Era {
        // The arbiter numbers the history (only for this rule, so the other rules' random streams are unchanged)
        for (i, id) in arrival_order(rng, &all).into_iter().enumerate() {
            all.get_mut(&id).unwrap().rank = i + 1;
        }
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
            // With arbitration devices receive the arbiter's log, in order; otherwise in any order the actions name
            let order = if rule == Rule::Era {
                let mut log: Vec<Id> = h.acts.keys().copied().collect();
                log.sort_by_key(|id| h.acts[id].rank);
                log
            } else {
                arrival_order(&mut rng, &h.acts)
            };
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

// ── Every history, not a sample (N15) ──

/// Every action an author could make: remove a member, or give a role
fn all_kinds() -> Vec<Kind> {
    let mut v = Vec::new();
    for t in 1..KEYS {
        v.push(Kind::Remove(t));
        for r in [ADMIN, EDITOR, VIEWER] {
            v.push(Kind::Role(t, r));
        }
    }
    v
}

/// Every order in which the actions can arrive: each only after the ones it names
fn all_orders(acts: &BTreeMap<Id, Act>) -> Vec<Vec<Id>> {
    fn go(acts: &BTreeMap<Id, Act>, done: &mut Vec<Id>, out: &mut Vec<Vec<Id>>) {
        if done.len() == acts.len() {
            out.push(done.clone());
            return;
        }
        for a in acts.values() {
            if !done.contains(&a.id) && a.deps.iter().all(|d| done.contains(d)) {
                done.push(a.id);
                go(acts, done, out);
                done.pop();
            }
        }
    }
    let mut out = Vec::new();
    go(acts, &mut Vec::new(), &mut out);
    out
}

/// Calls `visit` once for every history of 1 to `n_max` actions by the owner (0) and the two Admins (1, 2). Each action names a
/// set of earlier actions that holds all of its author's own and everything those name; it is made only if its author may in the
/// list those actions give. Of two actions that do not depend on each other only one order is listed.
fn enumerate(admins_equal: bool, n_max: usize, visit: &mut impl FnMut(&BTreeMap<Id, Act>)) {
    fn go(acts: &mut Vec<Act>, admins_equal: bool, n_max: usize, kinds: &[Kind], visit: &mut impl FnMut(&BTreeMap<Id, Act>)) {
        if !acts.is_empty() {
            let m: BTreeMap<Id, Act> = acts.iter().map(|a| (a.id, a.clone())).collect();
            visit(&m);
        }
        let i = acts.len();
        if i == n_max {
            return;
        }
        let dep_masks: Vec<u32> = acts.iter().map(|a| acts.iter().enumerate().filter(|(_, b)| a.deps.contains(&b.id)).fold(0u32, |m, (j, _)| m | (1 << j))).collect();
        for actor in 0..3usize {
            let own: u32 = acts.iter().enumerate().filter(|(_, a)| a.id.0 == actor).fold(0, |m, (j, _)| m | (1 << j));
            let seq = acts.iter().filter(|a| a.id.0 == actor).count() + 1;
            for mask in 0u32..(1 << i) {
                if mask & own != own || (0..i).any(|j| mask >> j & 1 == 1 && mask & dep_masks[j] != dep_masks[j]) {
                    continue;
                }
                // Independent of the one before it: only the order with the higher author last
                if i > 0 && mask >> (i - 1) & 1 == 0 && actor <= acts[i - 1].id.0 {
                    continue;
                }
                let seen: BTreeMap<Id, Act> = acts.iter().enumerate().filter(|(j, _)| mask >> j & 1 == 1).map(|(_, a)| (a.id, a.clone())).collect();
                let (view, _) = resolve(Rule::Sticky, admins_equal, &seen);
                if actor != OWNER && view.role[actor] != ADMIN {
                    continue;
                }
                for kind in kinds {
                    if !may(&view, admins_equal, actor, *kind) {
                        continue;
                    }
                    acts.push(Act { id: (actor, seq), kind: *kind, deps: seen.keys().copied().collect(), rank: 0 });
                    go(acts, admins_equal, n_max, kinds, visit);
                    acts.pop();
                }
            }
        }
    }
    go(&mut Vec::new(), admins_equal, n_max, &all_kinds(), visit);
}

#[derive(Default, Clone, Debug)]
struct Exhaustive {
    /// Cases: a history under a merge rule, and for the arbiter each order it could have put the history in
    cases: usize,
    readmitted: usize,
    owner_hurt: usize,
    no_admin_left: usize,
    /// Valid actions that did not take effect, summed
    skipped: usize,
    actions: usize,
    /// The smallest history in which a removed member was let back in
    example: Option<String>,
}

const AUTHORS: [&str; 3] = ["owner", "A1", "A2"];

fn describe(acts: &BTreeMap<Id, Act>) -> String {
    let name = |id: &Id| format!("{}{}", AUTHORS[id.0], id.1);
    acts.values().map(|a| format!("{} {:?} after {:?}", name(&a.id), a.kind, a.deps.iter().map(name).collect::<Vec<_>>())).collect::<Vec<_>>().join("; ")
}

/// Did the list a device shows ever bring back a removed member, in any of these orders of arrival?
fn readmits(rule: Rule, admins_equal: bool, acts: &BTreeMap<Id, Act>, orders: &[Vec<Id>]) -> bool {
    orders.iter().any(|order| {
        let mut have: BTreeMap<Id, Act> = BTreeMap::new();
        let mut previous = initial();
        for id in order {
            have.insert(*id, acts[id].clone());
            let (now, _) = resolve(rule, admins_equal, &have);
            if (0..KEYS).any(|k| previous.role[k] == GONE && now.role[k] != GONE) {
                return true;
            }
            previous = now;
        }
        false
    })
}

/// The order of the arbiter's log
fn order_of(acts: &BTreeMap<Id, Act>) -> Vec<Id> {
    let mut v: Vec<Id> = acts.keys().copied().collect();
    v.sort_by_key(|id| acts[id].rank);
    v
}

/// Checks every history of up to `n_max` actions under every rule. Returns, per rule, the counts, and how many histories there were
/// and how many of them leave devices on different lists when no rule is used
fn check_all(admins_equal: bool, n_max: usize) -> (Vec<(Rule, Exhaustive)>, usize, usize) {
    let mut by_rule: Vec<(Rule, Exhaustive)> = RULES.iter().map(|r| (*r, Exhaustive::default())).collect();
    let (mut histories, mut disagree) = (0, 0);
    enumerate(admins_equal, n_max, &mut |acts| {
        histories += 1;
        let orders = all_orders(acts);
        let mut ends: Vec<State> = Vec::new();
        for order in &orders {
            let mut st = initial();
            for id in order {
                let a = &acts[id];
                if may(&st, admins_equal, a.id.0, a.kind) {
                    effect(&mut st, a.kind);
                }
            }
            ends.push(st);
        }
        disagree += usize::from(ends.windows(2).any(|w| w[0] != w[1]));
        for (rule, ex) in by_rule.iter_mut() {
            // The arbiter's log is any of the orders; the other rules are a function of the set alone
            let variants: Vec<BTreeMap<Id, Act>> = if *rule == Rule::Era {
                orders.iter().map(|o| acts.iter().map(|(id, a)| (*id, Act { rank: o.iter().position(|x| x == id).unwrap() + 1, ..a.clone() })).collect()).collect()
            } else {
                vec![acts.clone()]
            };
            for v in &variants {
                let (end, counts) = resolve(*rule, admins_equal, v);
                ex.cases += 1;
                ex.actions += v.len();
                ex.skipped += counts.skipped;
                ex.owner_hurt += usize::from(end.role[OWNER] != 0);
                ex.no_admin_left += usize::from(!end.role.contains(&ADMIN));
                // With an arbiter devices receive its log in order; otherwise any order the actions name
                let back = if *rule == Rule::Era { readmits(*rule, admins_equal, v, &[order_of(v)]) } else { readmits(*rule, admins_equal, v, &orders) };
                ex.readmitted += usize::from(back);
                if back && ex.example.as_ref().is_none_or(|e| e.len() > describe(v).len()) {
                    ex.example = Some(describe(v));
                }
            }
        }
    });
    (by_rule, histories, disagree)
}

#[test]
fn in_every_history_of_up_to_three_actions_the_sticky_rule_never_lets_a_removed_member_back_and_the_owner_is_safe() {
    for admins_equal in [true, false] {
        let (rows, histories, _) = check_all(admins_equal, 3);
        assert!(histories > 100, "only {histories} histories");
        for (rule, ex) in &rows {
            assert_eq!(ex.owner_hurt, 0, "{rule:?}: the owner was removed or demoted");
            if matches!(rule, Rule::Sticky | Rule::Era) {
                assert_eq!(ex.readmitted, 0, "{rule:?} let a removed member back in: {:?}", ex.example);
            }
        }
    }
}

#[test]
#[ignore = "prints the table used in RESEARCH.md; slow without --release"]
fn membership_exhaustive_table() {
    for admins_equal in [true, false] {
        for n_max in [3, 4] {
            let t = std::time::Instant::now();
            let (rows, histories, disagree) = check_all(admins_equal, n_max);
            println!(
                "\nAdmins {} act on Admins; every history of up to {n_max} actions: {histories} histories, {disagree} ({:.1}%) leave devices on different lists when they apply actions as they arrive; {:.0} s",
                if admins_equal { "may" } else { "may not" },
                100.0 * disagree as f64 / histories as f64,
                t.elapsed().as_secs_f64()
            );
            println!("| rule | cases | a removed member let back in | owner removed or demoted | no Admin left | valid actions with no effect (per 100) | smallest case of a removed member let back in |");
            println!("|---|---|---|---|---|---|---|");
            for (rule, ex) in rows {
                println!(
                    "| {rule:?} | {} | {} ({:.1}%) | {} | {} ({:.1}%) | {:.1} | {} |",
                    ex.cases,
                    ex.readmitted,
                    100.0 * ex.readmitted as f64 / ex.cases as f64,
                    ex.owner_hurt,
                    ex.no_admin_left,
                    100.0 * ex.no_admin_left as f64 / ex.cases as f64,
                    100.0 * ex.skipped as f64 / ex.actions.max(1) as f64,
                    ex.example.unwrap_or_else(|| "none".to_string())
                );
            }
        }
    }
}
