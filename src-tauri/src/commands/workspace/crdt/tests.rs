use super::*;

fn val(s: &str) -> Value {
    json!(s)
}

fn base(replica: &str) -> RecordState {
    let mut s = RecordState::default();
    s.write(replica, "title", val("t0"), 10, None);
    s.write(replica, "status", val("todo"), 10, None);
    s
}

#[test]
fn an_overwritten_value_stays_in_the_replay_log_until_the_record_is_forgotten() {
    let conn = Connection::open_in_memory().unwrap();
    crate::database::schema::init_schema(&conn).unwrap();
    let mut s = base("a");
    save(&conn, "task", "t1", &s).unwrap();
    s.write("a", "title", val("second"), 20, Some("Ana"));
    save(&conn, "task", "t1", &s).unwrap();
    s.write("b", "title", val("third"), 30, Some("Bo"));
    save(&conn, "task", "t1", &s).unwrap();
    save(&conn, "task", "t1", &s).unwrap();
    let log = write_history(&conn, "task", "t1").unwrap();
    let titles: Vec<&str> = log.iter().filter(|w| w.path == "title").map(|w| w.value.as_str()).collect();
    assert_eq!(titles, vec!["\"t0\"", "\"second\"", "\"third\""]);
    assert!(write_history(&conn, "task", "other").unwrap().is_empty());
    forget(&conn, "task", "t1").unwrap();
    assert!(write_history(&conn, "task", "t1").unwrap().is_empty());
}

#[test]
fn different_fields_both_survive() {
    let a0 = base("a");
    let (mut a, mut b) = (a0.clone(), a0.clone());
    a.write("a", "title", val("new title"), 20, None);
    b.write("b", "status", val("done"), 21, None);
    let m = a.merge(&b);
    assert_eq!(m.resolved()["title"], val("new title"));
    assert_eq!(m.resolved()["status"], val("done"));
    assert!(m.conflicts().is_empty());
}

#[test]
fn same_field_keeps_both_and_reports_a_conflict_until_someone_chooses() {
    let a0 = base("a");
    let (mut a, mut b) = (a0.clone(), a0.clone());
    a.write("a", "title", val("from a"), 20, Some("Ann"));
    b.write("b", "title", val("from b"), 25, Some("Bo"));
    let m = a.merge(&b);
    assert_eq!(m.resolved()["title"], val("from b"), "the later write is shown");
    let c = m.conflicts();
    assert_eq!(c.len(), 1);
    assert_eq!(c[0].options.iter().map(|o| o.value.clone()).collect::<Vec<_>>(), vec![val("from b"), val("from a")]);
    assert_eq!(c[0].options[1].who.as_deref(), Some("Ann"));

    // Choosing a value, even the one already shown, settles it everywhere
    let mut chosen = m.clone();
    chosen.write("a", "title", val("from b"), 30, Some("Ann"));
    assert!(chosen.conflicts().is_empty());
    assert!(m.merge(&chosen).conflicts().is_empty());
}

#[test]
fn a_write_after_seeing_the_other_is_not_a_conflict() {
    let a0 = base("a");
    let mut a = a0.clone();
    a.write("a", "title", val("a1"), 20, None);
    let mut b = a0.merge(&a);
    b.write("b", "title", val("b1"), 30, None);
    let m = a.merge(&b);
    assert!(m.conflicts().is_empty());
    assert_eq!(m.resolved()["title"], val("b1"));
    // And an older copy of the record does not bring back what has been overwritten
    assert_eq!(m.merge(&a0).resolved()["title"], val("b1"));
}

#[test]
fn concurrent_adds_to_a_set_all_survive_and_add_wins_over_remove() {
    let a0 = base("a");
    let (mut a, mut b) = (a0.clone(), a0.clone());
    a.write("a", "comments/c1", json!({"id": "c1"}), 20, None);
    b.write("b", "comments/c2", json!({"id": "c2"}), 21, None);
    let m = a.merge(&b);
    assert!(m.resolved().contains_key("comments/c1") && m.resolved().contains_key("comments/c2"));

    // One removes a tag while the other re-adds it concurrently: it stays
    let mut with_tag = base("a");
    with_tag.write("a", "tags/x", json!(true), 15, None);
    let (mut remover, mut adder) = (with_tag.clone(), with_tag.clone());
    remover.write("a", "tags/x", Value::Null, 20, None);
    adder.write("b", "tags/x", json!(true), 21, None);
    assert_eq!(remover.merge(&adder).resolved()["tags/x"], json!(true));
    // A removal the other side had seen does remove it
    let mut seen = with_tag.clone();
    seen.write("a", "tags/x", Value::Null, 20, None);
    assert_eq!(with_tag.merge(&seen).resolved()["tags/x"], Value::Null);
}

