//! How often members of a workspace can reach each other when their devices are on and off, with the host as the only
//! hub and with members linked directly, and how long a removed member's old list stays dangerous.
//!
//! This is a model, not a network test. Each device alternates between online and offline sessions of random length, and
//! a link exists whenever the rules of the design say two online devices would have one. It says what the design
//! changes, under stated assumptions; it does not say what real people's devices do. Every trial gives all the modes the
//! same on/off timelines, so the modes are compared on identical days.
//!
//! Run the tables with: `cargo test hostless_sim -- --ignored --nocapture`

// The loops index several arrays by device number and by step at once, which reads more plainly than iterator chains
#![allow(clippy::needless_range_loop)]

use rand::{rngs::StdRng, Rng, SeedableRng};

use super::membership;

/// One step is five minutes
const STEP_MIN: usize = 5;
const DAY: usize = 24 * 60 / STEP_MIN;
const HORIZON: usize = 14 * DAY;
/// An edit is made at a random time in the first three days, which leaves eleven for it to spread
const EDIT_WINDOW: usize = 3 * DAY;
/// Steps two members must both have been online before they have a direct link; measured at 13 s, taken as one step
const LINK_DELAY: usize = 1;
/// A guest is online about a third of the time, in sessions of about three hours; the host's uptime is varied
const GUEST_UPTIME: f64 = 0.35;
const GUEST_SESSION_MIN: f64 = 180.0;
const HOST_SESSION_MIN: f64 = 240.0;

/// How devices are linked: the host is the only hub (the star), plus the guest-to-guest links the host used to vouch for
/// that last only while both stay online (vouched), plus every online pair of members linking directly (mesh)
#[derive(Clone, Copy, PartialEq, Debug)]
enum Mode {
    Star,
    Vouched,
    Mesh,
}

/// Device 0 is the host and owner; the rest are guests. Each timeline says whether the device is online at each step.
fn world(rng: &mut StdRng, guests: usize, host_uptime: f64, steps: usize) -> Vec<Vec<bool>> {
    let mut devices = vec![timeline(rng, host_uptime, HOST_SESSION_MIN, steps)];
    for _ in 0..guests {
        devices.push(timeline(rng, GUEST_UPTIME, GUEST_SESSION_MIN, steps));
    }
    devices
}

/// Online and offline sessions with exponentially distributed lengths, whose long-run online share is `uptime`
fn timeline(rng: &mut StdRng, uptime: f64, mean_session_min: f64, steps: usize) -> Vec<bool> {
    if uptime >= 0.999 {
        return vec![true; steps];
    }
    let mean_on = mean_session_min / STEP_MIN as f64;
    let mean_off = mean_on * (1.0 - uptime) / uptime;
    let mut online = rng.gen_bool(uptime);
    let mut out = Vec::with_capacity(steps);
    while out.len() < steps {
        let mean = if online { mean_on } else { mean_off };
        let len = (-mean * (1.0 - rng.gen::<f64>()).ln()).ceil().max(1.0) as usize;
        let len = len.min(steps - out.len());
        out.extend(std::iter::repeat_n(online, len));
        online = !online;
    }
    out
}

/// What the links depend on besides who is online now: how long each has been online, and which guests were online
/// together with the host and so were introduced to each other
struct Net {
    online_for: Vec<usize>,
    vouched: Vec<Vec<bool>>,
}

impl Net {
    fn new(n: usize) -> Self {
        Net { online_for: vec![0; n], vouched: vec![vec![false; n]; n] }
    }

    fn advance(&mut self, on: &[bool]) {
        let n = on.len();
        for d in 0..n {
            self.online_for[d] = if on[d] { self.online_for[d] + 1 } else { 0 };
        }
        // A guest that goes offline loses its introductions, since they were links in a session that has ended
        for d in 1..n {
            if !on[d] {
                for e in 0..n {
                    self.vouched[d][e] = false;
                    self.vouched[e][d] = false;
                }
            }
        }
        if on[0] {
            for a in 1..n {
                for b in 1..n {
                    if a != b && on[a] && on[b] {
                        self.vouched[a][b] = true;
                    }
                }
            }
        }
    }

    /// Which group each device is in right now; devices that cannot reach each other are in different groups.
    /// `valid` says which guests may link directly (all of them, unless a lease has run out), and `skip` leaves one guest
    /// out of every link.
    fn groups(&self, mode: Mode, on: &[bool], valid: &[bool], skip: Option<usize>) -> Vec<usize> {
        let n = on.len();
        let mut parent: Vec<usize> = (0..n).collect();
        fn find(parent: &mut [usize], x: usize) -> usize {
            let mut root = x;
            while parent[root] != root {
                root = parent[root];
            }
            let mut at = x;
            while parent[at] != root {
                let next = parent[at];
                parent[at] = root;
                at = next;
            }
            root
        }
        let join = |parent: &mut Vec<usize>, a: usize, b: usize| {
            let (ra, rb) = (find(parent, a), find(parent, b));
            parent[ra] = rb;
        };
        for g in 1..n {
            if skip != Some(g) && on[0] && on[g] {
                join(&mut parent, 0, g);
            }
        }
        for a in 1..n {
            for b in a + 1..n {
                if skip == Some(a) || skip == Some(b) || !on[a] || !on[b] {
                    continue;
                }
                let introduced = mode != Mode::Star && self.vouched[a][b];
                let direct = mode == Mode::Mesh && self.online_for[a] >= LINK_DELAY && self.online_for[b] >= LINK_DELAY && valid[a] && valid[b];
                if introduced || direct {
                    join(&mut parent, a, b);
                }
            }
        }
        (0..n).map(|d| find(&mut parent, d)).collect()
    }
}

