//! Roles checked by every device (RESEARCH.md §8j, N4). A prototype and its evaluation, not wired into the app.
//!
//! Today a device checks the role of the device on the other end of the link: a Viewer's link is refused and the host drops
//! a Viewer's changes. A write inside a state message is checked only for a valid signature (`merge_remote`), so a write
//! signed by a Viewer's key, or by a key that was never a member, is accepted when an Editor or the host passes it on.
//!
//! The prototype: every write also names the version of the signed member list it was made under, and the receiver looks
//! up the role of the signing key in that version. A write that names a version the receiver has not seen waits for the
//! list; a write that was valid at the version it names but no longer is under the newest list goes to a person (the
//! held-writes inbox of N1), since a writer can claim an old version and nothing can tell that apart from an old write.
//!
//! Run the matrix and the costs with `cargo test peer_check -- --nocapture`.

use std::collections::BTreeMap;

use iroh::SecretKey;
use rand::{rngs::StdRng, Rng, SeedableRng};

use super::membership::{issue, Membership};
use crate::commands::workspace::signing::{from_hex, to_hex};

/// A write as it would travel: what `signing::Write` covers, and the version of the member list it names
#[derive(Clone, Debug)]
struct VWrite {
    record: String,
    path: String,
    value: String,
    counter: u64,
    ts: u64,
    epoch: u64,
    by: String,
    sig: String,
}

impl VWrite {
    fn payload(&self) -> Vec<u8> {
        format!("nexsync write v2\n{}\n{}\n{}\n{}\n{}\n{}", self.record, self.path, self.counter, self.ts, self.epoch, self.value).into_bytes()
    }

    fn signed(key: &SecretKey, record: &str, path: &str, value: &str, counter: u64, ts: u64, epoch: u64) -> Self {
        let mut w = VWrite { record: record.into(), path: path.into(), value: value.into(), counter, ts, epoch, by: key.public().to_string(), sig: String::new() };
        w.sig = to_hex(&key.sign(&w.payload()).to_bytes());
        w
    }

    fn signature_ok(&self) -> bool {
        use std::str::FromStr;
        let Ok(public) = iroh::PublicKey::from_str(&self.by) else { return false };
        let Some(bytes) = from_hex(&self.sig).and_then(|b| <[u8; iroh::Signature::LENGTH]>::try_from(b).ok()) else { return false };
        public.verify(&self.payload(), &iroh::Signature::from_bytes(&bytes)).is_ok()
    }
}

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug)]
enum Role {
    Viewer,
    Editor,
    Admin,
    Owner,
}

fn role_in(list: &Membership, key: &str) -> Option<Role> {
    if list.owner == key {
        return Some(Role::Owner);
    }
    list.role_of(key).and_then(|r| match r {
        "Admin" => Some(Role::Admin),
        "Editor" => Some(Role::Editor),
        "Viewer" => Some(Role::Viewer),
        _ => None,
    })
}

