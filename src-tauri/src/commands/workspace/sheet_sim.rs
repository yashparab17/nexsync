//! Rows and columns inserted or deleted while others edit cells (RESEARCH.md §8m, N26).
//!
//! A spreadsheet is the hardest document to merge because its addresses are positions: "C7" means whatever is in the
//! seventh row now. Two designs are compared on the same random offline sessions.
//!
//! - **By address** (what the app stores today, `features/office/sheets/lib/sheet.ts`): one Yjs map keyed by the cell's
//!   address. Inserting or deleting a row rewrites the formulas and then writes every key whose content changed
//!   (`replaceWorkbook`). A formula is text, with addresses in it.
//! - **By id** (the design in IMPLEMENTATION_PLAN.md Phase 21): every row and column has an id, the order is a list of
//!   ids (RGA, as a Yjs array), cells are keyed by the pair of ids, and a formula holds ids. An insert or delete touches
//!   the list and nothing else.
//!
//! Each replica starts from the same dense grid with a few formulas, works alone for a few steps (set a cell, write a
//! formula, insert or delete a row or column), and then all replicas are merged. What the person meant is defined by
//! identity: a write meant for "the cell I was looking at" belongs to that cell wherever it has moved. The by-id design
//! reaches that by construction, so its column is a consistency check on the model and not an independent measurement
//! (its merge order independence is asserted); the finding is how far the by-address design is from it, and what both
//! designs lose to a concurrent delete.
//!
//! Limits: one offline period, no editing between merges; positions are uniform over the grid (so edits often meet);
//! formulas are plain references, not ranges; the Yjs map is modelled (a set removes the items its author saw, the
//! highest client id wins among concurrent ones), not run.
//!
//! Run the table with `cargo test --release sheet_sim_table -- --ignored --nocapture`.

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

use rand::{rngs::StdRng, Rng, SeedableRng};

/// (client id, clock): concurrent items are ordered by client id first, as Yjs does
type Tag = (u8, u32);
/// A row or column id: (replica that made it, counter); the starting rows and columns are (BASE, index)
type Uid = (u8, u32);
/// The cell a person meant: (row id, column id)
type Cell = (Uid, Uid);

const BASE: u8 = 255;
const START: Tag = (0, 0);
const FRESH: u32 = 1_000_000;

#[derive(Clone)]
struct Elem {
    parent: Option<Uid>,
    tag: Tag,
    dead: bool,
}

/// An ordered list of ids that merges (RGA): an insert goes right after the element before it; of two inserted at the same
/// place the higher tag comes first; a delete leaves a tombstone
#[derive(Clone, Default)]
struct Seq {
    elems: BTreeMap<Uid, Elem>,
}

impl Seq {
    fn start(n: usize) -> Seq {
        let mut s = Seq::default();
        for i in 0..n {
            let parent = if i == 0 { None } else { Some((BASE, i as u32 - 1)) };
            s.elems.insert((BASE, i as u32), Elem { parent, tag: START, dead: false });
        }
        s
    }

    fn order(&self) -> Vec<Uid> {
        let mut kids: HashMap<Option<Uid>, Vec<(Tag, Uid)>> = HashMap::new();
        for (id, e) in &self.elems {
            kids.entry(e.parent).or_default().push((e.tag, *id));
        }
        for v in kids.values_mut() {
            v.sort_by(|a, b| b.cmp(a));
        }
        let mut out = Vec::new();
        let mut stack: Vec<Uid> = kids.get(&None).map(|v| v.iter().rev().map(|k| k.1).collect()).unwrap_or_default();
        while let Some(id) = stack.pop() {
            out.push(id);
            if let Some(v) = kids.get(&Some(id)) {
                stack.extend(v.iter().rev().map(|k| k.1));
            }
        }
        out
    }

    fn visible(&self) -> Vec<Uid> {
        self.order().into_iter().filter(|id| !self.elems[id].dead).collect()
    }

    fn insert(&mut self, at: usize, id: Uid, tag: Tag) {
        let vis = self.visible();
        let parent = if at == 0 { None } else { Some(vis[at - 1]) };
        self.elems.insert(id, Elem { parent, tag, dead: false });
    }

