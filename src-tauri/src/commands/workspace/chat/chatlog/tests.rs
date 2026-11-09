use super::*;
use iroh::SecretKey;
use std::collections::HashMap;

fn key(n: u8) -> SecretKey {
    SecretKey::from_bytes(&[n; 32])
}

fn db() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    crate::database::schema::init_schema(&conn).unwrap();
    conn
}

/// Owner 1, Admin 2, Editor 3, Commenter 4, Viewer 5; 9 is nobody
fn roles() -> HashMap<String, Role> {
    [(1, Role::Owner), (2, Role::Admin), (3, Role::Editor), (4, Role::Commenter), (5, Role::Viewer)].into_iter().map(|(n, r)| (key(n).public().to_string(), r)).collect()
}

fn merge_as(conn: &Connection, entries: Vec<Entry>, me: u8, now: u64) -> Merged {
    let table = roles();
    let role_of = move |k: &str| table.get(k).copied();
    merge(conn, entries, &Ctx { me: &key(me).public().to_string(), now, role_of: &role_of }).unwrap()
}

#[test]
fn slow_mode_holds_an_editor_back_but_not_an_admin_and_every_stored_entry_is_dated() {
    let conn = db();
    let slow = Entry::signed_with(&key(2), "channel", "general", "", "{\"name\":\"general\",\"slowSeconds\":30}", 1_000);
    assert_eq!(merge_as(&conn, vec![slow], 1, 2_000).added.len(), 1);
    let first = Entry::signed_with(&key(3), "message", "general", "", "one", 10_000);
    let too_soon = Entry::signed_with(&key(3), "message", "general", "", "two", 20_000);
    let later = Entry::signed_with(&key(3), "message", "general", "", "three", 41_000);
    let admin_a = Entry::signed_with(&key(2), "message", "general", "", "a", 10_000);
    let admin_b = Entry::signed_with(&key(2), "message", "general", "", "b", 11_000);
    let m = merge_as(&conn, vec![first.clone(), too_soon, later.clone(), admin_a, admin_b], 1, 50_000);
    assert_eq!((m.added.len(), m.refused), (4, 1));
    let seen = seen(&conn).unwrap();
    assert!(seen.contains_key(&first.id) && seen.contains_key(&later.id));
}

#[test]
fn a_new_device_gets_the_newest_messages_of_each_channel_and_what_points_at_them() {
    let conn = db();
    set_history_limit(&conn, 10).unwrap();
    let mut all = Vec::new();
    for i in 0..15u64 {
        all.push(Entry::signed_with(&key(3), "message", "general", "", &format!("m{i}"), 1_000 + i));
    }
    all.push(Entry::signed_with(&key(3), "message", "ideas", "", "only one", 5_000));
    let old = all[0].clone();
    let edit_of_old = Entry::signed_with(&key(3), "edit", "general", &old.id, "m0 fixed", 6_000);
    let react_to_new = Entry::signed_with(&key(3), "react", "general", &all[14].id, "{\"emoji\":\"x\"}", 6_001);
    all.push(edit_of_old.clone());
    all.push(react_to_new.clone());
    assert_eq!(merge_as(&conn, all, 1, 10_000).added.len(), 18);
    let sent = missing(&conn, &HashSet::new()).unwrap();
    let messages = sent.iter().filter(|e| e.kind == "message" && e.channel == "general").count();
    assert_eq!(messages, 10);
    assert!(sent.iter().any(|e| e.channel == "ideas"));
    assert!(sent.iter().any(|e| e.id == react_to_new.id));
    assert!(!sent.iter().any(|e| e.id == edit_of_old.id), "an edit of a message that was left out stays behind");
}

