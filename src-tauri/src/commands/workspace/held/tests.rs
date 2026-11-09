use super::*;
use crate::commands::p2p::membership;
use crate::commands::workspace::{chat::chatlog::Entry, signing};
use iroh::SecretKey;
use serde_json::json;

fn key(n: u8) -> SecretKey {
    SecretKey::from_bytes(&[n; 32])
}
fn id(n: u8) -> String {
    key(n).public().to_string()
}

fn workspace() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    crate::database::schema::init_schema(&conn).unwrap();
    conn.execute("INSERT INTO workspace (id, name, description, path, created_at, updated_at) VALUES ('w1', 'w', '', '/w', 't', 't')", []).unwrap();
    conn
}

/// Owner 1; Editor 2, Viewer 3, Admin 4; 5 was removed; 9 is nobody
fn list_with(conn: &Connection, removed: &[u8]) {
    let owner = key(1);
    let members = vec![(id(2), "Editor".to_string()), (id(3), "Viewer".to_string()), (id(4), "Admin".to_string())];
    let m = membership::issue(&owner, "w1", "w", 1, &id(1), members, removed.iter().map(|n| id(*n)).collect());
    conn.execute("INSERT OR REPLACE INTO membership (id, doc) VALUES (1, ?1)", [serde_json::to_string(&m).unwrap()]).unwrap();
}

/// A task by the owner's device, with its title written by `by` (signed with that key)
fn task_written_by(by: u8, title: &str) -> Task {
    task_written_under(by, title, None)
}

/// Like the above, also naming the version of the member list it was made under (signed, as the app does)
fn task_written_under(by: u8, title: &str, epoch: Option<u64>) -> Task {
    let mut state = RecordState::default();
    let now = crdt::now_ms();
    state.write("owner-replica", "title", json!("original"), now - 20_000, Some("Owner"));
    state.write(&format!("replica-{by}"), "title", json!(title), now - 10_000, Some("Them"));
    let sibling = state.fields.get_mut("title").unwrap().iter_mut().find(|s| s.dot.r == format!("replica-{by}")).unwrap();
    let (by_key, sig) = signing::sign_with(&key(by), &signing::Write { entity: "task", record: "t1", path: "title", replica: &sibling.dot.r.clone(), counter: sibling.dot.c, ts: sibling.ts, who: Some("Them"), value: &json!(title) });
    if let Some(ep) = epoch {
        let w = signing::Write { entity: "task", record: "t1", path: "title", replica: &sibling.dot.r.clone(), counter: sibling.dot.c, ts: sibling.ts, who: Some("Them"), value: &json!(title) };
        sibling.sig2 = Some(signing::to_hex(&key(by).sign(&w.payload_under(ep)).to_bytes()));
        sibling.ep = Some(ep);
    }
    sibling.by = Some(by_key);
    sibling.sig = Some(sig);
    Task { id: "t1".into(), title: title.into(), status: "todo".into(), priority: "medium".into(), created_at: "2026-01-01T00:00:00Z".into(), updated_at: "2026-01-01T00:00:00Z".into(), crdt: Some(state), ..Default::default() }
}

fn local_task(conn: &Connection) -> Task {
    let t = Task { id: "t1".into(), title: "original".into(), status: "todo".into(), priority: "medium".into(), created_at: "2026-01-01T00:00:00Z".into(), updated_at: "2026-01-01T00:00:00Z".into(), ..Default::default() };
    crdt::ensure(conn, &t).unwrap();
    data_sync::put_task_row(conn, "w1", &t).unwrap();
    t
}

/// What the sync code does: merge, and write the row that comes back
fn arrive(conn: &Connection, local: Option<&Task>, remote: &Task) -> bool {
    match crdt::merge_remote(conn, remote, local, |_| true).unwrap() {
        Some(row) => {
            data_sync::put_task_row(conn, "w1", &row).unwrap();
            true
        }
        None => false,
    }
}

fn title(conn: &Connection) -> String {
    data_sync::read_task(conn, "t1").unwrap().unwrap().title
}

#[test]
fn an_editors_write_is_merged_and_a_viewers_a_strangers_and_a_removed_members_are_held() {
    for (by, merged) in [(2u8, true), (3, false), (9, false), (5, false)] {
        let conn = workspace();
        list_with(&conn, &[5]);
        let local = local_task(&conn);
        let remote = task_written_by(by, "changed");
        arrive(&conn, Some(&local), &remote);
        assert_eq!(title(&conn), if merged { "changed" } else { "original" }, "key {by}");
        assert_eq!(count(&conn), i64::from(!merged), "key {by}");
    }
}