    fn delete(&mut self, at: usize) {
        let id = self.visible()[at];
        self.elems.get_mut(&id).unwrap().dead = true;
    }

    fn merge(&mut self, other: &Seq) {
        for (id, e) in &other.elems {
            self.elems.entry(*id).and_modify(|m| m.dead |= e.dead).or_insert_with(|| e.clone());
        }
    }
}

/// One key of a Yjs map: the live items, and the ones known to be deleted. A set deletes what its author saw and adds one
#[derive(Clone)]
struct Reg<V: Clone> {
    items: BTreeMap<Tag, V>,
    gone: BTreeSet<Tag>,
}

impl<V: Clone> Default for Reg<V> {
    fn default() -> Self {
        Reg { items: BTreeMap::new(), gone: BTreeSet::new() }
    }
}

impl<V: Clone> Reg<V> {
    fn delete(&mut self) {
        let live: Vec<Tag> = self.items.keys().filter(|t| !self.gone.contains(t)).copied().collect();
        self.gone.extend(live);
    }

    fn set(&mut self, tag: Tag, v: V) {
        self.delete();
        self.items.insert(tag, v);
    }

    fn value(&self) -> Option<&V> {
        self.items.iter().rev().find(|(t, _)| !self.gone.contains(t)).map(|(_, v)| v)
    }

    fn merge(&mut self, other: &Reg<V>) {
        for (t, v) in &other.items {
            self.items.entry(*t).or_insert_with(|| v.clone());
        }
        self.gone.extend(other.gone.iter().copied());
    }
}

/// A value as the by-id design stores it
#[derive(Clone, PartialEq, Debug)]
enum Val {
    Num(u32),
    Formula(Vec<Cell>),
}

/// A value as the screen shows it, and as the by-address design stores it. `origin` and `intended` are the simulation's
/// record of what the person meant and are never read by either design
#[derive(Clone, PartialEq, Debug)]
enum Shown {
    Num { v: u32, origin: Cell },
    Formula { refs: Vec<Option<(usize, usize)>>, intended: Vec<Cell> },
}

type Grid = BTreeMap<(usize, usize), Shown>;

#[derive(Clone, Copy, PartialEq)]
enum Axis {
    Row,
    Col,
}

fn at(p: (usize, usize), axis: Axis) -> usize {
    if axis == Axis::Row {
        p.0
    } else {
        p.1
    }
}

fn with(p: (usize, usize), axis: Axis, v: usize) -> (usize, usize) {
    if axis == Axis::Row {
        (v, p.1)
    } else {
        (p.0, v)
    }
}

#[derive(Clone)]
struct Replica {
    id: u8,
    clock: u32,
    uid: u32,
    rows: Seq,
    cols: Seq,
    by_id: BTreeMap<Cell, Reg<Val>>,
    by_address: BTreeMap<(usize, usize), Reg<Shown>>,
    /// Keys written in the by-address design, and list operations in the by-id design
    address_writes: usize,
    id_writes: usize,
}

impl Replica {
    fn start(rows: usize, cols: usize, formulas: usize, rng: &mut StdRng) -> Replica {
        let mut r = Replica { id: 0, clock: 0, uid: 0, rows: Seq::start(rows), cols: Seq::start(cols), by_id: BTreeMap::new(), by_address: BTreeMap::new(), address_writes: 0, id_writes: 0 };
        let cell = |i: usize, j: usize| -> Cell { ((BASE, i as u32), (BASE, j as u32)) };
        let mut n = 0;
        for i in 0..rows {
            for j in 0..cols {
                r.by_id.entry(cell(i, j)).or_default().set(START, Val::Num(n));
                r.by_address.entry((i, j)).or_default().set(START, Shown::Num { v: n, origin: cell(i, j) });
                n += 1;
            }
        }
        for _ in 0..formulas {
            let (i, j) = (rng.gen_range(0..rows), rng.gen_range(0..cols));
            let mut refs: Vec<(usize, usize)> = Vec::new();
            while refs.len() < rng.gen_range(1..=2) {
                let p = (rng.gen_range(0..rows), rng.gen_range(0..cols));
                if p != (i, j) && !refs.contains(&p) {
                    refs.push(p);
                }
            }
            let intended: Vec<Cell> = refs.iter().map(|p| cell(p.0, p.1)).collect();
            r.by_id.entry(cell(i, j)).or_default().set(START, Val::Formula(intended.clone()));
            r.by_address.entry((i, j)).or_default().set(START, Shown::Formula { refs: refs.into_iter().map(Some).collect(), intended });
        }
        r
    }