fn percentile(sorted: &[f64], p: f64) -> f64 {
    if sorted.is_empty() {
        return f64::NAN;
    }
    sorted[((sorted.len() - 1) as f64 * p).round() as usize]
}

// ────────────────────────────
// Study 1: can members reach each other, and how long does an edit take to reach everyone
// ────────────────────────────

#[derive(Default, Clone)]
struct Delivery {
    /// Share of the time two guests could exchange changes, directly or through whoever links them
    pair_available: f64,
    /// Hours from an edit to every guest having it; an edit that had not arrived by the end counts as the whole span
    hours: Vec<f64>,
    /// The same, until the host has it too
    hours_with_host: Vec<f64>,
    within_a_day: usize,
    trials: usize,
}

/// One trial in one mode: pair availability over the whole span, and the steps for an edit by a random guest to reach
/// every guest, and to reach the host as well
fn deliver(on: &[Vec<bool>], mode: Mode, edit_at: usize, author: usize) -> (f64, Option<usize>, Option<usize>) {
    let n = on.len();
    let mut net = Net::new(n);
    let valid = vec![true; n];
    let mut has = vec![false; n];
    let (mut together, mut done_at, mut guests_at) = (0usize, None, None);
    for t in 0..HORIZON {
        let now: Vec<bool> = (0..n).map(|d| on[d][t]).collect();
        net.advance(&now);
        let group = net.groups(mode, &now, &valid, None);
        if now[1] && now[2] && group[1] == group[2] {
            together += 1;
        }
        if t == edit_at {
            has[author] = true;
        }
        if t >= edit_at && (done_at.is_none() || guests_at.is_none()) {
            // Everything in a group ends up with whatever any member of it has
            for d in 0..n {
                if has[d] {
                    for e in 0..n {
                        if now[e] && now[d] && group[e] == group[d] {
                            has[e] = true;
                        }
                    }
                }
            }
            if guests_at.is_none() && has[1..].iter().all(|h| *h) {
                guests_at = Some(t - edit_at);
            }
            if done_at.is_none() && has.iter().all(|h| *h) {
                done_at = Some(t - edit_at);
            }
        }
    }
    (together as f64 / HORIZON as f64, guests_at, done_at)
}

fn study_delivery(guests: usize, host_uptime: f64, trials: usize) -> [Delivery; 3] {
    let mut out: [Delivery; 3] = Default::default();
    for trial in 0..trials {
        let mut rng = StdRng::seed_from_u64(7_000 + trial as u64 * 131 + guests as u64 * 17 + (host_uptime * 100.0) as u64);
        let on = world(&mut rng, guests, host_uptime, HORIZON);
        let author = rng.gen_range(1..=guests);
        let wanted = rng.gen_range(0..EDIT_WINDOW);
        let Some(edit_at) = (wanted..HORIZON).find(|t| on[author][*t]) else { continue };
        for (i, mode) in [Mode::Star, Mode::Vouched, Mode::Mesh].into_iter().enumerate() {
            let (available, guests, all) = deliver(&on, mode, edit_at, author);
            let d = &mut out[i];
            let hours = |steps: Option<usize>| steps.unwrap_or(HORIZON - edit_at) as f64 * STEP_MIN as f64 / 60.0;
            d.trials += 1;
            d.pair_available += available;
            d.within_a_day += usize::from(guests.is_some_and(|s| s <= DAY));
            d.hours.push(hours(guests));
            d.hours_with_host.push(hours(all));
        }
    }
    for d in out.iter_mut() {
        d.pair_available /= d.trials.max(1) as f64;
        d.hours.sort_by(|a, b| a.partial_cmp(b).unwrap());
        d.hours_with_host.sort_by(|a, b| a.partial_cmp(b).unwrap());
    }
    out
}

// ────────────────────────────
// Study 2: a removed member and a list that has not heard about it
// ────────────────────────────

const HORIZON2: usize = 30 * DAY;
/// The owner removes a member some time in this window, by which point every lease has had time to age
const REMOVAL_WINDOW: std::ops::Range<usize> = 8 * DAY..12 * DAY;

#[derive(Default, Clone)]
struct Revocation {
    trials: usize,
    /// Trials in which the removed member linked to at least one device that had not yet heard
    leaked: usize,
    /// Hours the removed member spent linked to a device that had not heard, summed over trials
    leak_hours: f64,
    /// Hours from the removal until every remaining device had heard (unfinished counts as the whole span)
    informed_hours: Vec<f64>,
    /// Share of the time after the removal that two remaining guests could exchange changes
    pair_available: f64,
}

