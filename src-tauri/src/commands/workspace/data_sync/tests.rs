use super::*;

fn db(ws: &str) -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
    crate::database::schema::init_schema(&conn).unwrap();
    conn.execute(
        "INSERT INTO workspace (id, name, description, path, created_at, updated_at) VALUES (?1, 'w', '', '/w', 't', 't')",
        [ws],
    )
    .unwrap();
    conn
}

fn task(id: &str, title: &str, at: &str) -> Task {
    Task {
        id: id.into(),
        title: title.into(),
        description: String::new(),
        status: "todo".into(),
        priority: "medium".into(),
        due_date: None,
        assignee_id: None,
        created_at: "2026-01-01T00:00:00Z".into(),
        updated_at: at.into(),
        ..Default::default()
    }
}

#[test]
fn a_write_stamped_days_ahead_is_refused_and_one_a_few_hours_ahead_is_taken() {
    use crate::commands::workspace::crdt::{self, Crdt};
    let conn = db("w");
    let mut remote = task("t1", "hello", "2026-01-01T00:00:00Z");
    let day = 24 * 60 * 60 * 1000;
    let mut state = crdt::RecordState::from_legacy(remote.paths(false), 1_000);
    state.write("far", "title", serde_json::json!("hijack"), crdt::now_ms() + 3 * day, None);
    remote.crdt = Some(state);
    assert!(crdt::merge_remote(&conn, &remote, None, |_| true).unwrap().is_none(), "a stamp three days ahead was taken");
    let mut near = task("t2", "hello", "2026-01-01T00:00:00Z");
    let mut state = crdt::RecordState::from_legacy(near.paths(false), 1_000);
    state.write("near", "title", serde_json::json!("fine"), crdt::now_ms() + 3 * 60 * 60 * 1000, None);
    near.crdt = Some(state);
    assert!(crdt::merge_remote(&conn, &near, None, |_| true).unwrap().is_some(), "a stamp three hours ahead was refused");
}

// What a record says apart from the merge bookkeeping: tags are kept in a fixed order and times are instants
fn plain_task(t: &Task) -> Task {
    let mut t = Task { crdt: None, updated_at: crdt::rfc3339_of(crdt::ts_of(&t.updated_at)), ..t.clone() };
    t.tags.sort();
    t
}

fn plain_card(c: &KanbanCard) -> KanbanCard {
    let mut c = KanbanCard { crdt: None, updated_at: crdt::rfc3339_of(crdt::ts_of(&c.updated_at)), ..c.clone() };
    c.tags.sort();
    c
}

fn only_tasks(tasks: Vec<Task>) -> DataState {
    DataState { tasks, ..Default::default() }
}

fn put_task(conn: &Connection, ws: &str, t: &Task) {
    merge_state(conn, ws, only_tasks(vec![t.clone()])).unwrap();
}

fn titles(conn: &Connection, ws: &str) -> Vec<(String, String)> {
    let mut v: Vec<_> = export_state(conn, ws).unwrap().tasks.into_iter().map(|t| (t.id, t.title)).collect();
    v.sort();
    v
}

#[test]
fn test_newer_edit_wins_and_older_is_ignored() {
    let a = db("a");
    put_task(&a, "a", &task("1", "old", "2026-01-02T00:00:00Z"));
    assert!(merge_state(&a, "a", only_tasks(vec![task("1", "new", "2026-01-03T00:00:00Z")])).unwrap());
    assert_eq!(titles(&a, "a"), vec![("1".into(), "new".into())]);
    assert!(!merge_state(&a, "a", only_tasks(vec![task("1", "stale", "2026-01-01T12:00:00Z")])).unwrap());
    assert_eq!(titles(&a, "a"), vec![("1".into(), "new".into())]);
}

#[test]
fn test_timestamps_compare_as_instants_not_strings() {
    let a = db("a");
    put_task(&a, "a", &task("1", "local", "2026-01-02T10:00:00+00:00"));
    // 09:00 at UTC-5 is 14:00 UTC, which is later even though the string sorts earlier.
    put_task(&a, "a", &task("1", "remote", "2026-01-02T09:00:00-05:00"));
    assert_eq!(titles(&a, "a"), vec![("1".into(), "remote".into())]);
}

#[test]
fn test_deletion_wins_over_older_copy_and_blocks_resurrection() {
    let a = db("a");
    let b = db("b");
    let t = task("1", "keep?", "2026-01-02T00:00:00Z");
    put_task(&a, "a", &t);
    put_task(&b, "b", &t);
    record_tombstone(&a, "a", ENTITY_TASK, "1").unwrap();
    a.execute("DELETE FROM tasks WHERE id = '1'", []).unwrap();

    // The peer that stayed offline receives the deletion...
    merge_state(&b, "b", export_state(&a, "a").unwrap()).unwrap();
    assert!(titles(&b, "b").is_empty());
    // ...and its old copy can no longer bring the record back on the deleting side.
    put_task(&a, "a", &t);
    assert!(titles(&a, "a").is_empty());
}