    fn tag(&mut self) -> Tag {
        self.clock += 1;
        (self.id, self.clock)
    }

    fn size(&self) -> (usize, usize) {
        (self.rows.visible().len(), self.cols.visible().len())
    }

    fn cell_at(&self, p: (usize, usize)) -> Cell {
        (self.rows.visible()[p.0], self.cols.visible()[p.1])
    }

    /// What this device shows, by address
    fn grid_by_address(&self) -> Grid {
        self.by_address.iter().filter_map(|(k, r)| r.value().map(|v| (*k, v.clone()))).collect()
    }

    /// What this device shows, by id
    fn grid_by_id(&self) -> Grid {
        let rp: HashMap<Uid, usize> = self.rows.visible().into_iter().enumerate().map(|(i, u)| (u, i)).collect();
        let cp: HashMap<Uid, usize> = self.cols.visible().into_iter().enumerate().map(|(i, u)| (u, i)).collect();
        let place = |l: &Cell| match (rp.get(&l.0), cp.get(&l.1)) {
            (Some(&a), Some(&b)) => Some((a, b)),
            _ => None,
        };
        let mut g = Grid::new();
        for (cell, reg) in &self.by_id {
            let Some(pos) = place(cell) else { continue };
            match reg.value() {
                Some(Val::Num(v)) => g.insert(pos, Shown::Num { v: *v, origin: *cell }),
                Some(Val::Formula(t)) => g.insert(pos, Shown::Formula { refs: t.iter().map(place).collect(), intended: t.clone() }),
                None => None,
            };
        }
        g
    }

    fn set_number(&mut self, p: (usize, usize), v: u32) {
        let tag = self.tag();
        let cell = self.cell_at(p);
        self.by_id.entry(cell).or_default().set(tag, Val::Num(v));
        self.by_address.entry(p).or_default().set(tag, Shown::Num { v, origin: cell });
        self.id_writes += 1;
        self.address_writes += 1;
    }

    fn set_formula(&mut self, p: (usize, usize), refs: &[(usize, usize)]) {
        let tag = self.tag();
        let cell = self.cell_at(p);
        let intended: Vec<Cell> = refs.iter().map(|r| self.cell_at(*r)).collect();
        self.by_id.entry(cell).or_default().set(tag, Val::Formula(intended.clone()));
        self.by_address.entry(p).or_default().set(tag, Shown::Formula { refs: refs.iter().map(|r| Some(*r)).collect(), intended });
        self.id_writes += 1;
        self.address_writes += 1;
    }

    /// Makes the map match `new`, writing only the keys whose content changed (`replaceWorkbook`)
    fn rewrite(&mut self, new: Grid, tag: Tag) {
        let old = self.grid_by_address();
        for (k, v) in &new {
            if old.get(k) != Some(v) {
                self.by_address.entry(*k).or_default().set(tag, v.clone());
                self.address_writes += 1;
            }
        }
        for k in old.keys() {
            if !new.contains_key(k) {
                self.by_address.get_mut(k).unwrap().delete();
                self.address_writes += 1;
            }
        }
    }

    fn insert(&mut self, axis: Axis, i: usize) {
        let tag = self.tag();
        self.uid += 1;
        let id = (self.id, self.uid);
        if axis == Axis::Row { self.rows.insert(i, id, tag) } else { self.cols.insert(i, id, tag) }
        self.id_writes += 1;
        let shift = |p: (usize, usize)| if at(p, axis) >= i { with(p, axis, at(p, axis) + 1) } else { p };
        let new = self.grid_by_address().into_iter().map(|(k, v)| (shift(k), retarget(v, &shift_ref(shift)))).collect();
        self.rewrite(new, tag);
    }