/// What one run of `revoke` saw
struct Run {
    /// The removed member linked to a device that had not heard and that believed its list still good
    leaked: bool,
    /// Hours of that
    leak_hours: f64,
    /// Hours of it that were wrong: the device's list had in fact run out, but its clock said it had not
    wrong_admit_hours: f64,
    all_heard_at: Option<usize>,
    pair_available: f64,
    /// Share of online time of the remaining guests spent refusing links although the list was in fact still good
    wrong_refusal: f64,
    /// Per step from the removal on: the removed device could reach a device that had not heard and would accept it
    accepted_by: Vec<bool>,
    /// Per step from the removal on: it could reach a device that had heard, which refuses it and says why
    told_by: Vec<bool>,
}

/// Device 1 is removed. `lease` is how long a device keeps linking to other members after it last heard (through any
/// chain of links) from the owner; `usize::MAX` is no lease at all. `offsets` is how many steps each device's clock is
/// ahead of true time (negative: behind). The owner signs with its own clock and every other device reads the lease with
/// its own, as the code does. With `watch`, a device linked to at least two others takes the median of their clocks
/// as its own, which is what the clock watch does to write stamps (`clock.rs`).
fn revoke(on: &[Vec<bool>], lease: usize, removal: usize, offsets: &[i64], watch: bool) -> Run {
    let n = on.len();
    let removed = 1usize;
    let mut net = Net::new(n);
    let mut heard = vec![false; n];
    heard[0] = true;
    // When each device last had word from the owner, which is how a lease runs out
    let mut word = vec![0usize; n];
    let lease_i = lease.min(1 << 40) as i64;
    let mut eff: Vec<i64> = offsets.to_vec();
    let mut prev_group: Vec<usize> = (0..n).collect();
    let (mut leaked, mut leak_steps, mut wrong_steps, mut all_heard_at) = (false, 0usize, 0usize, None);
    let (mut together, mut counted) = (0usize, 0usize);
    let (mut refused, mut online_steps) = (0usize, 0usize);
    let (mut accepted_by, mut told_by) = (vec![false; HORIZON2], vec![false; HORIZON2]);
    for t in 0..HORIZON2 {
        let now: Vec<bool> = (0..n).map(|d| on[d][t]).collect();
        net.advance(&now);
        if watch {
            for d in 0..n {
                if d == removed || !now[d] {
                    continue;
                }
                let mut mates: Vec<i64> = (0..n).filter(|e| *e != removed && now[*e] && prev_group[*e] == prev_group[d]).map(|e| offsets[e]).collect();
                if mates.len() >= 3 {
                    mates.sort();
                    let median = mates[mates.len() / 2];
                    if (median - eff[d]).abs() >= 1 {
                        eff[d] = median;
                    }
                }
            }
        }
        // What each device believes about its list, from its own clock against the time the owner's clock signed it
        let believed_ok = |d: usize| d == 0 || (t as i64 - word[d] as i64) + eff[d] - offsets[0] <= lease_i;
        let truly: Vec<bool> = (0..n).map(|d| d == 0 || t.saturating_sub(word[d]) <= lease).collect();
        let valid: Vec<bool> = (0..n).map(believed_ok).collect();
        let group = net.groups(Mode::Mesh, &now, &valid, Some(removed));
        prev_group = group.clone();
        if now[0] {
            word[0] = t;
        }
        // Word from the owner, and the news of the removal, spread through each group
        for d in 0..n {
            for e in 0..n {
                if d != removed && e != removed && now[d] && now[e] && group[d] == group[e] {
                    word[e] = word[e].max(word[d]);
                    if t >= removal && heard[d] {
                        heard[e] = true;
                    }
                }
            }
        }
        if t >= removal {
            // The removed device can link to any online device that still lists it and still acts on its list
            if now[removed] {
                accepted_by[t] = (2..n).any(|d| now[d] && !heard[d] && valid[d]);
                told_by[t] = now[0] || (2..n).any(|d| now[d] && heard[d]);
                if (2..n).any(|d| now[d] && !heard[d] && valid[d]) {
                    leaked = true;
                    leak_steps += 1;
                }
                if (2..n).any(|d| now[d] && !heard[d] && valid[d] && !truly[d]) {
                    wrong_steps += 1;
                }
            }
            for d in 2..n {
                if now[d] {
                    online_steps += 1;
                    refused += usize::from(!valid[d] && truly[d]);
                }
            }
            if now[2] && now[3] && group[2] == group[3] {
                together += 1;
            }
            counted += 1;
            if all_heard_at.is_none() && (0..n).filter(|d| *d != removed).all(|d| heard[d]) {
                all_heard_at = Some(t - removal);
            }
        }
    }
    let hours = |s: usize| s as f64 * STEP_MIN as f64 / 60.0;
    Run {
        leaked,
        leak_hours: hours(leak_steps),
        wrong_admit_hours: hours(wrong_steps),
        all_heard_at,
        pair_available: together as f64 / counted.max(1) as f64,
        wrong_refusal: refused as f64 / online_steps.max(1) as f64,
        accepted_by,
        told_by,
    }
}

