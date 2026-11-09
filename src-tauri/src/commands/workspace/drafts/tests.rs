use super::*;

fn db() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
    crate::database::schema::init_schema(&conn).unwrap();
    conn.execute("INSERT INTO workspace (id, name, description, path, created_at, updated_at) VALUES ('w', 'w', '', '/w', 't', 't')", []).unwrap();
    put_task_row(&conn, "w", &task()).unwrap();
    conn
}

fn task() -> Task {
    Task { id: "t1".into(), title: "Plan".into(), description: "Old".into(), status: "todo".into(), priority: "medium".into(), created_at: "2026-01-01T00:00:00Z".into(), updated_at: "2026-01-01T00:00:00Z".into(), ..Default::default() }
}

/// Someone changes the real record
fn live_edit(conn: &Connection, who: &str, change: impl Fn(&mut Task)) {
    let mut row = read_task(conn, "t1").unwrap().unwrap();
    crdt::ensure(conn, &row).unwrap();
    let before = row.clone();
    change(&mut row);
    crdt::record_write(conn, &row, Some(who), Some(&before)).unwrap();
    put_task_row(conn, "w", &row).unwrap();
}

fn draft_edit(conn: &Connection, id: &str, who: &str, change: impl Fn(&mut Task)) {
    let mut row = view::<Task>(conn, id).unwrap();
    change(&mut row);
    edit(conn, id, &row, Some(who)).unwrap();
}

#[test]
fn a_draft_changes_nothing_in_the_real_record_until_merged() {
    let c = db();
    let d = start::<Task>(&c, "t1", "Try a new plan", Some("Me")).unwrap();
    draft_edit(&c, &d.id, "Me", |t| t.title = "New plan".into());
    assert_eq!(read_task(&c, "t1").unwrap().unwrap().title, "Plan");
    assert_eq!(view::<Task>(&c, &d.id).unwrap().title, "New plan");
    assert_eq!(list(&c, "task", "t1").unwrap().len(), 1);
    merge::<Task>(&c, "w", &d.id).unwrap();
    assert_eq!(read_task(&c, "t1").unwrap().unwrap().title, "New plan");
    assert!(list(&c, "task", "t1").unwrap().is_empty());
}

#[test]
fn the_review_says_what_will_change_and_which_fields_will_collide() {
    let c = db();
    let d = start::<Task>(&c, "t1", "Rework", None).unwrap();
    draft_edit(&c, &d.id, "Me", |t| {
        t.title = "Draft title".into();
        t.description = "Draft description".into();
    });
    // Meanwhile somebody else changes the title, and, separately, the priority
    live_edit(&c, "Ana", |t| {
        t.title = "Ana's title".into();
        t.priority = "high".into();
    });
    let p = preview::<Task>(&c, &d.id).unwrap();
    let paths: Vec<&str> = p.changes.iter().map(|c| c.path.as_str()).collect();
    assert!(paths.contains(&"description"));
    // The title is in dispute, so which value shows is a matter of timing; it is reported as a collision, not a change
    // Priority was changed only by the real record, so the draft does not touch it
    assert!(!paths.contains(&"priority"));
    assert_eq!(p.collisions.iter().map(|c| c.field.as_str()).collect::<Vec<_>>(), ["title"]);
    // Nothing was written by looking
    assert_eq!(read_task(&c, "t1").unwrap().unwrap().description, "Old");

    // Merging keeps both sides' separate changes and the colliding field as a conflict to choose from
    merge::<Task>(&c, "w", &d.id).unwrap();
    let row = read_task(&c, "t1").unwrap().unwrap();
    assert_eq!((row.description.as_str(), row.priority.as_str()), ("Draft description", "high"));
    let state = crdt::load(&c, "task", "t1").unwrap().unwrap();
    let conflict = state.conflicts().into_iter().find(|c| c.field == "title").expect("title is a conflict");
    let mut values: Vec<String> = conflict.options.iter().map(|o| o.value.as_str().unwrap().to_string()).collect();
    values.sort();
    assert_eq!(values, ["Ana's title", "Draft title"]);
}

