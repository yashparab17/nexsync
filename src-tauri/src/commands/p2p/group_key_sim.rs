//! End-to-end group keys with no server (RESEARCH.md §8o, N29). A prototype and a cost measurement, not wired into the app.
//!
//! Today every connection is encrypted (QUIC, TLS 1.3) and nothing else is: a device that holds the workspace holds every
//! note in the clear, and "encryption at rest" is open (Phase 12). If workspace content were encrypted for the group, a
//! removed member would have to be locked out of what is written afterwards, and that needs a new group key every time
//! the member list changes. This file builds the smallest real version of a key tree (the family TreeKEM and BeeKEM
//! belong to) and measures what it costs against sending a new key to everyone:
//!
//! - members are the leaves of a binary tree; each node holds a public key; a member knows the secret of every node on
//!   its path to the root;
//! - a *commit* by one member makes a fresh leaf secret, derives new secrets up its path, and encrypts each node's secret
//!   to the nodes that cover the other side, so the commit has about log2(n) ciphertexts, not n;
//! - removing a member blanks its path; the commit then skips those nodes, so the removed member cannot read it;
//! - the epoch key (what content would be encrypted with) is derived from the root secret.
//!
//! Real primitives: X25519 (`curve25519-dalek`), AES-256-GCM (`aes-gcm`), BLAKE3 key derivation (`blake3`); all three
//! are already dependencies. Not built: authentication of leaf keys (assumed to come from the owner's signed member
//! list, which already carries device keys), signatures on commits (counted as 64 bytes, not computed), concurrent
//! commits (counted, see `concurrent_cost`), growing the tree, and any security proof.
//!
//! Run the table with `cargo test --lib group_key_sim_table -- --ignored --nocapture`.

use std::collections::{BTreeMap, HashMap};
use std::time::Instant;

use aes_gcm::{aead::Aead, Aes256Gcm, KeyInit, Nonce};
use curve25519_dalek::montgomery::MontgomeryPoint;
use rand::{rngs::StdRng, Rng, RngCore, SeedableRng};

type Key = [u8; 32];

fn kdf(context: &str, parts: &[&[u8]]) -> Key {
    let mut h = blake3::Hasher::new_derive_key(context);
    for p in parts {
        h.update(p);
    }
    *h.finalize().as_bytes()
}

fn public_of(secret: &Key) -> Key {
    MontgomeryPoint::mul_base_clamped(*secret).0
}

fn dh(secret: &Key, public: &Key) -> Key {
    MontgomeryPoint(*public).mul_clamped(*secret).0
}

fn random_key(rng: &mut StdRng) -> Key {
    let mut k = [0u8; 32];
    rng.fill_bytes(&mut k);
    k
}

/// A secret encrypted to a public key: the sender's one-time public key and the ciphertext with its tag (80 bytes)
#[derive(Clone)]
struct Wrap {
    eph: Key,
    ct: Vec<u8>,
}

const WRAP_BYTES: usize = 32 + 32 + 16;

fn wrap(rng: &mut StdRng, to: &Key, secret: &Key) -> Wrap {
    let e = random_key(rng);
    let eph = public_of(&e);
    let k = kdf("nexsync tree wrap v1", &[&dh(&e, to), &eph, to]);
    // The key is used once, so a zero nonce is safe
    let ct = Aes256Gcm::new_from_slice(&k).unwrap().encrypt(Nonce::from_slice(&[0u8; 12]), secret.as_ref()).unwrap();
    Wrap { eph, ct }
}

fn unwrap(secret: &Key, w: &Wrap) -> Option<Key> {
    let k = kdf("nexsync tree wrap v1", &[&dh(secret, &w.eph), &w.eph, &public_of(secret)]);
    let pt = Aes256Gcm::new_from_slice(&k).unwrap().decrypt(Nonce::from_slice(&[0u8; 12]), w.ct.as_ref()).ok()?;
    pt.try_into().ok()
}

/// What a node's secret is made from its path secret
fn node_secret(path_secret: &Key) -> Key {
    kdf("nexsync tree node v1", &[path_secret])
}

fn next_path_secret(path_secret: &Key) -> Key {
    kdf("nexsync tree path v1", &[path_secret])
}

fn epoch_key(root_path_secret: &Key, epoch: u64) -> Key {
    kdf("nexsync tree epoch v1", &[root_path_secret, &epoch.to_le_bytes()])
}