fn study_revocation(host_uptime: f64, lease: usize, trials: usize) -> Revocation {
    let mut r = Revocation::default();
    for trial in 0..trials {
        let mut rng = StdRng::seed_from_u64(91_000 + trial as u64 * 211 + (host_uptime * 100.0) as u64);
        let on = world(&mut rng, 4, host_uptime, HORIZON2);
        let wanted = rng.gen_range(REMOVAL_WINDOW);
        let Some(removal) = (wanted..HORIZON2).find(|t| on[0][*t]) else { continue };
        let run = revoke(&on, lease, removal, &[0; 5], false);
        r.trials += 1;
        r.leaked += usize::from(run.leaked);
        r.leak_hours += run.leak_hours;
        r.pair_available += run.pair_available;
        r.informed_hours.push(run.all_heard_at.map_or((HORIZON2 - removal) as f64, |s| s as f64) * STEP_MIN as f64 / 60.0);
    }
    r.pair_available /= r.trials.max(1) as f64;
    r.informed_hours.sort_by(|a, b| a.partial_cmp(b).unwrap());
    r
}

// ────────────────────────────
// Study 3: what linking every pair costs
// ────────────────────────────

/// Bytes of the signed member list for `members` members, and how long checking it takes
fn list_cost(members: usize) -> (usize, f64) {
    let owner = iroh::SecretKey::from_bytes(&[1u8; 32]);
    let roster: Vec<(String, String)> = (0..members as u8).map(|s| (iroh::SecretKey::from_bytes(&[s.wrapping_add(10); 32]).public().to_string(), "Editor".to_string())).collect();
    let doc = membership::next(None, &owner, "workspace", "A workspace", roster).unwrap().unwrap();
    let bytes = serde_json::to_vec(&doc).unwrap().len();
    let began = std::time::Instant::now();
    for _ in 0..200 {
        doc.verify().unwrap();
    }
    (bytes, began.elapsed().as_secs_f64() * 1e6 / 200.0)
}

// ────────────────────────────
// Study 4 (N5): which rules depend on the clock. The lease, with devices whose clocks are wrong
// ────────────────────────────

#[derive(Default)]
struct ClockRun {
    trials: usize,
    leaked: usize,
    leak_hours: f64,
    wrong_admit_hours: f64,
    wrong_refusal: f64,
    pair_available: f64,
}

/// Four guests (device 1 removed), the owner online `host_uptime` of the time, a one-day lease, and `offsets` in
/// minutes for devices 0 to 4. Offsets are rounded to whole steps.
fn study_clock(host_uptime: f64, offsets_min: [i64; 5], watch: bool, trials: usize) -> ClockRun {
    let offsets: Vec<i64> = offsets_min.iter().map(|m| m / STEP_MIN as i64).collect();
    let mut out = ClockRun::default();
    for trial in 0..trials {
        // The same timelines as study_revocation, so the rows compare with its table
        let mut rng = StdRng::seed_from_u64(91_000 + trial as u64 * 211 + (host_uptime * 100.0) as u64);
        let on = world(&mut rng, 4, host_uptime, HORIZON2);
        let wanted = rng.gen_range(REMOVAL_WINDOW);
        let Some(removal) = (wanted..HORIZON2).find(|t| on[0][*t]) else { continue };
        let run = revoke(&on, DAY, removal, &offsets, watch);
        out.trials += 1;
        out.leaked += usize::from(run.leaked);
        out.leak_hours += run.leak_hours;
        out.wrong_admit_hours += run.wrong_admit_hours;
        out.wrong_refusal += run.wrong_refusal;
        out.pair_available += run.pair_available;
    }
    out
}

// ────────────────────────────
// Study 5 (N6): who has seen a post, with no server
// ────────────────────────────

#[derive(Default, Clone)]
struct Acks {
    /// Hours from a post until the poster holds acknowledgements from half the other members, and from all of them.
    /// A post that had not got there by the end counts as the whole span.
    half: Vec<f64>,
    all: Vec<f64>,
    /// The same when an acknowledgement reaches the poster only from the member who signed it
    half_direct: Vec<f64>,
    all_direct: Vec<f64>,
}