#[test]
fn drafts_merge_in_either_order_to_the_same_record() {
    let c = db();
    let a = start::<Task>(&c, "t1", "A", None).unwrap();
    let b = start::<Task>(&c, "t1", "B", None).unwrap();
    draft_edit(&c, &a.id, "Me", |t| {
        t.title = "From A".into();
        t.priority = "high".into();
    });
    draft_edit(&c, &b.id, "Me", |t| {
        t.title = "From B".into();
        t.description = "From B".into();
    });

    // The same starting state with the two drafts applied in each order
    let live = crdt::load(&c, "task", "t1").unwrap().unwrap();
    let (state_a, state_b) = (load_draft(&c, &a.id).unwrap().state, load_draft(&c, &b.id).unwrap().state);
    let a_then_b = live.merge(&state_a).merge(&state_b);
    assert_eq!(a_then_b, live.merge(&state_b).merge(&state_a));

    // What merging them through the app does is that same result, with the colliding title kept for someone to choose
    merge::<Task>(&c, "w", &a.id).unwrap();
    merge::<Task>(&c, "w", &b.id).unwrap();
    let merged = crdt::load(&c, "task", "t1").unwrap().unwrap();
    assert_eq!(merged, a_then_b);
    assert_eq!(merged.conflicts().iter().map(|c| c.field.as_str()).collect::<Vec<_>>(), ["title"]);
    let row = read_task(&c, "t1").unwrap().unwrap();
    assert_eq!((row.priority.as_str(), row.description.as_str()), ("high", "From B"));
}

#[test]
fn nothing_is_merged_into_a_deleted_record_or_twice_and_input_is_checked() {
    let c = db();
    let d = start::<Task>(&c, "t1", "Rework", None).unwrap();
    draft_edit(&c, &d.id, "Me", |t| t.title = "New".into());

    let mut empty = view::<Task>(&c, &d.id).unwrap();
    empty.title.clear();
    assert!(edit(&c, &d.id, &empty, None).is_err());
    let mut other = view::<Task>(&c, &d.id).unwrap();
    other.id = "t2".into();
    assert!(edit(&c, &d.id, &other, None).is_err());
    assert!(start::<Task>(&c, "t1", "   ", None).is_err());
    assert!(start::<Task>(&c, "t1", &"x".repeat(MAX_NAME + 1), None).is_err());
    assert!(start::<Task>(&c, "missing", "Name", None).is_err());

    merge::<Task>(&c, "w", &d.id).unwrap();
    assert!(merge::<Task>(&c, "w", &d.id).is_err(), "a draft merges once");
    assert!(edit(&c, &d.id, &view::<Task>(&c, &d.id).unwrap(), None).is_err(), "and cannot be edited after");

    let gone = start::<Task>(&c, "t1", "Again", None).unwrap();
    c.execute("DELETE FROM tasks WHERE id = 't1'", []).unwrap();
    assert!(preview::<Task>(&c, &gone.id).unwrap().deleted);
    assert!(merge::<Task>(&c, "w", &gone.id).is_err());
    discard(&c, &gone.id).unwrap();
    assert!(load_draft(&c, &gone.id).is_err());
}

#[test]
fn a_draft_assigned_to_a_removed_member_says_so_instead_of_failing_obscurely() {
    let c = db();
    c.execute("INSERT INTO members (id, workspace_id, name, role) VALUES ('sam', 'w', 'Sam', 'Editor')", []).unwrap();
    let d = start::<Task>(&c, "t1", "Give to Sam", None).unwrap();
    draft_edit(&c, &d.id, "Me", |t| t.assignee_id = Some("sam".into()));
    c.execute("DELETE FROM members WHERE id = 'sam'", []).unwrap();
    let message = merge::<Task>(&c, "w", &d.id).unwrap_err();
    assert!(message.contains("no longer a member"), "{message}");
    // Nothing was merged, and the draft is still there to fix
    assert!(read_task(&c, "t1").unwrap().unwrap().assignee_id.is_none());
    assert_eq!(list(&c, "task", "t1").unwrap().len(), 1);
}

#[test]
fn the_number_of_open_drafts_is_limited() {
    let c = db();
    for i in 0..MAX_OPEN {
        start::<Task>(&c, "t1", &format!("Draft {i}"), None).unwrap();
    }
    assert!(start::<Task>(&c, "t1", "One too many", None).is_err());
}

// A board with two lists and three cards in the first
fn board_db() -> Connection {
    let c = db();
    for (id, title, position) in [("c1", "Todo", 0), ("c2", "Doing", 1)] {
        c.execute("INSERT INTO kanban_columns (id, workspace_id, title, position, created_at, updated_at) VALUES (?1, 'w', ?2, ?3, 't', 't')", params![id, title, position]).unwrap();
    }
    for (i, id) in ["k1", "k2", "k3"].iter().enumerate() {
        let card = KanbanCard { id: id.to_string(), title: format!("Card {id}"), column_id: "c1".into(), position: i as f64, created_at: "2026-01-01T00:00:00Z".into(), updated_at: "2026-01-01T00:00:00Z".into(), ..Default::default() };
        put_card(&c, "w", &card).unwrap();
    }
    c
}