/// A complete binary tree in heap order: node 1 is the root, the leaves are `size..2 * size`
#[derive(Clone)]
struct Tree {
    size: usize,
    pk: Vec<Option<Key>>,
}

impl Tree {
    fn new(size: usize) -> Tree {
        Tree { size, pk: vec![None; 2 * size] }
    }

    fn leaf(&self, i: usize) -> usize {
        self.size + i
    }

    /// The nodes whose keys cover the leaves under `node`: the node itself, or what covers its children if it is blank
    fn resolution(&self, node: usize) -> Vec<usize> {
        if self.pk[node].is_some() {
            vec![node]
        } else if node >= self.size {
            vec![]
        } else {
            let mut v = self.resolution(2 * node);
            v.extend(self.resolution(2 * node + 1));
            v
        }
    }

    /// Ancestors of a leaf node from its parent up to the root
    fn ancestors(leaf: usize) -> Vec<usize> {
        let mut v = Vec::new();
        let mut n = leaf / 2;
        while n >= 1 {
            v.push(n);
            n /= 2;
        }
        v
    }

    fn blank_path(&mut self, leaf: usize) {
        self.pk[leaf] = None;
        for a in Tree::ancestors(leaf) {
            self.pk[a] = None;
        }
    }
}

/// One member's view: the path secrets of the nodes it can read, and the epoch key it has reached
#[derive(Clone, Default)]
struct Member {
    secrets: HashMap<usize, Key>,
    epoch: u64,
    epoch_key: Key,
}

/// A change to the group: new public keys on the committer's path, and the secrets wrapped to the nodes that cover the rest
#[derive(Clone)]
struct Commit {
    epoch: u64,
    new_pks: Vec<(usize, Key)>,
    /// (the node whose path secret this is, the node whose key it is wrapped to, the wrap)
    wraps: Vec<(usize, usize, Wrap)>,
}

impl Commit {
    /// Bytes on the wire: keys with a node number, wraps with two node numbers, a header and a 64-byte signature
    fn bytes(&self) -> usize {
        self.new_pks.len() * (32 + 2) + self.wraps.len() * (WRAP_BYTES + 4) + 16 + 64
    }
}

/// Makes `committer`'s commit: a fresh leaf secret and path, wrapped to the resolution of every sibling on the path
fn commit(tree: &mut Tree, committer: usize, epoch: u64, rng: &mut StdRng) -> (Commit, Member) {
    let leaf = tree.leaf(committer);
    let mut me = Member { epoch, ..Default::default() };
    let mut ps = random_key(rng);
    let mut new_pks = vec![(leaf, public_of(&node_secret(&ps)))];
    me.secrets.insert(leaf, ps);
    let mut wraps = Vec::new();
    let mut child = leaf;
    let mut chain = Vec::new();
    for parent in Tree::ancestors(leaf) {
        ps = next_path_secret(&ps);
        chain.push((parent, child, ps));
        me.secrets.insert(parent, ps);
        new_pks.push((parent, public_of(&node_secret(&ps))));
        child = parent;
    }
    // Publish the new keys first, so a sibling that is blank because of a removal is the only thing skipped
    for (node, key) in &new_pks {
        tree.pk[*node] = Some(*key);
    }
    for (parent, child, ps) in chain {
        for target in tree.resolution(child ^ 1) {
            wraps.push((parent, target, wrap(rng, &tree.pk[target].unwrap(), &ps)));
        }
    }
    let root_ps = me.secrets[&1];
    me.epoch_key = epoch_key(&root_ps, epoch);
    (Commit { epoch, new_pks, wraps }, me)
}

/// A member reads a commit: finds a wrap addressed to a node it holds the secret of, and derives the path above it
fn receive(tree: &Tree, m: &mut Member, c: &Commit) -> Option<Key> {
    for (from, to, w) in &c.wraps {
        let Some(sk) = m.secrets.get(to) else { continue };
        // The secret must still be the one behind the key the tree shows for that node
        if tree.pk[*to] != Some(public_of(&node_secret(sk))) {
            continue;
        }
        let Some(mut ps) = unwrap(&node_secret(sk), w) else { continue };
        let mut node = *from;
        m.secrets.insert(node, ps);
        while node > 1 {
            ps = next_path_secret(&ps);
            node /= 2;
            m.secrets.insert(node, ps);
        }
        m.epoch = c.epoch;
        m.epoch_key = epoch_key(&ps, c.epoch);
        return Some(m.epoch_key);
    }
    None
}