/// A member acknowledges the first time it is online holding the post. Everything in a group of linked devices ends up
/// with every post and acknowledgement any of them has (carried), or the poster only takes an acknowledgement from the
/// device that signed it (direct). Returns steps until the poster has half and all of the others, in both ways.
fn acknowledge(on: &[Vec<bool>], mode: Mode, post_at: usize, poster: usize) -> [Option<usize>; 4] {
    let n = on.len();
    let others = n - 1;
    let half = others.div_ceil(2);
    let mut net = Net::new(n);
    let valid = vec![true; n];
    let mut has = vec![false; n];
    let mut knows = vec![vec![false; n]; n];
    let mut direct = vec![false; n];
    let mut at = [None; 4];
    for t in 0..HORIZON {
        let now: Vec<bool> = (0..n).map(|d| on[d][t]).collect();
        net.advance(&now);
        let group = net.groups(mode, &now, &valid, None);
        if t < post_at {
            continue;
        }
        if t == post_at {
            has[poster] = true;
        }
        // Whoever has the post passes it on; each device holding it acknowledges; then acknowledgements are passed on
        for g in 0..n {
            if (0..n).any(|d| now[d] && group[d] == g && has[d]) {
                for d in (0..n).filter(|d| now[*d] && group[*d] == g) {
                    has[d] = true;
                }
            }
        }
        for d in 0..n {
            if now[d] && has[d] {
                knows[d][d] = true;
            }
        }
        for g in 0..n {
            let members: Vec<usize> = (0..n).filter(|d| now[*d] && group[*d] == g).collect();
            let mut union = vec![false; n];
            for d in &members {
                for m in 0..n {
                    union[m] |= knows[*d][m];
                }
            }
            for d in &members {
                knows[*d] = union.clone();
            }
            if members.contains(&poster) {
                for m in &members {
                    if *m != poster && has[*m] {
                        direct[*m] = true;
                    }
                }
            }
        }
        let carried = (0..n).filter(|m| *m != poster && knows[poster][*m]).count();
        let straight = (0..n).filter(|m| *m != poster && direct[*m]).count();
        for (i, (count, need)) in [(carried, half), (carried, others), (straight, half), (straight, others)].into_iter().enumerate() {
            if at[i].is_none() && count >= need {
                at[i] = Some(t - post_at);
            }
        }
        if at.iter().all(|a| a.is_some()) {
            break;
        }
    }
    at
}

fn study_acks(guests: usize, host_uptime: f64, mode: Mode, trials: usize) -> Acks {
    let mut out = Acks::default();
    for trial in 0..trials {
        let mut rng = StdRng::seed_from_u64(55_000 + trial as u64 * 97 + guests as u64 * 13 + (host_uptime * 100.0) as u64);
        let on = world(&mut rng, guests, host_uptime, HORIZON);
        let poster = rng.gen_range(1..=guests);
        let wanted = rng.gen_range(0..EDIT_WINDOW);
        let Some(post_at) = (wanted..HORIZON).find(|t| on[poster][*t]) else { continue };
        let [h, a, hd, ad] = acknowledge(&on, mode, post_at, poster);
        let hours = |steps: Option<usize>| steps.unwrap_or(HORIZON - post_at) as f64 * STEP_MIN as f64 / 60.0;
        out.half.push(hours(h));
        out.all.push(hours(a));
        out.half_direct.push(hours(hd));
        out.all_direct.push(hours(ad));
    }
    for v in [&mut out.half, &mut out.all, &mut out.half_direct, &mut out.all_direct] {
        v.sort_by(|a, b| a.partial_cmp(b).unwrap());
    }
    out
}

/// Bytes of one signed acknowledgement as it would travel, and how many the poster stores for `members` members
fn ack_cost(members: usize) -> (usize, usize) {
    let key = iroh::SecretKey::from_bytes(&[3u8; 32]);
    let post = "0".repeat(36);
    let by = key.public().to_string();
    let sig = key.sign(format!("ack:{post}:{by}").as_bytes());
    let one = serde_json::to_vec(&serde_json::json!({ "post": post, "by": by, "sig": crate::commands::workspace::signing::to_hex(&sig.to_bytes()) })).unwrap().len();
    (one, one * (members - 1))
}

// ────────────────────────────
// Study 6 (N1): edits made before the removal was heard
// ────────────────────────────

/// How many edits by the removed member in each situation, summed over trials
#[derive(Default, Clone)]
struct Held {
    trials: usize,
    /// Made before the removal and not yet shared with anyone when it happened
    waiting: usize,
    /// Made after the removal and before the device heard of it (it could not know)
    unknowing: usize,
    /// Made after it heard
    knowing: usize,
    /// Of waiting and unknowing, ones that reached a device that had not heard, which accepts them today
    let_in_honest: usize,
    /// Of knowing, ones that reached such a device
    let_in_knowing: usize,
    /// Hours from the removal until the removed device first reached a device that had heard
    hours_to_hear: Vec<f64>,
}

/// The removed member edits about three times an hour while its device is on. Edits made before the removal are shared
/// at once if the device is linked to anyone; the rest wait. After the removal, edits are counted for a week.
fn held_writes(on: &[Vec<bool>], run: &Run, removal: usize, rng: &mut StdRng, out: &mut Held) {
    let n = on.len();
    let end = (removal + 7 * DAY).min(HORIZON2);
    // The first step it reached a device that had heard of the removal
    let Some(heard_at) = (removal..HORIZON2).find(|t| run.told_by[*t]) else { return };
    out.hours_to_hear.push((heard_at - removal) as f64 * STEP_MIN as f64 / 60.0);
    // Reached a device that would accept, from step `t` on and within the week
    let accepted_from = |t: usize| (t.max(removal)..end).any(|s| run.accepted_by[s]);
    for t in removal.saturating_sub(3 * DAY)..end {
        if !on[1][t] || !rng.gen_bool(0.25) {
            continue;
        }
        if t < removal {
            // Shared before the removal if the device was linked to anyone in the steps after the edit and before it
            let shared = (t..removal).any(|s| on[1][s] && (0..n).any(|d| d != 1 && on[d][s]));
            if shared {
                continue;
            }
            out.waiting += 1;
            out.let_in_honest += usize::from(accepted_from(t));
        } else if t < heard_at {
            out.unknowing += 1;
            out.let_in_honest += usize::from(accepted_from(t));
        } else {
            out.knowing += 1;
            out.let_in_knowing += usize::from(accepted_from(t));
        }
    }
}