/// Stores a version of the list the way the app does (it also becomes the newest)
fn store_version(conn: &Connection, epoch: u64, members: &[(u8, &str)]) {
    let m = membership::issue(&key(1), "w1", "w", epoch, &id(1), members.iter().map(|(n, r)| (id(*n), r.to_string())).collect(), vec![]);
    conn.execute("INSERT OR REPLACE INTO membership (id, doc) VALUES (1, ?1)", [serde_json::to_string(&m).unwrap()]).unwrap();
    conn.execute("INSERT OR REPLACE INTO membership_history (epoch, doc) VALUES (?1, ?2)", params![epoch as i64, serde_json::to_string(&m).unwrap()]).unwrap();
}

#[test]
fn a_write_that_names_a_list_version_is_dropped_when_its_key_could_not_write_then_and_held_when_it_could_but_may_not_now() {
    // Version 1: 3 is an Editor. Version 2 (now): 3 is a Viewer, and 9 never was a member.
    let setup = || {
        let conn = workspace();
        store_version(&conn, 1, &[(2, "Editor"), (3, "Editor")]);
        store_version(&conn, 2, &[(2, "Editor"), (3, "Viewer")]);
        let local = local_task(&conn);
        (conn, local)
    };
    // Could write at version 1, may not now: held
    let (conn, local) = setup();
    arrive(&conn, Some(&local), &task_written_under(3, "before the demotion", Some(1)));
    assert_eq!((title(&conn), count(&conn)), ("original".to_string(), 1));
    // Names the version where it was a Viewer already: dropped, nothing held
    let (conn, local) = setup();
    arrive(&conn, Some(&local), &task_written_under(3, "claims to be an Editor now", Some(2)));
    assert_eq!((title(&conn), count(&conn)), ("original".to_string(), 0));
    // A stranger naming a version it was never in: dropped
    let (conn, local) = setup();
    arrive(&conn, Some(&local), &task_written_under(9, "from nobody", Some(1)));
    assert_eq!((title(&conn), count(&conn)), ("original".to_string(), 0));
    // An Editor naming a version this device never held is judged by the newest list: merged
    let (conn, local) = setup();
    arrive(&conn, Some(&local), &task_written_under(2, "from an Editor", Some(7)));
    assert_eq!(title(&conn), "from an Editor");
    // A version number that was changed after signing makes the record altered: refused whole
    let (conn, local) = setup();
    let mut altered = task_written_under(3, "swapped version", Some(1));
    for s in altered.crdt.as_mut().unwrap().fields.values_mut().flatten().filter(|s| s.ep.is_some()) {
        s.ep = Some(2);
    }
    assert!(!arrive(&conn, Some(&local), &altered));
    assert_eq!((title(&conn), count(&conn)), ("original".to_string(), 0));
}

#[test]
fn a_device_signs_the_version_of_the_list_it_holds_and_an_older_app_would_pass_it_on() {
    signing::init_for_tests();
    let mut state = RecordState::default();
    state.write("r1", "title", json!("t"), 10, None);
    state.sign_own("task", "t1", "r1", 4);
    let s = &state.fields["title"][0];
    assert_eq!(s.ep, Some(4));
    assert!(state.signatures_ok("task", "t1"));
    // Without a list the write names none, and still verifies
    let mut plain = RecordState::default();
    plain.write("r1", "title", json!("t"), 10, None);
    plain.sign_own("task", "t1", "r1", 0);
    assert!(plain.fields["title"][0].ep.is_none() && plain.signatures_ok("task", "t1"));
    // An app that does not know these fields keeps them as extras and writes them back
    let text = serde_json::to_string(&state).unwrap();
    assert_eq!(serde_json::from_str::<RecordState>(&text).unwrap(), state);
}