struct Group {
    tree: Tree,
    members: BTreeMap<usize, Member>,
    /// Each member's own leaf secret (a device key in the app)
    leaf_secrets: BTreeMap<usize, Key>,
    epoch: u64,
    key: Key,
    removed: Vec<Member>,
}

impl Group {
    /// n members that already share the tree, as if built by an earlier sequence of adds (their secrets are handed out
    /// directly; only what happens afterwards is measured)
    fn build(n: usize, capacity: usize, rng: &mut StdRng) -> Group {
        let size = capacity.next_power_of_two();
        let mut tree = Tree::new(size);
        let mut node_ps: HashMap<usize, Key> = HashMap::new();
        let mut leaf_secrets = BTreeMap::new();
        for i in 0..n {
            let ls = random_key(rng);
            node_ps.insert(size + i, ls);
            tree.pk[size + i] = Some(public_of(&node_secret(&ls)));
            leaf_secrets.insert(i, ls);
        }
        for node in (1..size).rev() {
            if tree.resolution(2 * node).is_empty() && tree.resolution(2 * node + 1).is_empty() {
                continue;
            }
            let ps = random_key(rng);
            node_ps.insert(node, ps);
            tree.pk[node] = Some(public_of(&node_secret(&ps)));
        }
        let key = epoch_key(&node_ps[&1], 0);
        let members = (0..n)
            .map(|i| {
                let mut m = Member { epoch: 0, epoch_key: key, ..Default::default() };
                for n in std::iter::once(size + i).chain(Tree::ancestors(size + i)) {
                    if let Some(ps) = node_ps.get(&n) {
                        m.secrets.insert(n, *ps);
                    }
                }
                (i, m)
            })
            .collect();
        Group { tree, members, leaf_secrets, epoch: 0, key, removed: Vec::new() }
    }

    /// A member commits; every member reading the commit must reach the committer's epoch key
    fn commit_by(&mut self, who: usize, rng: &mut StdRng) -> Commit {
        self.epoch += 1;
        let (c, me) = commit(&mut self.tree, who, self.epoch, rng);
        self.key = me.epoch_key;
        self.members.insert(who, me);
        c
    }

    fn remove(&mut self, victim: usize) {
        let m = self.members.remove(&victim).unwrap();
        self.removed.push(m);
        self.leaf_secrets.remove(&victim);
        let leaf = self.tree.leaf(victim);
        self.tree.blank_path(leaf);
    }

    /// Adds a member at a free leaf: the ancestors of its leaf that the committer's path will not refresh are blanked, so
    /// the commit is wrapped straight to the new leaf
    fn add(&mut self, slot: usize, committer: usize, rng: &mut StdRng) -> Commit {
        let ls = random_key(rng);
        let leaf = self.tree.leaf(slot);
        let mine: Vec<usize> = Tree::ancestors(self.tree.leaf(committer));
        for a in Tree::ancestors(leaf) {
            if !mine.contains(&a) {
                self.tree.pk[a] = None;
            }
        }
        self.tree.pk[leaf] = Some(public_of(&node_secret(&ls)));
        self.leaf_secrets.insert(slot, ls);
        let mut m = Member::default();
        m.secrets.insert(leaf, ls);
        self.members.insert(slot, m);
        self.commit_by(committer, rng)
    }

    fn free_slot(&self) -> Option<usize> {
        (0..self.tree.size).find(|i| !self.members.contains_key(i) && self.tree.pk[self.tree.size + i].is_none())
    }
}