fn study_held(host_uptime: f64, lease: usize, trials: usize) -> Held {
    let mut out = Held::default();
    for trial in 0..trials {
        let mut rng = StdRng::seed_from_u64(91_000 + trial as u64 * 211 + (host_uptime * 100.0) as u64);
        let on = world(&mut rng, 4, host_uptime, HORIZON2);
        let wanted = rng.gen_range(REMOVAL_WINDOW);
        let Some(removal) = (wanted..HORIZON2).find(|t| on[0][*t]) else { continue };
        let run = revoke(&on, lease, removal, &[0; 5], false);
        let mut edits = StdRng::seed_from_u64(4_000 + trial as u64);
        out.trials += 1;
        held_writes(&on, &run, removal, &mut edits, &mut out);
    }
    out.hours_to_hear.sort_by(|a, b| a.partial_cmp(b).unwrap());
    out
}

// ────────────────────────────
// Study 7 (N5): a post that appears at a set time, read from each device's own clock
// ────────────────────────────

/// A post carries a not-before time chosen on the poster's clock, and each receiver shows it when its own clock reaches
/// that time. `offsets` are the clock errors in minutes of the poster (first) and three receivers. With `watch` each
/// device has moved to the median of the four clocks. Returns, in minutes, how early the earliest receiver shows the post
/// and how late the latest one does, against the moment the poster meant.
fn reveal_error(offsets: [i64; 4], watch: bool) -> (i64, i64) {
    let mut sorted = offsets;
    sorted.sort();
    let effective = if watch { [sorted[2]; 4] } else { offsets };
    let errors: Vec<i64> = (1..4).map(|r| effective[0] - effective[r]).collect();
    (-errors.iter().min().unwrap().min(&0), *errors.iter().max().unwrap().max(&0))
}

#[test]
fn a_post_shows_early_on_a_fast_clock_and_late_on_a_slow_one_and_the_watch_brings_them_together() {
    // Nothing wrong, nothing off
    assert_eq!(reveal_error([0; 4], false), (0, 0));
    // A receiver an hour fast shows it an hour early; an hour slow, an hour late
    assert_eq!(reveal_error([0, 60, 0, 0], false), (60, 0));
    assert_eq!(reveal_error([0, -60, 0, 0], false), (0, 60));
    // With the watch the odd one is moved to the middle
    assert_eq!(reveal_error([0, 60, 0, 0], true), (0, 0));
    // The poster's own error moves every receiver the same way: a poster a day slow means the post shows a day early
    assert_eq!(reveal_error([-24 * 60, 0, 0, 0], false), (24 * 60, 0));
    assert_eq!(reveal_error([-24 * 60, 0, 0, 0], true), (0, 0));
    // When most clocks are wrong together the watch moves everyone to the wrong middle: they agree with each other (so the
    // post shows at the same moment everywhere) but not with the real time
    assert_eq!(reveal_error([0, 60, 60, 0], true), (0, 0));
}

#[test]
fn the_mesh_reaches_at_least_as_often_as_the_star_and_strictly_more_when_the_host_is_often_away() {
    let [star, vouched, mesh] = study_delivery(4, 0.3, 40);
    // The link sets are nested by construction, so this holds in every trial, not only on average
    assert!(star.pair_available <= vouched.pair_available + 1e-12);
    assert!(vouched.pair_available <= mesh.pair_available + 1e-12);
    assert!(mesh.pair_available > star.pair_available + 0.05, "{} vs {}", mesh.pair_available, star.pair_available);
    assert!(mesh.within_a_day >= star.within_a_day);
}

#[test]
fn the_overhead_of_the_signed_list_grows_with_the_members_and_stays_small() {
    let (small, _) = list_cost(2);
    let (large, micros) = list_cost(64);
    assert!(large > small);
    // A message frame carries many times this, and checking it is far cheaper than one network round trip
    assert!(large < 16 * 1024, "{large} bytes");
    assert!(micros < 5_000.0, "{micros} µs");
}

#[test]
fn a_clock_that_is_off_changes_what_the_lease_does_and_the_watch_takes_the_change_back() {
    // Guest 2 a day behind never lets its list run out, so the removed member gets in where it should not
    let honest = study_clock(0.3, [0; 5], false, 30);
    let behind = study_clock(0.3, [0, 0, -24 * 60, 0, 0], false, 30);
    assert!(behind.wrong_admit_hours > honest.wrong_admit_hours);
    assert_eq!(honest.wrong_admit_hours, 0.0, "with true clocks nothing is admitted wrongly");
    assert_eq!(honest.wrong_refusal, 0.0);
    // Guest 2 a day ahead refuses even a list that is still good
    let ahead = study_clock(0.3, [0, 0, 24 * 60, 0, 0], false, 30);
    assert!(ahead.wrong_refusal > 0.0);
    // The watch has the three other online devices to read from, and moves it to the middle
    let watched = study_clock(0.3, [0, 0, -24 * 60, 0, 0], true, 30);
    assert!(watched.wrong_admit_hours < behind.wrong_admit_hours);
}