#[test]
fn test_edit_after_deletion_survives() {
    let a = db("a");
    record_tombstone(&a, "a", ENTITY_TASK, "1").unwrap();
    // An edit made an hour from now: after the deletion, and not so far ahead that the clock check refuses it
    put_task(&a, "a", &task("1", "revived", &(Utc::now() + chrono::Duration::hours(1)).to_rfc3339()));
    assert_eq!(titles(&a, "a"), vec![("1".into(), "revived".into())]);
    assert!(export_state(&a, "a").unwrap().tombstones.is_empty());
}

#[test]
fn test_two_devices_converge_after_offline_edits() {
    let a = db("a");
    let b = db("b");
    put_task(&a, "a", &task("1", "shared", "2026-01-01T00:00:00Z"));
    put_task(&b, "b", &task("1", "shared", "2026-01-01T00:00:00Z"));
    put_task(&a, "a", &task("1", "edited on a", "2026-01-05T00:00:00Z"));
    put_task(&b, "b", &task("1", "edited on b", "2026-01-06T00:00:00Z"));
    put_task(&a, "a", &task("only-a", "a task", "2026-01-02T00:00:00Z"));
    put_task(&b, "b", &task("only-b", "b task", "2026-01-02T00:00:00Z"));

    merge_state(&a, "a", export_state(&b, "b").unwrap()).unwrap();
    merge_state(&b, "b", export_state(&a, "a").unwrap()).unwrap();
    assert_eq!(titles(&a, "a"), titles(&b, "b"));
    assert_eq!(titles(&a, "a").len(), 3);
    assert!(titles(&a, "a").contains(&("1".into(), "edited on b".into())));
}

#[test]
fn test_equal_timestamps_still_converge() {
    let a = db("a");
    let b = db("b");
    put_task(&a, "a", &task("1", "from a", "2026-01-05T00:00:00Z"));
    put_task(&b, "b", &task("1", "from b", "2026-01-05T00:00:00Z"));
    merge_state(&a, "a", export_state(&b, "b").unwrap()).unwrap();
    merge_state(&b, "b", export_state(&a, "a").unwrap()).unwrap();
    assert_eq!(titles(&a, "a"), titles(&b, "b"));
}

#[test]
fn test_tags_due_dates_and_checklists_travel_with_the_record() {
    use super::super::models::ChecklistItem;
    let (a, b) = (db("a"), db("b"));
    let col = ColumnRecord { id: "c1".into(), title: "Todo".into(), position: 0 };
    let tagged_task = Task { tags: vec!["urgent".into(), "api".into()], ..task("t1", "ship", "2026-02-01T00:00:00Z") };
    let card = KanbanCard {
        id: "k1".into(),
        title: "card".into(),
        column_id: "c1".into(),
        // Halfway between two cards; it must come back as exactly this, not as 2
        position: 2.5,
        tags: vec!["ui".into()],
        due_date: Some("2026-03-01".into()),
        assignee_id: Some("m1".into()),
        checklist: vec![ChecklistItem { id: "i1".into(), text: "write".into(), done: true }],
        created_at: "2026-01-01T00:00:00Z".into(),
        updated_at: "2026-01-01T00:00:00Z".into(),
        ..Default::default()
    };
    let state = DataState { tasks: vec![tagged_task.clone()], columns: vec![col], cards: vec![card.clone()], ..Default::default() };
    merge_state(&a, "a", state).unwrap();
    // What one device exports, another merges and reads back unchanged
    merge_state(&b, "b", export_state(&a, "a").unwrap()).unwrap();
    let got = export_state(&b, "b").unwrap();
    assert_eq!(plain_task(&got.tasks[0]), plain_task(&tagged_task));
    assert_eq!(plain_card(&got.cards[0]), plain_card(&card));

    // Oversized tag lists are refused rather than stored
    let many = Task { tags: (0..11).map(|i| i.to_string()).collect(), ..task("t2", "x", "2026-02-01T00:00:00Z") };
    merge_state(&b, "b", only_tasks(vec![many])).unwrap();
    assert_eq!(export_state(&b, "b").unwrap().tasks.len(), 1);
}

