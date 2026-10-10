//! What the first release (0.9.0) wrote, kept as files, and the version-skew matrix of RESEARCH.md §8e.
//!
//! The files in `src-tauri/fixtures/v0.9.0/` are what a 0.9.0 device sends and stores: the handshake, a task's merge
//! state with a conflict in it, the signed member list, and a whole workspace database. Every later build must still
//! read them. If one of these tests fails, the change broke compatibility with the oldest supported version: fix the
//! change, do not regenerate the files. `write_fixtures` exists only to make them once, at a release.

use std::path::PathBuf;

use serde_json::json;

use super::{membership, wire};
use crate::commands::workspace::crdt::RecordState;
use crate::database::WorkspaceDb;

fn dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("fixtures").join("v0.9.0")
}

fn owner() -> iroh::SecretKey {
    iroh::SecretKey::from_bytes(&[7u8; 32])
}

fn member_id() -> String {
    iroh::SecretKey::from_bytes(&[8u8; 32]).public().to_string()
}

fn temp(label: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("nexsync-compat-{label}-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&d).unwrap();
    d
}

/// A task as two devices edited it while apart: both changed the title, and one added a tag
fn two_edits() -> RecordState {
    let mut base = std::collections::BTreeMap::new();
    base.insert("title".to_string(), json!("Ship"));
    base.insert("status".to_string(), json!("todo"));
    base.insert("tags/urgent".to_string(), json!(true));
    let start = RecordState::from_legacy(base, 1_000);
    let mut a = start.clone();
    a.write("dev-a", "title", json!("Ship it"), 2_000, Some("Ada"));
    let mut b = start.clone();
    b.write("dev-b", "title", json!("Release"), 2_001, Some("Bo"));
    b.write("dev-b", "tags/late", json!(true), 2_002, None);
    a.merge(&b)
}

fn the_list() -> membership::Membership {
    membership::next(None, &owner(), "ws-fixture", "Fixture", vec![(member_id(), "Editor".to_string())]).unwrap().unwrap()
}

#[test]
#[ignore = "writes the frozen fixtures; run once at a release, never to make a failing test pass"]
fn write_fixtures() {
    let out = dir();
    std::fs::create_dir_all(&out).unwrap();
    let hello = wire::Hello { v: wire::PROTOCOL_VERSION, secret: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA".into(), name: "Ada".into(), probe: false, versions: Some(wire::Versions::ours()) };
    std::fs::write(out.join("hello.json"), serde_json::to_string_pretty(&hello).unwrap()).unwrap();
    let welcome = wire::HandshakeReply::Welcome {
        v: wire::PROTOCOL_VERSION,
        host_name: "Host".into(),
        role: "Editor".into(),
        workspace_id: "ws-fixture".into(),
        workspace_name: "Fixture".into(),
        versions: Some(wire::Versions::ours()),
    };
    std::fs::write(out.join("welcome.json"), serde_json::to_string_pretty(&welcome).unwrap()).unwrap();
    std::fs::write(out.join("record_state.json"), serde_json::to_string_pretty(&two_edits()).unwrap()).unwrap();
    let list = the_list();
    std::fs::write(out.join("member_list.json"), serde_json::to_string_pretty(&list).unwrap()).unwrap();

    let ws = temp("make-db");
    let db = WorkspaceDb::open(ws.to_str().unwrap()).unwrap();
    membership::store(ws.to_str().unwrap(), &list).unwrap();
    let file = out.join("workspace.db");
    let _ = std::fs::remove_file(&file);
    db.conn.execute("VACUUM INTO ?1", [file.to_string_lossy()]).unwrap();
    println!("fixtures written to {} (database version {})", out.display(), crate::database::schema::schema_version());
}

fn read(name: &str) -> String {
    std::fs::read_to_string(dir().join(name)).unwrap_or_else(|e| panic!("missing fixture {name}: {e}"))
}

#[test]
fn what_the_first_release_wrote_is_still_read() {
    // The handshake in both directions
    let hello: wire::Hello = serde_json::from_str(&read("hello.json")).unwrap();
    assert_eq!(wire::check_versions(hello.versions.as_ref()), Ok(wire::Skew::Same));
    let welcome: wire::HandshakeReply = serde_json::from_str(&read("welcome.json")).unwrap();
    assert!(matches!(welcome, wire::HandshakeReply::Welcome { ref workspace_id, .. } if workspace_id == "ws-fixture"));

    // A task's merge state, with the conflict still in it
    let state: RecordState = serde_json::from_str(&read("record_state.json")).unwrap();
    assert_eq!(state.resolved().get("title"), Some(&json!("Release")));
    assert_eq!(state.conflicts().len(), 1, "the conflict on the title was lost");
    assert_eq!(state.resolved().get("tags/late"), Some(&json!(true)));
    assert_eq!(state, two_edits(), "the state this build makes from the same edits no longer matches what 0.9.0 wrote");

    // The signed member list still verifies
    let list: membership::Membership = serde_json::from_str(&read("member_list.json")).unwrap();
    list.verify().unwrap();
    assert_eq!(list.role_of(&member_id()), Some("Editor"));

    // A whole workspace database opens, needs no migration, and still holds the list
    let ws = temp("open-db");
    std::fs::create_dir_all(ws.join(".nexsync")).unwrap();
    std::fs::copy(dir().join("workspace.db"), ws.join(".nexsync").join("nexsync.db")).unwrap();
    let db = WorkspaceDb::open_existing(ws.to_str().unwrap()).unwrap();
    drop(db);
    assert_eq!(membership::load(ws.to_str().unwrap()), Some(list));
    let copies = std::fs::read_dir(ws.join(".nexsync")).unwrap().flatten().filter(|e| e.file_name().to_string_lossy().starts_with("before-migration")).count();
    assert_eq!(copies, 0, "the fixture needed a migration, so the schema changed without a new fixture being planned for");
}

/// The skew matrix: this build against what 0.9.0 wrote, against a build one format ahead, and against a device too old
/// to merge with. Prints the table used in RESEARCH.md §8e and fails if any cell is not what the design says.
#[test]
fn the_skew_matrix() {
    let mut rows: Vec<[String; 5]> = Vec::new();
    let cell = |pair: &str, linked: &str, refused: &str, lost: usize, unreadable: usize| [pair.to_string(), linked.to_string(), refused.to_string(), lost.to_string(), unreadable.to_string()];

    // ── this build with the first release ──
    let first: RecordState = serde_json::from_str(&read("record_state.json")).unwrap();
    let mut mine = first.clone();
    mine.write("dev-now", "status", json!("done"), 3_000, None);
    let merged = first.merge(&mine);
    let (was, now) = (first.resolved(), merged.resolved());
    let lost = was.iter().filter(|(p, v)| p.as_str() != "status" && now.get(*p) != Some(*v)).count();
    assert_eq!(merged.conflicts().len(), 1, "the conflict on the title did not survive the merge");
    assert_eq!(wire::check_versions(Some(&wire::Versions { app: "0.9.0".into(), record: 1, list: 1 })), Ok(wire::Skew::Same));
    rows.push(cell("this build and 0.9.0", "linked", "-", lost, 0));

    // ── this build with a build one format ahead: it adds fields and a path ──
    let future_text = r#"{"vv":{"n":2},"schema":2,"fields":{
        "title":[{"dot":{"r":"n","c":1},"ts":5,"value":"ship","style":"bold"}],
        "emoji":[{"dot":{"r":"n","c":2},"ts":6,"value":"party","shape":"star"}]}}"#;
    let mut future: RecordState = serde_json::from_str(future_text).unwrap();
    let extras_before = 3; // schema, style, shape
    let mut desired = future.resolved();
    desired.remove("emoji");
    desired.insert("title".into(), json!("ship it"));
    future.diff_write("dev-now", &desired, 10, None);
    let out = serde_json::to_value(&future).unwrap();
    let kept = [out.get("schema").is_some(), out["fields"]["emoji"][0].get("shape").is_some(), out["fields"].get("emoji").is_some()].iter().filter(|k| **k).count();
    let ahead = wire::Versions { app: "2.0.0".into(), record: wire::RECORD_FORMAT + 1, list: wire::LIST_FORMAT };
    assert_eq!(wire::check_versions(Some(&ahead)), Ok(wire::Skew::TheyAreNewer));
    rows.push(cell("this build and a build one format ahead", "linked, told to update", "-", extras_before - kept, 0));

    // ── a workspace migrated by a newer build ──
    let ws = temp("future-db");
    std::fs::create_dir_all(ws.join(".nexsync")).unwrap();
    std::fs::copy(dir().join("workspace.db"), ws.join(".nexsync").join("nexsync.db")).unwrap();
    {
        let conn = rusqlite::Connection::open(ws.join(".nexsync").join("nexsync.db")).unwrap();
        conn.execute("INSERT INTO schema_migrations (version, description) VALUES (?1, 'future')", [crate::database::schema::schema_version() + 1]).unwrap();
    }
    let err = WorkspaceDb::open_existing(ws.to_str().unwrap()).err().expect("a newer workspace was opened");
    assert!(err.contains("newer version of Nexsync"), "{err}");
    rows.push(cell("this build opening a newer workspace", "-", "yes, with the reason", 0, 0));

    // ── a device whose record format is older than any this build merges with ──
    let old = wire::Versions { app: "0.1.0".into(), record: wire::MIN_RECORD_FORMAT - 1, list: 1 };
    let why = wire::check_versions(Some(&old)).unwrap_err();
    assert!(why.contains("record format 0"), "{why}");
    rows.push(cell("this build and a device older than the oldest format", "-", "yes, naming the format", 0, 0));

    println!("\n| pair | link | refused | data lost | unreadable |\n|---|---|---|---:|---:|");
    for r in &rows {
        println!("| {} | {} | {} | {} | {} |", r[0], r[1], r[2], r[3], r[4]);
    }
    assert!(rows.iter().all(|r| r[3] == "0" && r[4] == "0"), "a cell lost or could not read data");
}