    fn delete(&mut self, axis: Axis, i: usize) {
        let tag = self.tag();
        if axis == Axis::Row { self.rows.delete(i) } else { self.cols.delete(i) }
        self.id_writes += 1;
        let new = self
            .grid_by_address()
            .into_iter()
            .filter(|(k, _)| at(*k, axis) != i)
            .map(|(k, v)| {
                let k = if at(k, axis) > i { with(k, axis, at(k, axis) - 1) } else { k };
                let f = |r: (usize, usize)| if at(r, axis) == i { None } else if at(r, axis) > i { Some(with(r, axis, at(r, axis) - 1)) } else { Some(r) };
                (k, retarget(v, &f))
            })
            .collect();
        self.rewrite(new, tag);
    }

    fn merge(&mut self, o: &Replica) {
        self.rows.merge(&o.rows);
        self.cols.merge(&o.cols);
        for (k, r) in &o.by_id {
            self.by_id.entry(*k).or_default().merge(r);
        }
        for (k, r) in &o.by_address {
            self.by_address.entry(*k).or_default().merge(r);
        }
        self.clock = self.clock.max(o.clock);
    }
}

fn shift_ref(shift: impl Fn((usize, usize)) -> (usize, usize)) -> impl Fn((usize, usize)) -> Option<(usize, usize)> {
    move |r| Some(shift(r))
}

/// Rewrites the addresses inside a formula (the engine does this when rows or columns move)
fn retarget(v: Shown, f: &impl Fn((usize, usize)) -> Option<(usize, usize)>) -> Shown {
    match v {
        Shown::Formula { refs, intended } => Shown::Formula { refs: refs.into_iter().map(|r| r.and_then(f)).collect(), intended },
        n => n,
    }
}

#[derive(Clone, Copy, Debug)]
pub struct Params {
    pub replicas: usize,
    pub steps: usize,
    /// Share of steps that insert or delete a row or column
    pub structural: f64,
    pub rows: usize,
    pub cols: usize,
}

#[derive(Default, Clone, Debug)]
pub struct Tally {
    pub trials: usize,
    /// Merged states that differ by merge order (must be 0 for both designs)
    pub diverged: usize,
    /// Trials in which the by-address result differs from what people meant
    pub trials_wrong: usize,
    pub values: usize,
    pub values_wrong: usize,
    /// Of the wrong ones, the value is on screen but in another cell
    pub values_moved: usize,
    /// Values somebody typed in this session that should be on screen
    pub typed: usize,
    pub typed_wrong: usize,
    pub formulas: usize,
    /// Formula in the right cell whose references are not the cells it was written for
    pub formulas_retargeted: usize,
    /// Formula that is missing from, or replaced in, its cell
    pub formulas_gone: usize,
    /// Values on screen that mean nothing: nobody meant them to be there
    pub ghosts: usize,
    /// Numbers typed into a row or column that another replica deleted (lost under both designs)
    pub typed_total: usize,
    pub dropped_by_delete: usize,
    /// Formulas (by intent) that point at a deleted row or column: #REF! under both designs
    pub formulas_ref_error: usize,
    pub address_writes: usize,
    pub id_writes: usize,
    pub structural_ops: usize,
}

fn merge_all(reps: &[Replica], order: &[usize]) -> Replica {
    let mut m = reps[order[0]].clone();
    for &i in &order[1..] {
        m.merge(&reps[i]);
    }
    m
}