#[test]
fn merge_is_commutative_associative_and_idempotent_on_random_histories() {
    use rand::{rngs::StdRng, Rng, SeedableRng};
    let paths = ["title", "status", "tags/x", "tags/y", "comments/1", "position", "checklist/a", "checklist/a/text"];
    let mut rng = StdRng::seed_from_u64(7);
    for _ in 0..300 {
        let mut replicas: Vec<RecordState> = (0..3).map(|_| base("root")).collect();
        for step in 0..rng.gen_range(3..14) {
            let i = rng.gen_range(0..3);
            match rng.gen_range(0..4) {
                0 => {
                    let j = rng.gen_range(0..3);
                    let other = replicas[j].clone();
                    replicas[i] = replicas[i].merge(&other);
                }
                _ => {
                    let path = paths[rng.gen_range(0..paths.len())];
                    let v = if rng.gen_bool(0.2) { Value::Null } else { json!(rng.gen_range(0..4)) };
                    replicas[i].write(&format!("r{i}"), path, v, 100 + step, None);
                }
            }
        }
        let (a, b, c) = (&replicas[0], &replicas[1], &replicas[2]);
        assert_eq!(a.merge(b), b.merge(a), "commutative");
        assert_eq!(a.merge(b).merge(c), a.merge(&b.merge(c)), "associative");
        assert_eq!(a.merge(a), *a, "idempotent");
        assert_eq!(a.merge(b).resolved(), b.merge(a).resolved());
    }
}

fn task(id: &str) -> Task {
    Task {
        id: id.into(),
        title: "ship".into(),
        description: "d".into(),
        status: "todo".into(),
        priority: "low".into(),
        created_at: "2026-01-01T00:00:00Z".into(),
        updated_at: "2026-01-01T00:00:00Z".into(),
        ..Default::default()
    }
}

#[test]
fn a_task_survives_the_trip_through_paths() {
    let mut t = task("t1");
    t.tags = vec!["b".into(), "a".into()];
    t.comments = vec![Comment { id: "c1".into(), author: "Ann".into(), text: "hi".into(), at: "2026-01-02T00:00:00Z".into() }];
    t.due_date = Some("2026-02-01".into());
    let back = Task::materialize(&t, &RecordState::from_legacy(t.paths(false), 1).resolved());
    assert_eq!(back.tags, vec!["a".to_string(), "b".to_string()], "tags come back in a fixed order");
    assert_eq!((back.comments, back.due_date, back.title), (t.comments, t.due_date, t.title));
}

#[test]
fn a_card_keeps_checklist_order_and_item_edits_from_different_people() {
    let mut card = KanbanCard { id: "k".into(), title: "c".into(), column_id: "col".into(), ..Default::default() };
    card.checklist = vec![
        ChecklistItem { id: "i1".into(), text: "one".into(), done: false },
        ChecklistItem { id: "i2".into(), text: "two".into(), done: false },
    ];
    let mut a = RecordState::from_legacy(card.paths(false), 1);
    let mut b = a.clone();
    a.write("a", "checklist/i1/done", json!(true), 5, None);
    b.write("b", "checklist/i2/text", json!("two!"), 6, None);
    b.write("b", "checklist/i3", json!(2), 7, None);
    b.write("b", "checklist/i3/text", json!("three"), 7, None);
    let merged = KanbanCard::materialize(&card, &a.merge(&b).resolved());
    assert_eq!(
        merged.checklist.iter().map(|i| (i.id.as_str(), i.text.as_str(), i.done)).collect::<Vec<_>>(),
        vec![("i1", "one", true), ("i2", "two!", false), ("i3", "three", false)]
    );
}