#[test]
fn test_comments_travel_with_the_record_and_oversized_ones_are_refused() {
    use super::super::models::Comment;
    let (a, b) = (db("a"), db("b"));
    let comment = |id: &str, text: &str| Comment { id: id.into(), author: "Ana".into(), text: text.into(), at: "2026-02-01T00:00:00Z".into() };
    let talked = Task { comments: vec![comment("c1", "@Bo can you check?")], ..task("t1", "ship", "2026-02-01T00:00:00Z") };
    merge_state(&a, "a", only_tasks(vec![talked.clone()])).unwrap();
    merge_state(&b, "b", export_state(&a, "a").unwrap()).unwrap();
    assert_eq!(plain_task(&export_state(&b, "b").unwrap().tasks[0]), plain_task(&talked));

    let long = Task { comments: vec![comment("c2", &"x".repeat(2001))], ..task("t2", "x", "2026-02-01T00:00:00Z") };
    let empty = Task { comments: vec![comment("c3", "  ")], ..task("t3", "x", "2026-02-01T00:00:00Z") };
    merge_state(&b, "b", only_tasks(vec![long, empty])).unwrap();
    assert_eq!(export_state(&b, "b").unwrap().tasks.len(), 1);
}

#[test]
fn test_cards_follow_columns_and_deleted_columns_stay_deleted() {
    let a = db("a");
    let col = ColumnRecord { id: "c1".into(), title: "Todo".into(), position: 0 };
    let card = KanbanCard {
        id: "k1".into(),
        title: "card".into(),
        description: String::new(),
        column_id: "c1".into(),
        position: 0.0,
        created_at: "2026-01-01T00:00:00Z".into(),
        updated_at: "2026-01-01T00:00:00Z".into(),
        ..Default::default()
    };
    // A card for a column we don't have is parked in the Recovered column, not dropped.
    merge_state(&a, "a", DataState { cards: vec![card.clone()], ..Default::default() }).unwrap();
    let parked = export_state(&a, "a").unwrap();
    assert_eq!(parked.cards.len(), 1);
    assert_eq!(parked.cards[0].column_id, RECOVERED_COLUMN);

    // When its column turns up the card goes home.
    merge_state(&a, "a", DataState { columns: vec![col.clone()], cards: vec![card.clone()], ..Default::default() }).unwrap();
    let home = export_state(&a, "a").unwrap();
    assert_eq!((home.cards.len(), home.cards[0].column_id.as_str()), (1, "c1"));

    // Deleting the column removes its cards, and the old column can't come back.
    let tomb = Tombstone { entity: ENTITY_COLUMN.into(), id: "c1".into(), deleted_at: "2999-01-01T00:00:00Z".into(), erased: false };
    merge_state(&a, "a", DataState { tombstones: vec![tomb], ..Default::default() }).unwrap();
    let s = export_state(&a, "a").unwrap();
    assert!(s.columns.iter().all(|c| c.id == RECOVERED_COLUMN) && s.cards.is_empty());
    merge_state(&a, "a", DataState { columns: vec![col], ..Default::default() }).unwrap();
    assert!(export_state(&a, "a").unwrap().columns.iter().all(|c| c.id == RECOVERED_COLUMN));
}

// A local edit the way the task commands make it: the row changes, then the merge state is told
fn edit(conn: &Connection, ws: &str, id: &str, change: impl Fn(&mut Task)) {
    let mut row = read_task(conn, id).unwrap().unwrap();
    crdt::ensure(conn, &row).unwrap();
    change(&mut row);
    put_task_row(conn, ws, &row).unwrap();
    crdt::record_write(conn, &row, Some("someone"), None).unwrap();
}

fn exchange(a: &Connection, b: &Connection) {
    merge_state(a, "a", export_state(b, "b").unwrap()).unwrap();
    merge_state(b, "b", export_state(a, "a").unwrap()).unwrap();
}

// With members linked directly and the host relaying too, one change can reach a device by several routes
#[test]
fn a_change_that_arrives_by_several_routes_is_one_entry_in_the_catch_up_review() {
    let (a, b, c) = (db("a"), db("b"), db("c"));
    put_task(&a, "a", &task("1", "one", "2026-01-02T00:00:00Z"));
    merge_state(&b, "b", export_state(&a, "a").unwrap()).unwrap();
    merge_state(&c, "c", export_state(&a, "a").unwrap()).unwrap();

    edit(&a, "a", "1", |t| t.title = "changed".into());
    let direct = export_state(&a, "a").unwrap();
    merge_state(&c, "c", direct.clone()).unwrap();
    let relayed = export_state(&c, "c").unwrap();

    // B hears it from A, then from C (which had it from A), then from A again
    assert!(merge_state(&b, "b", direct.clone()).unwrap());
    assert!(!merge_state(&b, "b", relayed).unwrap());
    assert!(!merge_state(&b, "b", direct).unwrap());
    let title_changes = crate::commands::workspace::catchup::list(&b)
        .unwrap()
        .into_iter()
        .filter(|e| e.kind == "field" && e.path == "title")
        .count();
    assert_eq!(title_changes, 1);
}