#[test]
fn with_review_on_other_peoples_new_writes_wait_for_the_person_and_their_own_and_known_ones_do_not() {
    let conn = workspace();
    list_with(&conn, &[]);
    let local = local_task(&conn);
    set_review(&conn, true).unwrap();
    // An Editor's write is new here: it waits, and the person (who is no Admin) may accept it
    let remote = task_written_by(2, "from a colleague");
    arrive(&conn, Some(&local), &remote);
    assert_eq!((title(&conn), count(&conn)), ("original".to_string(), 1));
    let held = list(&conn).unwrap();
    assert_eq!(held[0].reason, REVIEW_REASON);
    assert!(reviewer(&conn, held[0].id).is_ok());
    accept(&conn, "w1", held[0].id).unwrap();
    assert_eq!((title(&conn), count(&conn)), ("from a colleague".to_string(), 0));
    // The same state arriving again changes nothing and holds nothing: its writes are known now
    let local = data_sync::read_task(&conn, "t1").unwrap().unwrap();
    arrive(&conn, Some(&local), &remote);
    assert_eq!(count(&conn), 0);
    // With review off the next colleague's write merges at once
    set_review(&conn, false).unwrap();
    let mut later = task_written_by(2, "straight in");
    for s in later.crdt.as_mut().unwrap().fields.values_mut().flatten().filter(|s| s.dot.r == "replica-2") {
        s.ts += 1_000;
        s.dot.c += 5;
        s.sig = None;
        s.by = None;
    }
    arrive(&conn, Some(&local), &later);
    assert_eq!(count(&conn), 0);
}

#[test]
fn a_timed_out_members_message_is_held_once_and_an_accepted_one_joins_the_log() {
    let conn = workspace();
    list_with(&conn, &[]);
    let msg = Entry::signed_with(&key(2), "message", "general", "", "said while timed out", 1_000);
    for _ in 0..3 {
        hold_entry(&conn, &msg, 5_000).unwrap();
    }
    assert_eq!((list_entries(&conn).unwrap().len(), count(&conn)), (1, 1));
    assert!(holdable("message") && holdable("comment") && !holdable("react"));
    // Accepting takes it into the log, judged by the member's own role, and it is no longer held
    let taken = accept_entry(&conn, &msg.id, 6_000).unwrap();
    assert_eq!(taken.map(|e| e.id), Some(msg.id.clone()));
    assert_eq!(count(&conn), 0);
    assert!(chatlog::list(&conn).unwrap().iter().any(|e| e.id == msg.id));
    // One that is already in the log is not held again; a discarded one is gone
    hold_entry(&conn, &msg, 7_000).unwrap();
    assert_eq!(count(&conn), 0);
    let other = Entry::signed_with(&key(2), "message", "general", "", "unwanted", 1_100);
    hold_entry(&conn, &other, 7_000).unwrap();
    discard_entry(&conn, &other.id).unwrap();
    assert_eq!(count(&conn), 0);
}

#[test]
fn a_device_with_no_member_list_judges_nothing_and_an_unsigned_write_is_merged() {
    let conn = workspace();
    let local = local_task(&conn);
    assert!(arrive(&conn, Some(&local), &task_written_by(3, "from anyone")));
    assert_eq!(count(&conn), 0);
    // With a list, a write that carries no signature cannot be judged
    let conn = workspace();
    list_with(&conn, &[]);
    let local = local_task(&conn);
    let mut unsigned = task_written_by(3, "old version");
    for s in unsigned.crdt.as_mut().unwrap().fields.values_mut().flatten() {
        s.by = None;
        s.sig = None;
    }
    assert!(arrive(&conn, Some(&local), &unsigned));
}

#[test]
fn a_held_write_is_kept_once_listed_with_its_record_and_can_be_accepted_or_discarded() {
    let conn = workspace();
    list_with(&conn, &[5]);
    let local = local_task(&conn);
    let remote = task_written_by(5, "by the removed member");
    for _ in 0..3 {
        arrive(&conn, Some(&local), &remote);
    }
    let held = list(&conn).unwrap();
    assert_eq!(held.len(), 1, "the same write is kept once");
    assert_eq!((held[0].title.as_str(), held[0].path.as_str(), held[0].by.as_str()), ("original", "title", id(5).as_str()));
    assert!(held[0].reason.contains("removed"));
    // Accepting merges it
    accept(&conn, "w1", held[0].id).unwrap();
    assert_eq!(title(&conn), "by the removed member");
    assert_eq!(count(&conn), 0);
    // And discarding another one leaves the record alone
    let conn = workspace();
    list_with(&conn, &[5]);
    let local = local_task(&conn);
    arrive(&conn, Some(&local), &task_written_by(5, "unwanted"));
    discard(&conn, list(&conn).unwrap()[0].id).unwrap();
    assert_eq!((title(&conn), count(&conn)), ("original".to_string(), 0));
}