#[derive(Debug, PartialEq, Eq, Clone)]
enum Verdict {
    Accept,
    /// Kept apart for a person (or for the list to arrive), not merged and not thrown away
    Hold(&'static str),
    Refuse(&'static str),
}

/// Every version of the signed member list this device has held, by number
#[derive(Default)]
struct History {
    lists: BTreeMap<u64, Membership>,
}

impl History {
    fn latest(&self) -> &Membership {
        self.lists.values().next_back().expect("a history holds at least one list")
    }

    /// The device `me` decides what to do with `w`, for an action that needs at least `need`
    fn check(&self, w: &VWrite, need: Role) -> Verdict {
        if !w.signature_ok() {
            return Verdict::Refuse("the signature is not the key's");
        }
        let latest = self.latest();
        if w.epoch > latest.epoch {
            return Verdict::Hold("names a list this device has not seen: fetch it");
        }
        let Some(named) = self.lists.get(&w.epoch) else { return Verdict::Hold("the list it names is not held") };
        match role_in(named, &w.by) {
            None => return Verdict::Refuse("not a member at the version it names"),
            Some(r) if r < need => return Verdict::Refuse("the role at that version is too low"),
            _ => {}
        }
        match role_in(latest, &w.by) {
            Some(r) if r >= need => Verdict::Accept,
            None => Verdict::Hold("valid when made, but the writer has since been removed"),
            Some(_) => Verdict::Hold("valid when made, but the writer's role has since been lowered"),
        }
    }
}

/// What a device does today with a write inside a state message that arrived on a link of role `link`: the signature must
/// verify and a Viewer's link is refused (`node.rs` change gate; `crdt::merge_remote`). The key's role is not looked at.
fn today(link: &str, w: &VWrite) -> Verdict {
    if link == "Viewer" {
        return Verdict::Refuse("the link is a Viewer's");
    }
    if w.signature_ok() { Verdict::Accept } else { Verdict::Refuse("the signature is not the key's") }
}

fn key(seed: u8) -> SecretKey {
    SecretKey::from_bytes(&[seed; 32])
}

fn id(seed: u8) -> String {
    key(seed).public().to_string()
}

const OWNER: u8 = 1;
const ADMIN: u8 = 2;
const EDITOR: u8 = 3;
const VIEWER: u8 = 4;
const LEAVER: u8 = 5;
const DEMOTED: u8 = 6;
const STRANGER: u8 = 9;

fn roster(entries: &[(u8, &str)]) -> Vec<(String, String)> {
    entries.iter().map(|(s, r)| (id(*s), r.to_string())).collect()
}

/// Epoch 1: everyone in. Epoch 2: the demoted device becomes a Viewer. Epoch 3: the leaver is removed.
fn history() -> History {
    let owner = key(OWNER);
    let all = [(ADMIN, "Admin"), (EDITOR, "Editor"), (VIEWER, "Viewer"), (LEAVER, "Editor"), (DEMOTED, "Editor")];
    let mut h = History::default();
    let mut put = |epoch: u64, members: Vec<(String, String)>, removed: Vec<String>| {
        h.lists.insert(epoch, issue(&owner, "ws", "w", epoch, &id(OWNER), members, removed));
    };
    put(1, roster(&all), vec![]);
    let after_demotion = [(ADMIN, "Admin"), (EDITOR, "Editor"), (VIEWER, "Viewer"), (LEAVER, "Editor"), (DEMOTED, "Viewer")];
    put(2, roster(&after_demotion), vec![]);
    let after_removal = [(ADMIN, "Admin"), (EDITOR, "Editor"), (VIEWER, "Viewer"), (DEMOTED, "Viewer")];
    put(3, roster(&after_removal), vec![id(LEAVER)]);
    h
}

struct Case {
    name: &'static str,
    /// The role of the link the write arrived on, today
    link: &'static str,
    write: VWrite,
    need: Role,
    /// What the prototype must do
    expect: Verdict,
    /// What happens today, for the table (checked against `today`)
    today: Verdict,
}

fn cases() -> Vec<Case> {
    let w = |who: u8, epoch: u64| VWrite::signed(&key(who), "t1", "title", "x", 1, 1_000, epoch);
    let mut forged = w(EDITOR, 3);
    forged.by = id(ADMIN);
    vec![
        Case { name: "A Viewer's write, sent on the Viewer's own link", link: "Viewer", write: w(VIEWER, 3), need: Role::Editor, expect: Verdict::Refuse("the role at that version is too low"), today: Verdict::Refuse("the link is a Viewer's") },
        Case { name: "A Viewer's signed write, carried in by an Editor's link", link: "Editor", write: w(VIEWER, 3), need: Role::Editor, expect: Verdict::Refuse("the role at that version is too low"), today: Verdict::Accept },
        Case { name: "A key that was never a member, carried in by an Editor", link: "Editor", write: w(STRANGER, 3), need: Role::Editor, expect: Verdict::Refuse("not a member at the version it names"), today: Verdict::Accept },
        Case { name: "An Editor's write for something only an Admin may do", link: "Editor", write: w(EDITOR, 3), need: Role::Admin, expect: Verdict::Refuse("the role at that version is too low"), today: Verdict::Accept },
        Case { name: "A write whose signature is another key's (claims to be the Admin)", link: "Editor", write: forged, need: Role::Editor, expect: Verdict::Refuse("the signature is not the key's"), today: Verdict::Refuse("the signature is not the key's") },
        Case { name: "A write the demoted device made while it was an Editor (names version 1)", link: "Editor", write: w(DEMOTED, 1), need: Role::Editor, expect: Verdict::Hold("valid when made, but the writer's role has since been lowered"), today: Verdict::Accept },
        Case { name: "A write the demoted device makes now but claims is from version 1", link: "Editor", write: w(DEMOTED, 1), need: Role::Editor, expect: Verdict::Hold("valid when made, but the writer's role has since been lowered"), today: Verdict::Accept },
        Case { name: "The demoted device's write naming the version that demoted it", link: "Editor", write: w(DEMOTED, 2), need: Role::Editor, expect: Verdict::Refuse("the role at that version is too low"), today: Verdict::Accept },
        Case { name: "A write naming a version this device has not seen", link: "Editor", write: w(EDITOR, 4), need: Role::Editor, expect: Verdict::Hold("names a list this device has not seen: fetch it"), today: Verdict::Accept },
        Case { name: "The removed member's write naming an old version (1)", link: "Editor", write: w(LEAVER, 1), need: Role::Editor, expect: Verdict::Hold("valid when made, but the writer has since been removed"), today: Verdict::Accept },
        Case { name: "The removed member's write naming the version that removed it (3)", link: "Editor", write: w(LEAVER, 3), need: Role::Editor, expect: Verdict::Refuse("not a member at the version it names"), today: Verdict::Accept },
        Case { name: "An ordinary Editor's write", link: "Editor", write: w(EDITOR, 3), need: Role::Editor, expect: Verdict::Accept, today: Verdict::Accept },
        Case { name: "The Owner's write", link: "Editor", write: w(OWNER, 3), need: Role::Editor, expect: Verdict::Accept, today: Verdict::Accept },
    ]
}

#[test]
fn the_attack_matrix_today_and_with_every_device_checking() {
    let h = history();
    println!("\n| Case | Today | Checked by every device |\n|---|---|---|");
    let (mut today_wrong, mut new_wrong) = (0, 0);
    for c in cases() {
        let now = today(c.link, &c.write);
        let new = h.check(&c.write, c.need);
        assert_eq!(now, c.today, "{}: today", c.name);
        assert_eq!(new, c.expect, "{}", c.name);
        // Wrong means: a write that should not be merged was (accepted), or one that should be was not (refused)
        let should_merge = matches!(c.expect, Verdict::Accept);
        let should_be_kept_out = matches!(c.expect, Verdict::Refuse(_) | Verdict::Hold(_));
        today_wrong += usize::from(should_be_kept_out && now == Verdict::Accept);
        new_wrong += usize::from((should_merge && new != Verdict::Accept) || (should_be_kept_out && new == Verdict::Accept));
        let text = |v: &Verdict| match v {
            Verdict::Accept => "accepted".to_string(),
            Verdict::Hold(why) => format!("held: {why}"),
            Verdict::Refuse(why) => format!("refused: {why}"),
        };
        println!("| {} | {} | {} |", c.name, text(&now), text(&new));
    }
    println!("\nwrongly merged today: {today_wrong} of {}; with the check: {new_wrong}", cases().len());
    assert_eq!(new_wrong, 0);
    assert!(today_wrong >= 6);
}

/// A random history of lists (members come, go and change role), and random writes by random keys naming random
/// versions. Two things must hold whatever happens.
#[test]
fn random_histories_never_merge_what_the_latest_list_forbids_and_never_refuse_an_honest_write() {
    let owner = key(OWNER);
    let mut rng = StdRng::seed_from_u64(44);
    let (mut accepted, mut held, mut refused, mut honest) = (0usize, 0usize, 0usize, 0usize);
    for _ in 0..300 {
        // Members 10..20, roles drawn anew at each epoch, some removed for good
        let mut h = History::default();
        let mut removed: Vec<u8> = Vec::new();
        let mut roles: BTreeMap<u8, &str> = BTreeMap::new();
        for epoch in 1..=rng.gen_range(2..12u64) {
            for m in 10..20u8 {
                if removed.contains(&m) {
                    continue;
                }
                match rng.gen_range(0..10) {
                    0 => {
                        roles.remove(&m);
                        removed.push(m);
                    }
                    1..=3 => {
                        roles.insert(m, ["Admin", "Editor", "Viewer"][rng.gen_range(0..3)]);
                    }
                    _ => {
                        roles.entry(m).or_insert("Editor");
                    }
                }
            }
            let members = roles.iter().map(|(s, r)| (id(*s), r.to_string())).collect();
            h.lists.insert(epoch, issue(&owner, "ws", "w", epoch, &id(OWNER), members, removed.iter().map(|s| id(*s)).collect()));
        }
        let latest = h.latest().epoch;
        for n in 0..40u64 {
            let who = rng.gen_range(8..22u8);
            let epoch = rng.gen_range(1..=latest + 1);
            let w = VWrite::signed(&key(who), "r", "p", "v", n, n, epoch);
            let need = if rng.gen_bool(0.3) { Role::Admin } else { Role::Editor };
            let v = h.check(&w, need);
            // An honest write was made under the version it names by a key that had the role then
            let honest_write = h.lists.get(&epoch).and_then(|l| role_in(l, &w.by)).is_some_and(|r| r >= need);
            honest += usize::from(honest_write);
            match &v {
                Verdict::Accept => {
                    accepted += 1;
                    // Accepted means the role is enough in the version it names and in the newest one
                    assert!(role_in(h.latest(), &w.by).is_some_and(|r| r >= need));
                    assert!(h.lists.get(&epoch).and_then(|l| role_in(l, &w.by)).is_some_and(|r| r >= need));
                }
                Verdict::Hold(_) => held += 1,
                Verdict::Refuse(_) => refused += 1,
            }
            if honest_write || epoch > latest {
                assert!(!matches!(v, Verdict::Refuse(_)), "an honest or not yet checkable write was refused: {v:?}");
            }
        }
    }
    println!("\n{accepted} accepted, {held} held, {refused} refused; {honest} were made by a key with the role at the version they name");
}

/// What the check costs, for the notes in RESEARCH.md
#[test]
fn what_checking_a_writes_role_costs() {
    let signer = key(EDITOR);
    let base = VWrite::signed(&signer, "t1", "title", "A title of the usual length for a task", 3, 1_700_000_000_000, 3);
    let n = 5_000;
    // Time: signature check alone against signature check plus the role lookup in a history of 50 lists of 64 members
    let owner = key(OWNER);
    let mut h = History::default();
    for epoch in 1..=50u64 {
        let members: Vec<(String, String)> = (10..74u8).map(|s| (id(s), "Editor".to_string())).chain([(id(EDITOR), "Editor".to_string())]).collect();
        h.lists.insert(epoch, issue(&owner, "ws", "w", epoch, &id(OWNER), members, vec![]));
    }
    let mut w = base.clone();
    w.epoch = 50;
    w.sig = to_hex(&signer.sign(&w.payload()).to_bytes());
    let start = std::time::Instant::now();
    for _ in 0..n {
        assert!(std::hint::black_box(&w).signature_ok());
    }
    let verify_us = start.elapsed().as_micros() as f64 / n as f64;
    let start = std::time::Instant::now();
    for _ in 0..n {
        assert_eq!(h.check(std::hint::black_box(&w), Role::Editor), Verdict::Accept);
    }
    let check_us = start.elapsed().as_micros() as f64 / n as f64;
    let start = std::time::Instant::now();
    for _ in 0..n {
        std::hint::black_box(VWrite::signed(&signer, "t1", "title", "x", 3, 1, 50));
    }
    let sign_us = start.elapsed().as_micros() as f64 / n as f64;
    // Bytes: the version number in each write, and what keeping every version of the list costs
    let with = format!("\"epoch\":{}", w.epoch).len() + 1;
    let list_bytes = |members: usize, epochs: u64| -> usize {
        (1..=epochs)
            .map(|e| {
                let roster: Vec<(String, String)> = (10..10 + members as u8).map(|s| (id(s), "Editor".to_string())).collect();
                serde_json::to_vec(&issue(&owner, "ws", "w", e, &id(OWNER), roster, vec![])).unwrap().len()
            })
            .sum()
    };
    println!("\nsign {sign_us:.0} µs, signature check alone {verify_us:.0} µs, check with the role lookup {check_us:.0} µs (50 lists of 65 members)");
    println!("the version number adds {with} bytes to a write; all versions of a list kept: 8 members x 100 versions = {} B, 64 members x 100 versions = {} B", list_bytes(8, 100), list_bytes(64, 100));
    // The lookup is a map and a scan of the roster; the signature dominates
    assert!(check_us < verify_us * 3.0 + 200.0, "{check_us} vs {verify_us}");
}

/// Backs the "today" column with the real merge instead of a reading of it: a task whose title was written and signed by
/// a Viewer's key is merged by `merge_remote`, which is what runs when any peer sends a state message
#[test]
fn today_the_real_merge_takes_a_write_signed_by_a_viewers_key_and_by_a_stranger() {
    use crate::commands::workspace::crdt::{self, RecordState};
    use crate::commands::workspace::models::Task;
    use crate::commands::workspace::signing::{self, Write};
    use serde_json::json;

    for (signer, label) in [(VIEWER, "a Viewer"), (STRANGER, "a key that was never a member")] {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        crate::database::schema::init_schema(&conn).unwrap();
        conn.execute("INSERT INTO workspace (id, name, description, path, created_at, updated_at) VALUES ('w', 'w', '', '/w', 't', 't')", []).unwrap();
        let local = Task { id: "t1".into(), title: "original".into(), status: "todo".into(), priority: "medium".into(), created_at: "2026-01-01T00:00:00Z".into(), updated_at: "2026-01-01T00:00:00Z".into(), ..Default::default() };
        crdt::ensure(&conn, &local).unwrap();
        // The outsider's copy of the record, with one new write signed by `signer`
        let mut state: RecordState = crdt::load(&conn, "task", "t1").unwrap().unwrap();
        let value = json!("written by the wrong role");
        state.write("their-replica", "title", value.clone(), crdt::now_ms() + 1, Some("Mallory"));
        let sibling = state.fields.get_mut("title").unwrap().iter_mut().find(|s| s.dot.r == "their-replica").unwrap();
        let (by, sig) = signing::sign_with(&key(signer), &Write { entity: "task", record: "t1", path: "title", replica: "their-replica", counter: sibling.dot.c, ts: sibling.ts, who: Some("Mallory"), value: &value });
        sibling.by = Some(by);
        sibling.sig = Some(sig);
        let remote = Task { title: "written by the wrong role".into(), crdt: Some(state), ..local.clone() };
        let merged = crdt::merge_remote(&conn, &remote, Some(&local), |_| true).unwrap();
        assert_eq!(merged.map(|t| t.title), Some("written by the wrong role".to_string()), "{label}: the real merge was expected to take it, as the table says");
    }
}