#[test]
fn a_record_that_cannot_be_stored_yet_does_not_stop_the_others() {
    let a = db("a");
    // Assigned to somebody this device has no member record for yet, which the database refuses
    let mut unknown = task("1", "assigned to a stranger", "2026-01-02T00:00:00Z");
    unknown.assignee_id = Some("ghost".into());
    let fine = task("2", "ordinary", "2026-01-02T00:00:00Z");
    assert!(merge_state(&a, "a", only_tasks(vec![unknown.clone(), fine])).unwrap());
    assert!(read_task(&a, "2").unwrap().is_some(), "the other task is merged");
    assert!(read_task(&a, "1").unwrap().is_none());
    // And nothing half-done is left behind: no merge state without its row, which would make it look up to date
    assert!(crdt::load(&a, "task", "1").unwrap().is_none());

    // Once the member is known, the same record merges on the next sync
    a.execute("INSERT INTO members (id, workspace_id, name, role) VALUES ('ghost', 'a', 'Ghost', 'Editor')", []).unwrap();
    assert!(merge_state(&a, "a", only_tasks(vec![unknown])).unwrap());
    assert_eq!(read_task(&a, "1").unwrap().unwrap().assignee_id.as_deref(), Some("ghost"));
}

fn conflicts_of(conn: &Connection, id: &str) -> Vec<crdt::Conflict> {
    let mut rows = vec![read_task(conn, id).unwrap().unwrap()];
    crdt::attach_conflicts(conn, &mut rows).unwrap();
    rows.remove(0).conflicts
}

#[test]
fn test_edits_to_different_fields_while_apart_both_survive_and_the_same_field_is_a_conflict() {
    let (a, b) = (db("a"), db("b"));
    let t = task("1", "ship", "2026-01-01T00:00:00Z");
    put_task(&a, "a", &t);
    put_task(&b, "b", &t);

    // Apart: one renames, the other changes the status and comments
    edit(&a, "a", "1", |t| t.title = "Ship it".into());
    edit(&b, "b", "1", |t| {
        t.status = "in_progress".into();
        t.comments.push(super::super::models::Comment { id: "c1".into(), author: "Bo".into(), text: "on it".into(), at: "2026-02-01T00:00:00Z".into() });
    });
    exchange(&a, &b);
    let (ra, rb) = (read_task(&a, "1").unwrap().unwrap(), read_task(&b, "1").unwrap().unwrap());
    assert_eq!((ra.title.as_str(), ra.status.as_str(), ra.comments.len()), ("Ship it", "in_progress", 1));
    assert_eq!(plain_task(&ra), plain_task(&rb));
    assert!(conflicts_of(&a, "1").is_empty());

    // Apart again, both rename: both values are kept, the same on both devices, until someone chooses
    edit(&a, "a", "1", |t| t.title = "Title A".into());
    edit(&b, "b", "1", |t| t.title = "Title B".into());
    exchange(&a, &b);
    assert_eq!(read_task(&a, "1").unwrap().unwrap().title, read_task(&b, "1").unwrap().unwrap().title);
    let (ca, cb) = (conflicts_of(&a, "1"), conflicts_of(&b, "1"));
    assert_eq!(ca, cb);
    assert_eq!((ca.len(), ca[0].field.as_str(), ca[0].options.len()), (1, "title", 2));

    // Choosing settles it on both
    let base = read_task(&a, "1").unwrap().unwrap();
    let chosen = crdt::resolve_field(&a, &base, "title", serde_json::json!("Title A"), Some("Ann")).unwrap().unwrap();
    put_task_row(&a, "a", &chosen).unwrap();
    exchange(&a, &b);
    assert!(conflicts_of(&a, "1").is_empty() && conflicts_of(&b, "1").is_empty());
    assert_eq!(read_task(&b, "1").unwrap().unwrap().title, "Title A");
}

#[test]
fn test_a_remote_record_cannot_smuggle_an_invalid_value_in_through_hidden_state() {
    let a = db("a");
    let mut hostile = task("1", "fine", "2026-01-02T00:00:00Z");
    let mut state = crdt::RecordState::from_legacy(crdt::Crdt::paths(&hostile, false), 1);
    state.write("evil", "status", serde_json::json!("not-a-status"), 9_999_999_999_999, None);
    hostile.crdt = Some(state);
    merge_state(&a, "a", only_tasks(vec![hostile])).unwrap();
    assert!(titles(&a, "a").is_empty(), "the merged record would hold an invalid status, so it is refused");
}

#[test]
fn test_invalid_remote_records_are_ignored() {
    let a = db("a");
    let mut bad = task("1", "bad status", "2026-01-02T00:00:00Z");
    bad.status = "not-a-status".into();
    let empty_title = task("2", "", "2026-01-02T00:00:00Z");
    merge_state(&a, "a", only_tasks(vec![bad, empty_title])).unwrap();
    assert!(titles(&a, "a").is_empty());
}