#[test]
fn every_member_reaches_the_committers_key_a_removed_member_never_does_and_a_sleeper_catches_up_in_order() {
    for seed in 0..40u64 {
        let mut rng = StdRng::seed_from_u64(seed);
        let n = rng.gen_range(3..14);
        let mut g = Group::build(n, 32, &mut rng);
        // One member sleeps through every commit and reads them all later, in order
        let sleeper = *g.members.keys().next().unwrap();
        let mut sleeper_state = g.members[&sleeper].clone();
        let mut log: Vec<(Tree, Commit, Key)> = Vec::new();
        for _ in 0..25 {
            let live: Vec<usize> = g.members.keys().copied().filter(|m| *m != sleeper).collect();
            if live.len() < 2 {
                break;
            }
            let who = live[rng.gen_range(0..live.len())];
            let c = match rng.gen_range(0..3) {
                0 => g.commit_by(who, &mut rng),
                1 if g.members.len() > 3 => {
                    let victim = live.iter().copied().find(|m| *m != who).unwrap();
                    g.remove(victim);
                    g.commit_by(who, &mut rng)
                }
                _ => match g.free_slot() {
                    Some(slot) => g.add(slot, who, &mut rng),
                    None => g.commit_by(who, &mut rng),
                },
            };
            let after = g.tree.clone();
            for (id, m) in g.members.iter_mut() {
                if *id == who || *id == sleeper {
                    continue;
                }
                assert_eq!(receive(&after, m, &c), Some(g.key), "seed {seed}: member {id} did not reach the epoch key");
            }
            for old in g.removed.iter() {
                assert_eq!(receive(&after, &mut old.clone(), &c), None, "seed {seed}: a removed member read a later commit");
            }
            log.push((after, c, g.key));
        }
        for (i, (tree, c, key)) in log.iter().enumerate() {
            assert_eq!(receive(tree, &mut sleeper_state, c), Some(*key), "seed {seed}: the sleeper lost the thread at commit {i}");
        }
    }
}

#[test]
fn a_removed_member_cannot_read_even_the_commit_that_removes_it() {
    let mut rng = StdRng::seed_from_u64(7);
    let mut g = Group::build(8, 8, &mut rng);
    g.remove(3);
    let c = g.commit_by(0, &mut rng);
    let after = g.tree.clone();
    assert_eq!(receive(&after, &mut g.removed[0].clone(), &c), None);
    for id in [1, 2, 4, 5, 6, 7] {
        assert_eq!(receive(&after, g.members.get_mut(&id).unwrap(), &c), Some(g.key));
    }
}

/// Sends a fresh key to every remaining member separately: what a server-less design without a tree has to do
fn pairwise_cost(n: usize, rng: &mut StdRng) -> (usize, f64) {
    let keys: Vec<Key> = (0..n).map(|_| public_of(&random_key(rng))).collect();
    let secret = random_key(rng);
    let t = Instant::now();
    let wraps: Vec<Wrap> = keys.iter().map(|k| wrap(rng, k, &secret)).collect();
    (wraps.len() * (WRAP_BYTES + 4) + 16 + 64, t.elapsed().as_secs_f64() * 1e6)
}

struct Stats {
    wraps: f64,
    bytes: f64,
    micros: f64,
}

/// Mean cost of a commit after `removed_pct` of the members have been removed, one commit per removal (the removal commit)
fn commit_cost(n: usize, removed_pct: usize, trials: usize) -> Stats {
    let mut rng = StdRng::seed_from_u64(1000 + n as u64 + removed_pct as u64);
    let (mut w, mut b, mut us) = (0.0, 0.0, 0.0);
    for _ in 0..trials {
        let mut g = Group::build(n, n, &mut rng);
        let to_remove = n * removed_pct / 100;
        for _ in 0..to_remove {
            let ids: Vec<usize> = g.members.keys().copied().collect();
            let victim = ids[rng.gen_range(0..ids.len())];
            g.remove(victim);
            let ids: Vec<usize> = g.members.keys().copied().collect();
            let who = ids[rng.gen_range(0..ids.len())];
            g.commit_by(who, &mut rng);
        }
        // The measured commit: one more removal, as the owner does
        let ids: Vec<usize> = g.members.keys().copied().collect();
        let victim = ids[rng.gen_range(0..ids.len())];
        g.remove(victim);
        let ids: Vec<usize> = g.members.keys().copied().collect();
        let who = ids[rng.gen_range(0..ids.len())];
        let t = Instant::now();
        let c = g.commit_by(who, &mut rng);
        us += t.elapsed().as_secs_f64() * 1e6;
        w += c.wraps.len() as f64;
        b += c.bytes() as f64;
    }
    let t = trials as f64;
    Stats { wraps: w / t, bytes: b / t, micros: us / t }
}