fn trial(p: Params, seed: u64, t: &mut Tally) {
    let mut rng = StdRng::seed_from_u64(seed);
    let base = Replica::start(p.rows, p.cols, p.rows * p.cols / 12, &mut rng);
    let mut reps: Vec<Replica> = Vec::new();
    let mut fresh = FRESH;
    let mut typed: Vec<(Cell, u32)> = Vec::new();
    for r in 0..p.replicas {
        let mut rep = base.clone();
        rep.id = r as u8;
        for _ in 0..p.steps {
            let (nr, nc) = rep.size();
            if nr == 0 || nc == 0 {
                break;
            }
            if rng.gen_bool(p.structural) {
                let axis = if rng.gen_bool(0.5) { Axis::Row } else { Axis::Col };
                let len = if axis == Axis::Row { nr } else { nc };
                if rng.gen_bool(0.5) {
                    rep.insert(axis, rng.gen_range(0..=len));
                } else if len > 1 {
                    rep.delete(axis, rng.gen_range(0..len));
                }
                t.structural_ops += 1;
            } else if rng.gen_bool(0.8) {
                let pos = (rng.gen_range(0..nr), rng.gen_range(0..nc));
                fresh += 1;
                typed.push((rep.cell_at(pos), fresh));
                rep.set_number(pos, fresh);
            } else {
                let pos = (rng.gen_range(0..nr), rng.gen_range(0..nc));
                let refs: Vec<(usize, usize)> = (0..rng.gen_range(1..=2)).map(|_| (rng.gen_range(0..nr), rng.gen_range(0..nc))).filter(|q| *q != pos).collect();
                if !refs.is_empty() {
                    rep.set_formula(pos, &refs);
                }
            }
        }
        // One device alone: the two designs must show the same thing
        assert_eq!(rep.grid_by_address(), rep.grid_by_id(), "the by-address model disagrees with the by-id model on a single device (seed {seed})");
        t.address_writes += rep.address_writes - base.address_writes;
        t.id_writes += rep.id_writes - base.id_writes;
        reps.push(rep);
    }

    // Merge in two different orders: both designs must end identical in either
    let mut order: Vec<usize> = (0..p.replicas).collect();
    let a = merge_all(&reps, &order);
    order.reverse();
    let b = merge_all(&reps, &order);
    t.trials += 1;
    if a.grid_by_address() != b.grid_by_address() || a.grid_by_id() != b.grid_by_id() {
        t.diverged += 1;
    }

    let meant = a.grid_by_id();
    let got = a.grid_by_address();
    let on_screen: HashMap<u32, Vec<(usize, usize)>> = got.iter().fold(HashMap::new(), |mut m, (k, v)| {
        if let Shown::Num { v, .. } = v {
            m.entry(*v).or_default().push(*k);
        }
        m
    });
    let meant_values: HashSet<u32> = meant.values().filter_map(|v| if let Shown::Num { v, .. } = v { Some(*v) } else { None }).collect();
    let mut wrong = false;
    for (pos, m) in &meant {
        match m {
            Shown::Num { v, .. } => {
                t.values += 1;
                let is_typed = *v >= FRESH;
                t.typed += usize::from(is_typed);
                let ok = matches!(got.get(pos), Some(Shown::Num { v: w, .. }) if w == v);
                if !ok {
                    wrong = true;
                    t.values_wrong += 1;
                    t.typed_wrong += usize::from(is_typed);
                    t.values_moved += usize::from(on_screen.contains_key(v));
                }
            }
            Shown::Formula { refs, intended } => {
                t.formulas += 1;
                t.formulas_ref_error += usize::from(refs.iter().any(Option::is_none));
                match got.get(pos) {
                    Some(Shown::Formula { refs: r, intended: i }) if i == intended => {
                        if r != refs {
                            wrong = true;
                            t.formulas_retargeted += 1;
                        }
                    }
                    _ => {
                        wrong = true;
                        t.formulas_gone += 1;
                    }
                }
            }
        }
    }
    for v in got.values() {
        if let Shown::Num { v, .. } = v {
            t.ghosts += usize::from(!meant_values.contains(v));
        }
    }
    t.trials_wrong += usize::from(wrong);

    let rp: HashSet<Uid> = a.rows.visible().into_iter().collect();
    let cp: HashSet<Uid> = a.cols.visible().into_iter().collect();
    for (cell, _) in &typed {
        t.typed_total += 1;
        t.dropped_by_delete += usize::from(!rp.contains(&cell.0) || !cp.contains(&cell.1));
    }
}

pub fn study(p: Params, trials: usize) -> Tally {
    let mut t = Tally::default();
    for i in 0..trials {
        trial(p, 700_000 + i as u64 * 131 + p.steps as u64 * 7 + p.replicas as u64, &mut t);
    }
    t
}