#[test]
fn a_profile_is_sent_to_a_new_device_however_busy_the_workspace_has_been_since() {
    let conn = db();
    let mut all = vec![Entry::signed_with(&key(3), "profile", "profiles", "", r##"{"color":"#d22d64","image":"data:image/png;base64,AAAA"}"##, 100)];
    for i in 0..(CATCH_UP_LIMIT as u64 + 50) {
        all.push(Entry::signed_with(&key(3), "message", "general", "", &format!("m{i}"), 1_000 + i));
    }
    set_history_limit(&conn, 5_000).unwrap();
    merge_as(&conn, all, 1, 100_000);
    assert!(missing(&conn, &HashSet::new()).unwrap().iter().any(|e| e.kind == "profile"));
    assert!(list(&conn).unwrap().iter().any(|e| e.kind == "profile"));
}

#[test]
fn a_direct_message_must_name_a_member_and_its_own_conversation_and_tells_only_its_recipient() {
    use crate::commands::workspace::chat::dm;
    let conn = db();
    let (from, to) = (key(3), key(4));
    let (pf, pt) = (from.public().to_string(), to.public().to_string());
    let good = Entry::signed_with(&from, "dm", &dm::channel_of(&pf, &pt), "", &dm::body_for(&from, &pt, "private").unwrap(), 1_000);
    let wrong_channel = Entry::signed_with(&from, "dm", "general", "", &dm::body_for(&from, &pt, "private").unwrap(), 1_001);
    let stranger = key(9).public().to_string();
    let to_nobody = Entry::signed_with(&from, "dm", &dm::channel_of(&pf, &stranger), "", &dm::body_for(&from, &stranger, "private").unwrap(), 1_002);
    let no_recipient = Entry::signed_with(&from, "dm", &dm::channel_of(&pf, &pt), "", "plain words", 1_003);
    let m = merge_as(&conn, vec![good.clone(), wrong_channel, to_nobody, no_recipient], 4, 2_000);
    assert_eq!((m.added.len(), m.refused), (1, 3));
    // The recipient is told who wrote, with no words; the sender's own device is told nothing
    let inbox = inbox_list(&conn).unwrap();
    assert_eq!((inbox.len(), inbox[0].kind.as_str(), inbox[0].snippet.as_str()), (1, "dm", ""));
    let other = db();
    merge_as(&other, vec![good], 3, 2_000);
    assert!(inbox_list(&other).unwrap().is_empty());
}

#[test]
fn announcements_are_posted_by_admins_edited_by_their_author_and_acknowledged_by_anyone() {
    use crate::commands::workspace::chat::announce;
    let conn = db();
    let body = |title: &str| serde_json::json!({ "title": title, "text": "body", "level": "important" }).to_string();
    let post = |by: u8, title: &str, ts: u64| Entry::signed_with(&key(by), announce::KIND, announce::CHANNEL, "", &body(title), ts);
    let by_admin = post(2, "Release on Friday", 1_000);
    let by_editor = post(3, "Not allowed", 1_001);
    let m = merge_as(&conn, vec![by_admin.clone(), by_editor], 1, 2_000);
    assert_eq!((m.added.len(), m.refused), (1, 1));
    // A second Admin may not edit the first Admin's announcement, the Owner may, the author may
    let edit_by = |by: u8| Entry::signed_with(&key(by), announce::KIND, announce::CHANNEL, &by_admin.id, &body("Release on Monday"), 3_000);
    let owner_edit = edit_by(1);
    let author_edit = edit_by(2);
    assert_eq!(merge_as(&conn, vec![owner_edit, author_edit], 1, 4_000).added.len(), 2);
    // Anyone acknowledges, a Viewer included; a stranger and an acknowledgement of nothing do not
    let ack = |by: u8, of: &str| Entry::signed_with(&key(by), announce::ACK, announce::CHANNEL, of, "", 5_000);
    let m = merge_as(&conn, vec![ack(5, &by_admin.id), ack(3, &by_admin.id), ack(9, &by_admin.id), ack(4, "no-such-id")], 1, 6_000);
    assert_eq!((m.added.len(), m.refused), (2, 2));
    assert_eq!(announce::acks_of(&conn, &by_admin.id).unwrap().len(), 2);
    // Only an Admin withdraws it
    let end = |by: u8| Entry::signed_with(&key(by), announce::END, announce::CHANNEL, &by_admin.id, "", 7_000);
    assert_eq!(merge_as(&conn, vec![end(3), end(2)], 1, 8_000).added.len(), 1);
}

#[test]
fn an_expired_announcement_is_erased_with_what_points_at_it_and_is_not_taken_again() {
    use crate::commands::workspace::chat::announce;
    let conn = db();
    let ann = Entry::signed_with(&key(2), announce::KIND, announce::CHANNEL, "", &serde_json::json!({ "title": "Maintenance", "level": "info" }).to_string(), 1_000);
    let ack = Entry::signed_with(&key(3), announce::ACK, announce::CHANNEL, &ann.id, "", 1_500);
    let expire = Entry::signed_with(&key(2), announce::EXPIRE, announce::CHANNEL, "", &serde_json::json!({ "entity": "announcement", "id": ann.id, "at": 5_000 }).to_string(), 1_600);
    assert_eq!(merge_as(&conn, vec![ann.clone(), ack.clone(), expire], 1, 2_000).added.len(), 3);
    // Before the time, nothing is erased; after it, the announcement and its acknowledgement are gone
    assert!(announce::expired_announcements(&conn, 4_000).is_empty());
    assert!(announce::expired_announcements(&conn, 6_000).contains(&ann.id));
    assert_eq!(announce::erase_announcement(&conn, &ann.id).unwrap(), 2);
    assert!(find(&conn, &ann.id).unwrap().is_none() && find(&conn, &ack.id).unwrap().is_none());
    // A copy that arrives later, from a device that was off, is refused
    let m = merge_as(&conn, vec![ann, ack], 1, 7_000);
    assert_eq!((m.added.len(), m.refused), (0, 2));
    // Only an Admin sets an expiry
    let by_editor = Entry::signed_with(&key(3), announce::EXPIRE, announce::CHANNEL, "", &serde_json::json!({ "entity": "task", "id": "t", "at": 9_000 }).to_string(), 1_700);
    assert_eq!(merge_as(&conn, vec![by_editor], 1, 7_000).refused, 1);
}

#[test]
fn only_admins_set_the_icon_and_an_older_one_does_not_replace_a_newer_one() {
    let conn = db();
    let icon = |by: u8, ts: u64, body: &str| Entry::signed_with(&key(by), "icon", "workspace", "", body, ts);
    let rocket = r#"{"kind":"glyph","glyph":"🚀"}"#;
    let m = merge_as(&conn, vec![icon(3, 1_000, rocket), icon(2, 2_000, rocket), icon(2, 3_000, r#"{"kind":"image","data":"javascript:x"}"#), icon(2, 3_100, r#"{"kind":"none"}"#)], 1, 4_000);
    assert_eq!((m.added.len(), m.refused), (2, 2));
    // Arriving late, an older icon is not taken over the newer
    assert_eq!(merge_as(&conn, vec![icon(1, 2_500, rocket)], 1, 4_000).refused, 1);
}

#[test]
fn anyone_sets_their_own_profile_and_only_the_newest_is_kept() {
    let conn = db();
    let profile = |by: u8, ts: u64, body: &str| Entry::signed_with(&key(by), "profile", "profiles", "", body, ts);
    let m = merge_as(&conn, vec![profile(5, 1_000, r##"{"color":"#d22d64"}"##), profile(3, 1_000, r##"{"color":"#1c823e","image":"data:image/webp;base64,AAAA"}"##), profile(3, 1_500, r##"{"color":"nope"}"##), profile(9, 1_000, "{}")], 1, 2_000);
    // A Viewer's and an Editor's are taken; a bad colour and a stranger's are not
    assert_eq!((m.added.len(), m.refused), (2, 2));
    // A newer one replaces the author's older; an older one arriving late is refused
    assert_eq!(merge_as(&conn, vec![profile(3, 1_800, r##"{"color":"#5a64dc"}"##)], 1, 2_500).added.len(), 1);
    assert_eq!(merge_as(&conn, vec![profile(3, 1_200, "{}")], 1, 2_500).refused, 1);
    let kept: i64 = conn.query_row("SELECT COUNT(*) FROM log_entries WHERE kind = 'profile' AND author = ?1", [key(3).public().to_string()], |r| r.get(0)).unwrap();
    assert_eq!(kept, 1);
}

#[test]
fn a_project_status_is_per_project_and_author_and_only_the_newest_is_kept() {
    let conn = db();
    let env = |by: u8, ch: &str, ts: u64, body: &str| Entry::signed_with(&key(by), "devenv", ch, "", body, ts);
    let m = merge_as(&conn, vec![env(3, "devenv:projects/app", 1_000, r#"{"tools":[]}"#), env(3, "devenv:projects/api", 1_000, "{}"), env(3, "devrun:projects/app", 1_000, "{}"), env(3, "devenv:x", 1_000, "[1]")], 1, 2_000);
    // A run status in an environment channel and a body that is not an object are refused
    assert_eq!((m.added.len(), m.refused), (2, 2));
    assert_eq!(merge_as(&conn, vec![env(3, "devenv:projects/app", 1_500, r#"{"tools":[1]}"#)], 1, 2_000).added.len(), 1);
    assert_eq!(merge_as(&conn, vec![env(3, "devenv:projects/app", 1_200, "{}")], 1, 2_000).refused, 1);
    let kept: i64 = conn.query_row("SELECT COUNT(*) FROM log_entries WHERE kind = 'devenv' AND channel = 'devenv:projects/app'", [], |r| r.get(0)).unwrap();
    assert_eq!(kept, 1);
}

#[test]
fn a_shared_failure_is_kept_for_its_project_and_needs_an_object() {
    let conn = db();
    let repro = |by: u8, ch: &str, ts: u64, body: &str| Entry::signed_with(&key(by), "devrepro", ch, "", body, ts);
    let m = merge_as(&conn, vec![repro(3, "devrepro:projects/app", 1_000, r#"{"task":"test","code":1}"#), repro(3, "devrepro:projects/app", 2_000, r#"{"task":"test","code":2}"#), repro(3, "general", 2_100, "{}"), repro(3, "devrepro:p", 2_200, "text"), repro(5, "devrepro:p", 2_300, "{}")], 1, 3_000);
    // Both failures stay (they are a history); a wrong channel, a body that is not an object and a Viewer are refused
    assert_eq!((m.added.len(), m.refused), (2, 3));
}

#[test]
fn a_genuine_entry_from_a_member_is_stored_once_and_a_second_copy_changes_nothing() {
    let conn = db();
    let e = Entry::signed_with(&key(3), "message", "general", "", "hello", 1_000);
    assert_eq!(merge_as(&conn, vec![e.clone()], 1, 2_000).added.len(), 1);
    assert_eq!(merge_as(&conn, vec![e.clone()], 1, 2_000).added.len(), 0);
    assert_eq!(list(&conn).unwrap(), vec![e]);
}

#[test]
fn an_altered_entry_a_stranger_and_a_viewer_are_refused() {
    let conn = db();
    let mut altered = Entry::signed_with(&key(3), "message", "general", "", "hello", 1_000);
    altered.body = "something else".into();
    let stranger = Entry::signed_with(&key(9), "message", "general", "", "hi", 1_000);
    let viewer = Entry::signed_with(&key(5), "message", "general", "", "hi", 1_000);
    let m = merge_as(&conn, vec![altered, stranger, viewer], 1, 2_000);
    assert_eq!((m.added.len(), m.refused), (0, 3));
    assert!(list(&conn).unwrap().is_empty());
}

#[test]
fn a_commenter_may_post_but_only_admins_make_channels() {
    let conn = db();
    let post = Entry::signed_with(&key(4), "message", "general", "", "hi", 1_000);
    let by_commenter = Entry::signed_with(&key(4), "channel", "ideas", "", "{\"name\":\"Ideas\"}", 1_000);
    let by_admin = Entry::signed_with(&key(2), "channel", "ideas", "", "{\"name\":\"Ideas\"}", 1_000);
    let m = merge_as(&conn, vec![post, by_commenter, by_admin], 1, 2_000);
    assert_eq!((m.added.len(), m.refused), (2, 1));
}

#[test]
fn only_the_author_edits_and_only_the_author_or_an_admin_deletes() {
    let conn = db();
    let original = Entry::signed_with(&key(3), "message", "general", "", "mine", 1_000);
    merge_as(&conn, vec![original.clone()], 1, 2_000);
    let others_edit = Entry::signed_with(&key(4), "edit", "general", &original.id, "changed", 1_100);
    let own_edit = Entry::signed_with(&key(3), "edit", "general", &original.id, "fixed", 1_100);
    let others_delete = Entry::signed_with(&key(4), "delete", "general", &original.id, "", 1_200);
    let admin_delete = Entry::signed_with(&key(2), "delete", "general", &original.id, "", 1_200);
    let m = merge_as(&conn, vec![others_edit, own_edit, others_delete, admin_delete], 1, 2_000);
    assert_eq!((m.added.len(), m.refused), (2, 2));
    // And an edit of an entry that is not here cannot be checked, so it waits
    let orphan = Entry::signed_with(&key(3), "edit", "general", "nope", "x", 1_300);
    assert_eq!(merge_as(&conn, vec![orphan], 1, 2_000).refused, 1);
}

#[test]
fn an_entry_stamped_more_than_a_day_ahead_is_refused() {
    let conn = db();
    let far = Entry::signed_with(&key(3), "message", "general", "", "from the future", 10 * MAX_AHEAD_MS);
    assert_eq!(merge_as(&conn, vec![far], 1, 1_000).refused, 1);
}

#[test]
fn a_mention_and_a_reply_reach_the_inbox_of_the_one_they_name_and_nobody_else() {
    let conn = db();
    let me = key(1).public().to_string();
    let mine = Entry::signed_with(&key(1), "message", "general", "", "my question", 1_000);
    let mention = Entry::signed_with(&key(3), "message", "general", "", &format!("look at this {}", mention_of(&me)), 1_100);
    let reply = Entry::signed_with(&key(4), "message", "general", &mine.id, "an answer", 1_200);
    let plain = Entry::signed_with(&key(4), "message", "general", "", "unrelated", 1_300);
    merge_as(&conn, vec![mine, mention, reply, plain], 1, 2_000);
    let items = inbox_list(&conn).unwrap();
    let kinds: Vec<&str> = items.iter().map(|i| i.kind.as_str()).collect();
    assert_eq!(kinds, vec!["reply", "mention"], "newest first");
    assert!(items[1].snippet.contains("@") && !items[1].snippet.contains("<@"));
    // Someone else's device has neither
    let other = db();
    merge_as(&other, list(&conn).unwrap(), 5, 2_000);
    assert!(inbox_list(&other).unwrap().is_empty());
}

#[test]
fn catching_up_sends_only_what_the_other_side_lacks_and_two_sides_end_equal() {
    let (a, b) = (db(), db());
    let from_a: Vec<Entry> = (0..5).map(|i| Entry::signed_with(&key(3), "message", "general", "", &format!("a{i}"), 1_000 + i)).collect();
    let from_b: Vec<Entry> = (0..4).map(|i| Entry::signed_with(&key(4), "message", "general", "", &format!("b{i}"), 1_100 + i)).collect();
    merge_as(&a, from_a, 1, 5_000);
    merge_as(&b, from_b, 1, 5_000);
    let b_has: HashSet<String> = have(&b).unwrap().into_iter().collect();
    let a_has: HashSet<String> = have(&a).unwrap().into_iter().collect();
    let to_b = missing(&a, &b_has).unwrap();
    let to_a = missing(&b, &a_has).unwrap();
    assert_eq!((to_b.len(), to_a.len()), (5, 4));
    merge_as(&b, to_b, 1, 5_000);
    merge_as(&a, to_a, 1, 5_000);
    assert_eq!(list(&a).unwrap(), list(&b).unwrap());
    // Nothing is missing any more
    let b_has: HashSet<String> = have(&b).unwrap().into_iter().collect();
    assert!(missing(&a, &b_has).unwrap().is_empty());
}

#[test]
fn read_markers_only_move_forward_and_the_inbox_marks_and_clears() {
    let conn = db();
    mark_read(&conn, "general", 500).unwrap();
    mark_read(&conn, "general", 300).unwrap();
    set_muted(&conn, "general", true).unwrap();
    let state = read_states(&conn).unwrap();
    assert_eq!(state, vec![ReadState { channel: "general".into(), last_ts: 500, muted: true }]);
    inbox_add(&conn, "notice", "n1", "", "", "Bo joined", 10).unwrap();
    inbox_add(&conn, "notice", "n1", "", "", "Bo joined", 10).unwrap();
    assert_eq!(inbox_list(&conn).unwrap().len(), 1, "the same notice is kept once");
    inbox_mark_read(&conn, &[]).unwrap();
    assert!(inbox_list(&conn).unwrap().iter().all(|i| i.read));
    inbox_clear(&conn).unwrap();
    assert!(inbox_list(&conn).unwrap().is_empty());
}

#[test]
fn erasing_a_thread_removes_its_entries_and_their_inbox_lines() {
    let conn = db();
    let me = key(1).public().to_string();
    let on_doc = Entry::signed_with(&key(3), "comment", "doc:notes/secret.md", "", &format!("{{\"text\":\"see {}\"}}", mention_of(&me)), 1_000);
    let elsewhere = Entry::signed_with(&key(3), "message", "general", "", "keep", 1_001);
    merge_as(&conn, vec![on_doc, elsewhere], 1, 2_000);
    assert_eq!(inbox_list(&conn).unwrap().len(), 1);
    assert_eq!(erase_channel(&conn, "doc:notes/secret.md").unwrap(), 1);
    assert!(inbox_list(&conn).unwrap().is_empty());
    assert_eq!(list(&conn).unwrap().len(), 1);
}

#[test]
fn posting_signs_with_the_device_key_and_the_result_checks_out() {
    signing::init_for_tests();
    let conn = db();
    let me = signing::device_key().unwrap();
    let table: HashMap<String, Role> = [(me.clone(), Role::Editor)].into_iter().collect();
    let role_of = move |k: &str| table.get(k).copied();
    let e = post(&conn, "message", "general", "", "hello there", "Yash", 5_000, &role_of).unwrap();
    assert!(e.signature_ok());
    assert_eq!(e.author, me);
    assert_eq!(list(&conn).unwrap().len(), 1);
    // A role that may not post is told so
    let viewer: HashMap<String, Role> = [(me, Role::Viewer)].into_iter().collect();
    let role_of = move |k: &str| viewer.get(k).copied();
    assert!(post(&conn, "message", "general", "", "no", "Yash", 5_000, &role_of).is_err());
}

#[test]
fn a_message_written_after_one_was_read_is_placed_after_it_even_when_this_clock_is_behind() {
    signing::init_for_tests();
    let conn = db();
    let me = signing::device_key().unwrap();
    let table: HashMap<String, Role> = [(me.clone(), Role::Editor)].into_iter().collect();
    let role_of = move |k: &str| table.get(k).copied();
    // A friend's message, from a clock a minute ahead of ours, has been received
    let friend = Entry { id: "friend-1".into(), kind: "message".into(), channel: "general".into(), parent: String::new(), author: "friend".into(), name: "User".into(), ts: 100_000 + 60_000, body: "Test".into(), sig: String::new() };
    store(&conn, &friend).unwrap();
    let mine = post(&conn, "message", "general", "", "Test", "Yash", 100_000, &role_of).unwrap();
    assert!(mine.ts > friend.ts, "{} should be after {}", mine.ts, friend.ts);
    // A clock that is ahead is not held back: the time is the time
    let later = post(&conn, "message", "general", "", "Later", "Yash", 500_000, &role_of).unwrap();
    assert_eq!(later.ts, 500_000);
    // Another channel is not affected by this one
    let other = post(&conn, "message", "random", "", "Hi", "Yash", 100_000, &role_of).unwrap();
    assert_eq!(other.ts, 100_000);
}
