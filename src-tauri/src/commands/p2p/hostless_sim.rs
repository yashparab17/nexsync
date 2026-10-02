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

/// Device 1 is removed. `lease` is how long a device keeps linking to other members after it last heard (through any
/// chain of links) from the owner; `usize::MAX` is no lease at all. The lease is a proposal, not something built.
fn revoke(on: &[Vec<bool>], lease: usize, removal: usize) -> (bool, f64, Option<usize>, f64) {
    let n = on.len();
    let removed = 1usize;
    let mut net = Net::new(n);
    let mut heard = vec![false; n];
    heard[0] = true;
    // When each device last had word from the owner, which is how a lease runs out
    let mut word = vec![0usize; n];
    let (mut leaked, mut leak_steps, mut all_heard_at) = (false, 0usize, None);
    let (mut together, mut counted) = (0usize, 0usize);
    for t in 0..HORIZON2 {
        let now: Vec<bool> = (0..n).map(|d| on[d][t]).collect();
        net.advance(&now);
        let valid: Vec<bool> = (0..n).map(|d| d == 0 || t.saturating_sub(word[d]) <= lease).collect();
        let group = net.groups(Mode::Mesh, &now, &valid, Some(removed));
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
            if now[removed] && (2..n).any(|d| now[d] && !heard[d] && valid[d]) {
                leaked = true;
                leak_steps += 1;
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
    (leaked, leak_steps as f64 * STEP_MIN as f64 / 60.0, all_heard_at, together as f64 / counted.max(1) as f64)
}

fn study_revocation(host_uptime: f64, lease: usize, trials: usize) -> Revocation {
    let mut r = Revocation::default();
    for trial in 0..trials {
        let mut rng = StdRng::seed_from_u64(91_000 + trial as u64 * 211 + (host_uptime * 100.0) as u64);
        let on = world(&mut rng, 4, host_uptime, HORIZON2);
        let wanted = rng.gen_range(REMOVAL_WINDOW);
        let Some(removal) = (wanted..HORIZON2).find(|t| on[0][*t]) else { continue };
        let (leaked, hours, all_heard, available) = revoke(&on, lease, removal);
        r.trials += 1;
        r.leaked += usize::from(leaked);
        r.leak_hours += hours;
        r.pair_available += available;
        r.informed_hours.push(all_heard.map_or((HORIZON2 - removal) as f64, |s| s as f64) * STEP_MIN as f64 / 60.0);
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
}