/// Wraps a commit needs when `c` members commit at the same time and every node on their paths keeps one key per
/// committer (the conflict-key idea): the next commit wraps to all of them. A count, not an implementation.
fn concurrent_cost(n: usize, c: usize, trials: usize) -> f64 {
    let mut rng = StdRng::seed_from_u64(55 + n as u64 * 3 + c as u64);
    let size = n.next_power_of_two();
    let mut total = 0usize;
    for _ in 0..trials {
        let mut paths = vec![0usize; 2 * size];
        for _ in 0..c {
            let leaf = size + rng.gen_range(0..n);
            for node in std::iter::once(leaf).chain(Tree::ancestors(leaf)) {
                paths[node] += 1;
            }
        }
        let keys: Vec<usize> = paths.iter().map(|p| (*p).max(1)).collect();
        let who = size + rng.gen_range(0..n);
        let mut child = who;
        for _ in Tree::ancestors(who) {
            total += keys[child ^ 1];
            child /= 2;
        }
    }
    total as f64 / trials as f64
}

/// Time and size to encrypt one update of the shared document under an epoch key
fn content_cost(size: usize) -> (usize, f64) {
    let key = [7u8; 32];
    let cipher = Aes256Gcm::new_from_slice(&key).unwrap();
    let data = vec![1u8; size];
    let reps = 2000;
    let t = Instant::now();
    let mut out = 0;
    for i in 0..reps {
        let mut nonce = [0u8; 12];
        nonce[..8].copy_from_slice(&(i as u64).to_le_bytes());
        out = cipher.encrypt(Nonce::from_slice(&nonce), data.as_ref()).unwrap().len() + 12;
    }
    (out - size, t.elapsed().as_secs_f64() * 1e6 / reps as f64)
}

#[test]
#[ignore = "prints the table used in RESEARCH.md"]
fn group_key_sim_table() {
    let mut rng = StdRng::seed_from_u64(3);
    println!("\nCost of locking a removed member out (one removal commit), by group size; 30 trials each; dependencies optimised, this crate not");
    println!("| members | key tree: wraps | key tree: bytes | key tree: build time (µs) | key to everyone: wraps | key to everyone: bytes | key to everyone: time (µs) |");
    println!("|---|---|---|---|---|---|---|");
    for n in [4, 16, 64, 256, 1024] {
        let s = commit_cost(n, 0, 30);
        let (pb, pt) = pairwise_cost(n - 1, &mut rng);
        println!("| {n} | {:.1} | {:.0} | {:.0} | {} | {pb} | {pt:.0} |", s.wraps, s.bytes, s.micros, n - 1);
    }
    println!("\nThe same commit after earlier removals leave blank nodes (256 members)");
    println!("| members already removed | wraps | bytes | µs |");
    println!("|---|---|---|---|");
    for pct in [0, 10, 25, 50, 75] {
        let s = commit_cost(256, pct, 10);
        println!("| {pct}% | {:.1} | {:.0} | {:.0} |", s.wraps, s.bytes, s.micros);
    }
    println!("\nWraps in the next commit when c members committed at once and every node keeps one key per committer (256 members, modelled)");
    println!("| concurrent commits | wraps |");
    println!("|---|---|");
    for c in [1, 2, 4, 8, 16, 64] {
        println!("| {c} | {:.1} |", concurrent_cost(256, c, 400));
    }
    println!("\nEncrypting one update of the shared document under the epoch key (AES-256-GCM, random nonce sent with it)");
    println!("| update size (bytes) | added bytes | time (µs) |");
    println!("|---|---|---|");
    for size in [50, 500, 5_000, 50_000] {
        let (extra, us) = content_cost(size);
        println!("| {size} | {extra} | {us:.1} |");
    }
    // Reading a commit
    let mut rng = StdRng::seed_from_u64(9);
    let mut g = Group::build(256, 256, &mut rng);
    let c = g.commit_by(0, &mut rng);
    let after = g.tree.clone();
    let mut m = g.members.get(&255).unwrap().clone();
    // the member 255 still holds its build-time secrets, which are valid for the nodes the commit wrapped to
    let t = Instant::now();
    let got = receive(&after, &mut m, &c);
    println!("\nReading a commit at 256 members: {:.0} µs ({})", t.elapsed().as_secs_f64() * 1e6, if got.is_some() { "key reached" } else { "FAILED" });
}