/// Keys written by the by-address design and list operations by the by-id design for one insert of a row at a random place
pub fn write_cost(rows: usize, cols: usize, samples: usize) -> (f64, f64) {
    let mut rng = StdRng::seed_from_u64(9);
    let (mut a, mut b) = (0usize, 0usize);
    for _ in 0..samples {
        let mut r = Replica::start(rows, cols, rows * cols / 12, &mut rng);
        let (a0, b0) = (r.address_writes, r.id_writes);
        r.insert(Axis::Row, rng.gen_range(0..=rows));
        a += r.address_writes - a0;
        b += r.id_writes - b0;
    }
    (a as f64 / samples as f64, b as f64 / samples as f64)
}

#[test]
fn a_device_alone_shows_the_same_in_both_designs_and_both_merge_in_any_order() {
    for structural in [0.0, 0.25, 0.5] {
        let t = study(Params { replicas: 3, steps: 6, structural, rows: 10, cols: 6 }, 300);
        assert_eq!(t.diverged, 0);
    }
}

#[test]
fn without_row_and_column_changes_the_two_designs_agree() {
    let t = study(Params { replicas: 4, steps: 6, structural: 0.0, rows: 10, cols: 6 }, 300);
    assert_eq!(t.trials_wrong, 0, "addresses only break when rows or columns move");
}

#[test]
fn with_row_and_column_changes_the_by_address_design_shows_wrong_cells() {
    let t = study(Params { replicas: 2, steps: 4, structural: 0.25, rows: 10, cols: 6 }, 400);
    assert!(t.trials_wrong > 0 && t.values_wrong > 0, "expected misplaced values, got none in {} trials", t.trials);
}

#[test]
fn two_rows_inserted_at_the_same_place_are_both_kept() {
    let mut rng = StdRng::seed_from_u64(1);
    let base = Replica::start(4, 3, 0, &mut rng);
    let (mut a, mut b) = (base.clone(), base.clone());
    a.id = 1;
    b.id = 2;
    a.insert(Axis::Row, 2);
    b.insert(Axis::Row, 2);
    let mut m = a.clone();
    m.merge(&b);
    assert_eq!(m.rows.visible().len(), 6);
}

#[test]
#[ignore = "prints the table used in RESEARCH.md; run with --release"]
fn sheet_sim_table() {
    let trials = 2_000;
    println!("\n{trials} sessions per row; a 12 x 6 grid with 6 formulas; every device works alone, then all are merged");
    println!("| devices | steps each | share of steps that insert or delete | sessions with a wrong cell, by address | cells wrong (% of cells) | typed values wrong (% of typed) | formulas not pointing at their cells (%) | by id: sessions with a wrong cell | typed values lost to a concurrent delete (% of typed) | formulas ending as #REF! (%) |");
    println!("|---|---|---|---|---|---|---|---|---|---|");
    for replicas in [2, 4] {
        for steps in [3, 6] {
            for structural in [0.0, 0.1, 0.25, 0.5] {
                let t = study(Params { replicas, steps, structural, rows: 12, cols: 6 }, trials);
                let pc = |n: usize, d: usize| 100.0 * n as f64 / d.max(1) as f64;
                println!(
                    "| {replicas} | {steps} | {:.0}% | {:.1}% | {:.1}% | {:.1}% | {:.1}% | 0.0% | {:.1}% | {:.1}% |",
                    structural * 100.0,
                    pc(t.trials_wrong, t.trials),
                    pc(t.values_wrong, t.values),
                    pc(t.typed_wrong, t.typed),
                    pc(t.formulas_retargeted + t.formulas_gone, t.formulas),
                    pc(t.dropped_by_delete, t.typed_total),
                    pc(t.formulas_ref_error, t.formulas),
                );
                assert_eq!(t.diverged, 0);
            }
        }
    }
    println!("\n| grid (rows x columns) | keys written by address, per inserted row | list operations by id |");
    println!("|---|---|---|");
    for (r, c) in [(12, 6), (50, 10), (200, 20), (1000, 20)] {
        let (a, b) = write_cost(r, c, 20);
        println!("| {r} x {c} | {a:.0} | {b:.0} |");
    }
}