#[test]
fn an_edit_from_a_stale_copy_does_not_undo_what_others_changed() {
    let t = task("t1");
    let mut s = RecordState::from_legacy(t.paths(false), 1);
    // A collaborator renames the task after this editor opened it
    s.write("other", "title", val("renamed by other"), 50, None);
    // The editor still holds the old title, and adds a tag
    let mut stale = t.clone();
    stale.tags = vec!["x".into()];
    s.diff_write_from("me", &stale.paths(false), Some(&t.paths(false)), 60, None);
    let now = Task::materialize(&t, &s.resolved());
    assert_eq!((now.title.as_str(), now.tags.clone()), ("renamed by other", vec!["x".to_string()]));
    // Without the starting copy the old title would be written back over the rename
    let mut blind = RecordState::from_legacy(t.paths(false), 1);
    blind.write("other", "title", val("renamed by other"), 50, None);
    blind.diff_write("me", &stale.paths(false), 60, None);
    assert_eq!(Task::materialize(&t, &blind.resolved()).title, "ship");
}

#[test]
fn diff_write_only_writes_what_changed() {
    let t = task("t1");
    let mut s = RecordState::from_legacy(t.paths(false), 1);
    let mut edited = t.clone();
    edited.title = "renamed".into();
    edited.tags = vec!["x".into()];
    assert!(s.diff_write("me", &edited.paths(false), 50, None));
    assert_eq!(s.vv.get("me"), Some(&2), "one write for the title and one for the new tag");
    assert!(!s.diff_write("me", &edited.paths(false), 51, None));
    edited.tags.clear();
    assert!(s.diff_write("me", &edited.paths(false), 52, None));
    assert_eq!(Task::materialize(&t, &s.resolved()).tags, Vec::<String>::new());
}

/// A record as a newer version of the app might write it: an extra field on the record, on a write, and a path this
/// version has never heard of
const FUTURE: &str = r#"{"vv":{"n":2},"schema":2,"fields":{
    "title":[{"dot":{"r":"n","c":1},"ts":5,"value":"ship","style":"bold"}],
    "emoji":[{"dot":{"r":"n","c":2},"ts":6,"value":"party","shape":"star"}]}}"#;

#[test]
fn what_a_newer_version_added_survives_an_edit_by_this_one() {
    let state: RecordState = serde_json::from_str(FUTURE).unwrap();
    let mut t = task("t1");
    t.title = "ship it".into();
    // This version's view of the record has no "emoji", so the edit it makes must not remove it
    let mut edited = state.clone();
    assert!(edited.diff_write("old", &t.paths(false), 10, None));
    let out = serde_json::to_value(&edited).unwrap();
    assert_eq!(out["schema"], 2, "a field on the record itself was dropped");
    assert_eq!(out["fields"]["emoji"][0]["shape"], "star", "a field on a write was dropped");
    assert_eq!(out["fields"]["emoji"][0]["value"], "party", "a path this version cannot show was removed");
    assert_eq!(edited.resolved().get("title"), Some(&json!("ship it")), "the edit itself was lost");
}

#[test]
fn extra_fields_do_not_change_what_merging_does() {
    let a: RecordState = serde_json::from_str(FUTURE).unwrap();
    let mut b = a.clone();
    b.write("old", "title", json!("other"), 9, None);
    let mut c: RecordState = serde_json::from_str(FUTURE).unwrap();
    c.extra.insert("schema".into(), json!(3));
    assert_eq!(a.merge(&b), b.merge(&a));
    assert_eq!(a.merge(&c), c.merge(&a), "the order of the copies changed the result");
    assert_eq!(a.merge(&a), a, "merging a copy with itself changed it");
    assert_eq!(a.merge(&c).extra.get("schema"), Some(&json!(3)));
}

#[test]
fn a_state_without_extra_fields_is_written_exactly_as_before() {
    let s = RecordState::from_legacy(task("t1").paths(false), 1);
    let text = serde_json::to_string(&s).unwrap();
    assert!(!text.contains("extra"), "the placeholder leaked into the stored form: {text}");
    assert_eq!(serde_json::from_str::<RecordState>(&text).unwrap(), s);
}