#[test]
fn an_acknowledgement_that_can_be_carried_is_never_later_than_one_that_cannot() {
    let carried = study_acks(4, 0.3, Mode::Mesh, 30);
    // The two columns come from the same run, so this holds in every trial
    for (c, d) in carried.all.iter().zip(&carried.all_direct) {
        assert!(c <= d);
    }
    for (c, d) in carried.half.iter().zip(&carried.half_direct) {
        assert!(c <= d);
    }
    // And half of the members are heard before all of them
    for (h, a) in carried.half.iter().zip(&carried.all) {
        assert!(h <= a);
    }
}

#[test]
fn an_acknowledgement_is_small_and_the_poster_holds_one_per_member() {
    let (one, at_64) = ack_cost(64);
    assert!(one < 400, "{one} bytes");
    assert_eq!(at_64, one * 63);
}

#[test]
fn edits_are_sorted_by_when_they_were_made_and_the_rules_split_them_without_overlap() {
    let h = study_held(0.3, DAY, 40);
    assert!(h.trials > 0);
    // Someone edits in 40 trials of a week
    assert!(h.waiting + h.unknowing + h.knowing > 0);
    // Edits made before the device heard are the ones a version rule would hold; the rest it refuses
    assert!(h.let_in_honest <= h.waiting + h.unknowing);
    assert!(h.let_in_knowing <= h.knowing);
}