#[test]
fn a_new_record_whose_every_write_is_held_creates_nothing_until_accepted() {
    let conn = workspace();
    list_with(&conn, &[5]);
    let mut remote = task_written_by(5, "a task only the removed member wrote");
    // Only their write: the owner's field is not in it
    let state = remote.crdt.as_mut().unwrap();
    state.fields.get_mut("title").unwrap().retain(|s| s.dot.r == "replica-5");
    assert!(!arrive(&conn, None, &remote));
    assert!(data_sync::read_task(&conn, "t1").unwrap().is_none());
    accept(&conn, "w1", list(&conn).unwrap()[0].id).unwrap();
    assert_eq!(title(&conn), "a task only the removed member wrote");
}

#[test]
fn a_timeout_holds_the_writes_of_a_member_until_it_ends() {
    let now = crdt::now_ms();
    let conn = workspace();
    list_with(&conn, &[]);
    // The Admin times the Editor out
    let timeout = moderation::Action { action: "timeout".into(), target: id(2), target_name: "Ed".into(), until: now + 3_600_000, reason: "cool off".into(), ..Default::default() };
    let entry = Entry::signed_with(&key(4), moderation::KIND, "moderation", "", &serde_json::to_string(&timeout).unwrap(), now - 1_000);
    conn.execute("INSERT INTO log_entries (id, kind, channel, parent, author, name, ts, body, sig) VALUES (?1, ?2, ?3, '', ?4, ?5, ?6, ?7, ?8)", params![entry.id, entry.kind, entry.channel, entry.author, entry.name, entry.ts as i64, entry.body, entry.sig]).unwrap();
    let local = local_task(&conn);
    arrive(&conn, Some(&local), &task_written_by(2, "while timed out"));
    assert_eq!(title(&conn), "original");
    assert!(list(&conn).unwrap()[0].reason.contains("timed out"));
    // After it ends the same member is an Editor again
    let gate = Gate::load(&conn, now + 7_200_000);
    assert_eq!(gate.verdict(&id(2)), Verdict::Allow);
    assert!(matches!(Gate::load(&conn, now).verdict(&id(2)), Verdict::Hold(_)));
}

#[test]
fn a_ban_and_a_timeout_survive_closing_and_reopening_the_workspace() {
    let dir = std::env::temp_dir().join(format!("nexsync-ban-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.to_str().unwrap();
    let now = crdt::now_ms();
    {
        let db = WorkspaceDb::open(path).unwrap();
        db.conn.execute("INSERT INTO workspace (id, name, description, path, created_at, updated_at) VALUES ('w1', 'w', '', ?1, 't', 't')", [path]).unwrap();
        list_with(&db.conn, &[]);
        for (target, action, until) in [(2u8, "ban", 0), (3, "timeout", now + 3_600_000)] {
            let a = moderation::Action { action: action.into(), target: id(target), target_name: "x".into(), until, reason: "why".into(), ..Default::default() };
            let e = Entry::signed_with(&key(1), moderation::KIND, "moderation", "", &serde_json::to_string(&a).unwrap(), now - 1_000);
            db.conn.execute("INSERT INTO log_entries (id, kind, channel, parent, author, name, ts, body, sig) VALUES (?1, ?2, ?3, '', ?4, ?5, ?6, ?7, ?8)", params![e.id, e.kind, e.channel, e.author, e.name, e.ts as i64, e.body, e.sig]).unwrap();
        }
    }
    // A new connection to the same files, as after the app was closed and started again
    let db = WorkspaceDb::open_existing(path).unwrap();
    let gate = Gate::load(&db.conn, now);
    assert!(matches!(gate.verdict(&id(2)), Verdict::Hold(why) if why.contains("banned")));
    assert!(matches!(gate.verdict(&id(3)), Verdict::Hold(why) if why.contains("timed out")));
    let (_, state) = moderation::load(&db.conn, now);
    assert!(state.is_banned(&id(2)) && state.is_timed_out(&id(3)));
    // The timeout ends by itself; the ban does not
    let (_, later) = moderation::load(&db.conn, now + 7_200_000);
    assert!(later.is_banned(&id(2)) && !later.is_timed_out(&id(3)));
    drop(db);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn only_the_owner_and_admins_review() {
    let conn = workspace();
    list_with(&conn, &[]);
    let gate = Gate::load(&conn, crdt::now_ms());
    assert!(gate.may_review(&id(1)) && gate.may_review(&id(4)));
    assert!(!gate.may_review(&id(2)) && !gate.may_review(&id(3)) && !gate.may_review(&id(9)));
    assert!(Gate::default().may_review("anyone"));
}