fn ids(columns: &[KanbanColumn], column: &str) -> Vec<String> {
    columns.iter().find(|c| c.id == column).unwrap().cards.iter().map(|c| c.id.clone()).collect()
}

fn live_board(c: &Connection) -> Vec<KanbanColumn> {
    super::super::kanban::read_columns(c, "w").unwrap()
}

#[test]
fn a_board_draft_moves_cards_without_touching_the_board_until_merged() {
    let c = board_db();
    let b = start_board(&c, "Reorganise", Some("Me")).unwrap();
    move_card(&c, &b.id, "k1", "c2", 0.0, Some("Me")).unwrap();
    move_card(&c, &b.id, "k3", "c1", -1.0, Some("Me")).unwrap();

    let shown = board_view(&c, "w", &b.id).unwrap();
    assert_eq!((ids(&shown, "c1"), ids(&shown, "c2")), (vec!["k3".to_string(), "k2".to_string()], vec!["k1".to_string()]));
    // The real board is as it was, and the card drafts of a board do not show up as drafts of the card
    assert_eq!(ids(&live_board(&c), "c1"), ["k1", "k2", "k3"]);
    assert!(list(&c, "card", "k1").unwrap().is_empty());

    let mut merged = merge_board(&c, "w", &b.id).unwrap();
    merged.sort();
    assert_eq!(merged, ["k1", "k3"]);
    let after = live_board(&c);
    assert_eq!((ids(&after, "c1"), ids(&after, "c2")), (vec!["k3".to_string(), "k2".to_string()], vec!["k1".to_string()]));
    assert!(list_boards(&c).unwrap().is_empty());
    assert!(merge_board(&c, "w", &b.id).is_err(), "a board draft merges once");
}

#[test]
fn merging_a_board_keeps_what_others_changed_meanwhile_and_drops_cards_deleted_meanwhile() {
    let c = board_db();
    let b = start_board(&c, "Try", None).unwrap();
    move_card(&c, &b.id, "k1", "c2", 0.0, None).unwrap();
    move_card(&c, &b.id, "k2", "c2", 1.0, None).unwrap();

    // Meanwhile someone retitles k1 and someone deletes k2
    let mut row = read_card(&c, "k1").unwrap().unwrap();
    crdt::ensure(&c, &row).unwrap();
    let before = row.clone();
    row.title = "Renamed".into();
    crdt::record_write(&c, &row, Some("Ana"), Some(&before)).unwrap();
    put_card(&c, "w", &row).unwrap();
    c.execute("DELETE FROM kanban_cards WHERE id = 'k2'", []).unwrap();

    let review = preview_board(&c, &b.id).unwrap();
    assert!(review.cards.iter().any(|r| r.id == "k2" && r.deleted));
    assert!(review.cards.iter().any(|r| r.id == "k1" && r.changes.iter().any(|c| c.path == "column_id")));

    let merged = merge_board(&c, "w", &b.id).unwrap();
    assert_eq!(merged, ["k1"]);
    let k1 = read_card(&c, "k1").unwrap().unwrap();
    assert_eq!((k1.title.as_str(), k1.column_id.as_str()), ("Renamed", "c2"));
    assert!(read_card(&c, "k2").unwrap().is_none());
}

#[test]
fn a_board_draft_can_be_thrown_away_and_checks_its_input() {
    let c = board_db();
    let b = start_board(&c, "Idea", None).unwrap();
    move_card(&c, &b.id, "k1", "c2", 0.0, None).unwrap();
    assert!(move_card(&c, &b.id, "k1", "nowhere", 0.0, None).is_err());
    assert!(move_card(&c, &b.id, "k1", "c2", f64::NAN, None).is_err());
    assert!(move_card(&c, &b.id, "missing", "c2", 0.0, None).is_err());
    assert!(start_board(&c, "  ", None).is_err());

    discard_board(&c, &b.id).unwrap();
    assert!(list_boards(&c).unwrap().is_empty());
    assert!(board_view(&c, "w", &b.id).is_err());
    assert_eq!(ids(&live_board(&c), "c1"), ["k1", "k2", "k3"]);

    for i in 0..MAX_BOARDS {
        start_board(&c, &format!("Board {i}"), None).unwrap();
    }
    assert!(start_board(&c, "One too many", None).is_err());
}

#[test]
fn a_card_put_back_where_it_was_is_not_part_of_the_review() {
    let c = board_db();
    let b = start_board(&c, "Undo", None).unwrap();
    move_card(&c, &b.id, "k1", "c2", 0.0, None).unwrap();
    move_card(&c, &b.id, "k1", "c1", 0.0, None).unwrap();
    assert!(preview_board(&c, &b.id).unwrap().cards.is_empty());
}