#[test]
#[ignore = "prints the tables used in RESEARCH.md; slow without --release"]
fn hostless_sim_tables() {
    let trials = 200;
    println!("\n== Study 1: reaching each other, and time for an edit to reach everyone (guests online {:.0}% of the time)", GUEST_UPTIME * 100.0);
    println!("columns: share of time two guests can sync | median hours until every guest has an edit | share of edits that reached every guest within 24 h | median hours until the host has it too  (each: star / vouched / mesh)");
    for guests in [2usize, 4, 8] {
        for host in [0.1, 0.3, 0.5, 0.8, 0.95] {
            let [s, v, m] = study_delivery(guests, host, trials);
            let med = |d: &Delivery| percentile(&d.hours, 0.5);
            let day = |d: &Delivery| 100.0 * d.within_a_day as f64 / d.trials.max(1) as f64;
            let with_host = |d: &Delivery| percentile(&d.hours_with_host, 0.5);
            println!(
                "{guests:>2} guests, host up {:>3.0}% | {:>5.1}% {:>5.1}% {:>5.1}% | {:>6.1} {:>6.1} {:>6.1} | {:>4.0}% {:>4.0}% {:>4.0}% | {:>6.1} {:>6.1} {:>6.1}",
                host * 100.0,
                s.pair_available * 100.0, v.pair_available * 100.0, m.pair_available * 100.0,
                med(&s), med(&v), med(&m),
                day(&s), day(&v), day(&m),
                with_host(&s), with_host(&v), with_host(&m),
            );
        }
    }

    println!("\n== Study 2: a removed member and devices that have not heard (4 guests, one removed, owner online as shown)");
    println!("{:>7} {:>9} | {:>14} {:>14} | {:>16} | {:>14}", "host up", "lease", "removed got in", "hours linked", "median h to all heard", "guests can sync");
    for host in [0.1, 0.3, 0.5, 0.8] {
        for (name, lease) in [("none", usize::MAX), ("7 days", 7 * DAY), ("3 days", 3 * DAY), ("1 day", DAY)] {
            let r = study_revocation(host, lease, trials);
            println!(
                "{:>6.0}% {:>9} | {:>13.0}% {:>14.1} | {:>16.1} | {:>13.1}%",
                host * 100.0,
                name,
                100.0 * r.leaked as f64 / r.trials.max(1) as f64,
                r.leak_hours / r.trials.max(1) as f64,
                percentile(&r.informed_hours, 0.5),
                r.pair_available * 100.0,
            );
        }
    }

    println!("\n== Study 3: cost of linking every pair");
    println!("{:>8} {:>10} {:>16} {:>18} {:>18} {:>14}", "members", "links", "list bytes", "check list µs", "author sends/edit", "author sends/edit");
    println!("{:>8} {:>10} {:>16} {:>18} {:>18} {:>14}", "", "(mesh)", "(signed JSON)", "", "(star)", "(mesh)");
    for n in [2usize, 4, 8, 16, 32, 64] {
        let (bytes, micros) = list_cost(n);
        println!("{n:>8} {:>10} {bytes:>16} {micros:>18.0} {:>18} {:>14}", n * (n - 1) / 2, 1, n - 1);
    }

    println!("\n== Study 4 (N5): the lease with a wrong clock (4 guests, device 1 removed, owner up 30%, lease 1 day, {trials} trials)");
    println!("{:>34} | {:>8} | {:>13} {:>16} {:>16} | {:>14}", "whose clock is off", "watch", "removed got in", "hours linked", "of them wrongly", "wrong refusals");
    let cases: [(&str, [i64; 5]); 9] = [
        ("none", [0; 5]),
        ("a guest 5 min behind", [0, 0, -5, 0, 0]),
        ("a guest 1 hour behind", [0, 0, -60, 0, 0]),
        ("a guest 1 day behind (set back)", [0, 0, -24 * 60, 0, 0]),
        ("a guest 1 hour ahead", [0, 0, 60, 0, 0]),
        ("a guest 1 day ahead", [0, 0, 24 * 60, 0, 0]),
        ("the owner 1 hour behind", [-60, 0, 0, 0, 0]),
        ("the owner 1 hour ahead", [60, 0, 0, 0, 0]),
        ("every guest 1 day behind", [0, -24 * 60, -24 * 60, -24 * 60, -24 * 60]),
    ];
    for (name, offsets) in cases {
        for watch in [false, true] {
            let r = study_clock(0.3, offsets, watch, trials);
            let k = r.trials.max(1) as f64;
            println!(
                "{name:>34} | {:>8} | {:>12.0}% {:>16.1} {:>16.1} | {:>13.1}%",
                if watch { "on" } else { "off" },
                100.0 * r.leaked as f64 / k,
                r.leak_hours / k,
                r.wrong_admit_hours / k,
                100.0 * r.wrong_refusal / k,
            );
        }
    }

    println!("\n== Study 5 (N6): hours until the poster holds acknowledgements from half and from all the other members (guests online {:.0}%)", GUEST_UPTIME * 100.0);
    println!("columns per mode: median hours to half | to all | to all when only the signer can deliver its own  (star / mesh)");
    for members in [4usize, 8, 16] {
        for host in [0.1, 0.3, 0.8] {
            let s = study_acks(members - 1, host, Mode::Star, trials);
            let m = study_acks(members - 1, host, Mode::Mesh, trials);
            println!(
                "{members:>2} members, host up {:>3.0}% | star {:>6.1} {:>6.1} {:>6.1} | mesh {:>6.1} {:>6.1} {:>6.1}",
                host * 100.0,
                percentile(&s.half, 0.5), percentile(&s.all, 0.5), percentile(&s.all_direct, 0.5),
                percentile(&m.half, 0.5), percentile(&m.all, 0.5), percentile(&m.all_direct, 0.5),
            );
        }
    }
    println!("{:>8} {:>14} {:>22}", "members", "bytes per ack", "bytes the poster holds");
    for n in [4usize, 8, 16, 32, 64] {
        let (one, held) = ack_cost(n);
        println!("{n:>8} {one:>14} {held:>22}");
    }

    println!("\n== Study 6 (N1): edits by a removed member, per removal, counted for a week after it (about 3 edits an hour while its device is on; 4 guests; lease 1 day; {trials} trials)");
    println!("{:>7} {:>9} | {:>9} {:>10} {:>9} | {:>12} {:>12} | {:>10}", "host up", "lease", "waiting*", "unknowing", "knowing", "let in (hon.)", "let in (know.)", "median h to hear");
    for host in [0.1, 0.3, 0.5, 0.8] {
        for (name, lease) in [("none", usize::MAX), ("1 day", DAY)] {
            let h = study_held(host, lease, trials);
            let k = h.trials.max(1) as f64;
            println!(
                "{:>6.0}% {:>9} | {:>9.1} {:>10.1} {:>9.1} | {:>12.1} {:>12.1} | {:>10.1}",
                host * 100.0, name, h.waiting as f64 / k, h.unknowing as f64 / k, h.knowing as f64 / k,
                h.let_in_honest as f64 / k, h.let_in_knowing as f64 / k, percentile(&h.hours_to_hear, 0.5),
            );
        }
    }
    println!("* waiting: made before the removal and not shared with anyone by then");

    println!("
== Study 7 (N5): when a scheduled post shows, against the moment the poster meant (minutes; poster and three receivers)");
    println!("{:>34} | {:>10} {:>10} | {:>10} {:>10}", "whose clock is off", "early (off)", "late (off)", "early (on)", "late (on)");
    for (name, offsets) in [
        ("a receiver 5 min fast", [0, 5, 0, 0]),
        ("a receiver 1 hour fast", [0, 60, 0, 0]),
        ("a receiver 1 day fast", [0, 24 * 60, 0, 0]),
        ("a receiver 1 hour slow", [0, -60, 0, 0]),
        ("the poster 1 hour fast", [60, 0, 0, 0]),
        ("the poster 1 hour slow", [-60, 0, 0, 0]),
        ("two receivers 1 hour fast", [0, 60, 60, 0]),
    ] {
        let (e0, l0) = reveal_error(offsets, false);
        let (e1, l1) = reveal_error(offsets, true);
        println!("{name:>34} | {e0:>10} {l0:>10} | {e1:>10} {l1:>10}");
    }
}
