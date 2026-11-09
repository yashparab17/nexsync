use super::*;
use std::path::PathBuf;

struct TestNode {
    node: Arc<Node>,
    events: mpsc::UnboundedReceiver<(&'static str, serde_json::Value)>,
    dir: PathBuf,
}

impl Drop for TestNode {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs network access for Iroh relays and address lookup"]
async fn test_a_member_is_found_by_its_key_alone_and_an_absent_one_is_not() {
    // No host, no ticket, no invite: two devices that know only each other's key
    let a = start_test_node("probe-a").await;
    let b = start_test_node("probe-b").await;
    // A device publishes where it can be found when it starts, so the first dials may come too early; note how long
    let began = std::time::Instant::now();
    let mut tries = 0;
    let found = loop {
        tries += 1;
        let probe = a.node.probe_member(&b.node.self_id()).await.unwrap();
        println!("after {} ms, try {tries}: {probe:?}", began.elapsed().as_millis());
        if probe.reachable || began.elapsed() > Duration::from_secs(60) {
            break probe;
        }
        tokio::time::sleep(Duration::from_secs(2)).await;
    };
    assert!(found.reachable, "{found:?}");
    assert!(found.error.is_none());

    // A key that no device is running: it must fail by itself, and say so, instead of hanging
    let nobody = SecretKey::generate().public().to_string();
    let gone = a.node.probe_member(&nobody).await.unwrap();
    println!("probe of an absent device: {gone:?}");
    assert!(!gone.reachable);
    assert_eq!(gone.path, "none");
    assert!(gone.error.is_some());
    assert!(a.node.probe_member(&a.node.self_id()).await.is_err());
}

async fn eventually(wait: Duration, mut ok: impl FnMut() -> bool) -> bool {
    let end = std::time::Instant::now() + wait;
    while std::time::Instant::now() < end {
        if ok() {
            return true;
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
    ok()
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs network access for Iroh relays and address lookup"]
async fn test_members_link_up_without_the_host_and_a_removed_one_is_sent_away() {
    let host = start_test_node("hl-host").await;
    let a = start_test_node("hl-a").await;
    let mut b = start_test_node("hl-b").await;
    let invite = host.node.create_invite("Editor".into(), "ws".into(), "Demo".into(), "Host".into()).await.unwrap();
    let joined_a = a.node.join(&invite.ticket, "A").await.unwrap();
    b.node.join(&invite.ticket, "B").await.unwrap();
    let (a_id, b_id) = (a.node.self_id(), b.node.self_id());
    let linked = |n: &Arc<Node>, other: &str| n.peers().iter().any(|p| p.id == other);

    // The host signs the first list, and both guests take it
    let both = vec![(a_id.clone(), "Editor".to_string()), (b_id.clone(), "Editor".to_string())];
    host.node.set_known_members("ws".into(), "Demo".into(), "Host".into(), both);
    assert!(eventually(Duration::from_secs(20), || a.node.membership_epoch() == Some(1) && b.node.membership_epoch() == Some(1)).await, "the guests did not get the signed list");

    // The host goes away: nobody is connected to it and nobody holds a ticket to it. The members must find each other.
    a.node.disconnect_all();
    b.node.disconnect_all();
    assert!(!linked(&a.node, &b_id));
    let began = std::time::Instant::now();
    assert!(
        eventually(Duration::from_secs(90), || linked(&a.node, &b_id) && linked(&b.node, &a_id)).await,
        "the members never linked up without the host"
    );
    println!("members linked without the host after {} ms", began.elapsed().as_millis());

    // What one says reaches the other, named by its key
    a.node.send(None, &serde_json::json!({ "kind": "PRESENCE", "timestamp": 1, "payload": "{\"page\":\"notes\"}" })).await.unwrap();
    let got = next_of_kind(&mut b, "PRESENCE", Duration::from_secs(10)).await.expect("the message did not arrive over the member link");
    assert_eq!(got["message"]["authorId"].as_str(), Some(a_id.as_str()));

    // While they are apart the owner removes B. A hears about it when it next meets the host, and drops B at once
    host.node.set_known_members("ws".into(), "Demo".into(), "Host".into(), vec![(a_id.clone(), "Editor".to_string())]);
    a.node.join(&joined_a.rejoin_ticket, "A").await.unwrap();
    assert!(eventually(Duration::from_secs(20), || a.node.membership_epoch() == Some(2) && !linked(&a.node, &b_id)).await, "A kept the removed member");

    // B still holds the old list, but A no longer lets it in
    tokio::time::sleep(Duration::from_secs(25)).await;
    assert!(!linked(&a.node, &b_id), "the removed member got back in through a stale list");
}

#[test]
fn test_only_the_owners_device_passes_guests_messages_on() {
    // The host relays what a guest sends, but never what the host itself sent
    assert!(should_relay(false, true, false, KIND_DATA_CHANGE));
    assert!(!should_relay(true, true, false, KIND_DATA_CHANGE));
    // A member that is not the owner can look like a host (it has no host of its own to be connected to right now)
    // but must not relay, or its receivers would credit it with what others wrote
    assert!(!should_relay(false, true, true, KIND_DATA_CHANGE));
    assert!(!should_relay(false, false, false, KIND_DATA_CHANGE));
    // And only the kinds that are meant to be passed on
    assert!(!should_relay(false, true, false, KIND_MEMBERS_UPDATE));
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "starts a network endpoint"]
async fn test_a_member_is_not_let_in_by_key_until_this_device_has_looked_for_the_others() {
    let me = start_test_node("gate").await;
    let owner = iroh::SecretKey::from_bytes(&[7u8; 32]);
    let member = iroh::SecretKey::from_bytes(&[8u8; 32]);
    let list = membership::next(None, &owner, "ws", "Demo", vec![(member.public().to_string(), "Editor".to_string())]).unwrap().unwrap();
    let _db = crate::database::WorkspaceDb::open(me.dir.to_str().unwrap()).unwrap();
    membership::store(me.dir.to_str().unwrap(), &list).unwrap();
    me.node.reload_membership();

    // The list is genuine, fresh and names the member, yet this device has not checked it against anyone yet
    assert!(me.node.check_known_member(&member.public()).is_none(), "let a member in before looking for the others");
    me.node.lock().caught_up = true;
    assert!(me.node.check_known_member(&member.public()).is_some(), "turned a member away after looking for the others");
    // Loading a different list starts the check over
    me.node.reload_membership();
    assert!(me.node.check_known_member(&member.public()).is_none());
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs network access for Iroh relays and address lookup"]
async fn test_a_device_that_missed_a_removal_learns_of_it_by_asking_before_it_lets_anyone_in() {
    let host = start_test_node("probe-host").await;
    let stale = start_test_node("probe-stale").await;
    let _dbs = [
        crate::database::WorkspaceDb::open(host.dir.to_str().unwrap()).unwrap(),
        crate::database::WorkspaceDb::open(stale.dir.to_str().unwrap()).unwrap(),
    ];
    let (stale_id, removed) = (stale.node.self_id(), iroh::SecretKey::generate().public());
    let both = vec![(stale_id.clone(), "Editor".to_string()), (removed.to_string(), "Editor".to_string())];
    host.node.set_known_members("ws".into(), "Demo".into(), "Host".into(), both);
    // The stale device holds the first version, as it would after being offline when the owner removes a member
    membership::store(stale.dir.to_str().unwrap(), &host.node.lock().membership.clone().unwrap()).unwrap();
    stale.node.reload_membership();
    host.node.set_known_members("ws".into(), "Demo".into(), "Host".into(), vec![(stale_id, "Editor".to_string())]);
    assert_eq!(stale.node.membership_epoch(), Some(1));

    // Until it has asked, the stale device would let the removed member in; once the owner answers, it will not
    assert!(stale.node.check_known_member(&removed).is_none(), "gate is shut before the first look");
    let began = std::time::Instant::now();
    let mut attempts = 0;
    while stale.node.membership_epoch() != Some(2) && began.elapsed() < Duration::from_secs(60) {
        attempts += 1;
        stale.node.look_for_the_others().await;
        tokio::time::sleep(Duration::from_secs(2)).await;
    }
    println!("stale device learned of the removal by asking after {} ms and {attempts} attempt(s)", began.elapsed().as_millis());
    assert_eq!(stale.node.membership_epoch(), Some(2), "the device never learned of the removal");
    assert!(stale.node.lock().caught_up);
    assert!(stale.node.check_known_member(&removed).is_none(), "the removed member was let in after the look");
    assert!(stale.node.lock().peers.is_empty(), "asking must not leave a link behind");
}

/// One trial of the removal race. The owner has removed a member; a device that was off holds the older list; the
/// removed member's client is hostile and dials that device again and again from the moment the trial starts.
/// Returns whether the removed member was ever let in, and the epoch the stale device ended with.
async fn removal_race(with_probe: bool) -> (bool, Option<u64>, u128) {
    let host = start_test_node("race-host").await;
    let stale = start_test_node("race-stale").await;
    let hostile = start_test_node("race-removed").await;
    let _dbs = [host.dir.clone(), stale.dir.clone(), hostile.dir.clone()]
        .map(|d| crate::database::WorkspaceDb::open(d.to_str().unwrap()).unwrap());
    let (stale_id, removed_id) = (stale.node.self_id(), hostile.node.self_id());
    let both = vec![(stale_id.clone(), "Editor".to_string()), (removed_id.clone(), "Editor".to_string())];
    host.node.set_known_members("ws".into(), "Demo".into(), "Host".into(), both);
    let old = host.node.lock().membership.clone().unwrap();
    for node in [&stale, &hostile] {
        membership::store(node.dir.to_str().unwrap(), &old).unwrap();
        node.node.reload_membership();
    }
    host.node.set_known_members("ws".into(), "Demo".into(), "Host".into(), vec![(stale_id.clone(), "Editor".to_string())]);
    // Without the probe the stale device behaves as it did before: it trusts its list at once
    stale.node.lock().caught_up = !with_probe;
    let target = stale.node.endpoint.id();
    let began = std::time::Instant::now();
    let mut let_in = false;
    while began.elapsed() < Duration::from_secs(40) && !let_in {
        let_in = hostile.node.try_dial_member(target).await.is_ok() && stale.node.lock().peers.contains_key(&hostile.node.endpoint.id());
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
    (let_in, stale.node.membership_epoch(), began.elapsed().as_millis())
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs network access; takes about ten minutes; prints the numbers used in RESEARCH.md"]
async fn measure_the_removal_race_with_and_without_the_probe() {
    let trials = 10;
    for with_probe in [false, true] {
        let (mut in_count, mut times, mut epochs) = (0, Vec::new(), Vec::new());
        for _ in 0..trials {
            let (let_in, epoch, ms) = removal_race(with_probe).await;
            in_count += usize::from(let_in);
            times.push(ms);
            epochs.push(epoch);
        }
        times.sort_unstable();
        println!(
            "RACE probe={with_probe}: removed member let in {in_count}/{trials}; stale device ended on epoch 2 in {}/{trials}; median time {} ms",
            epochs.iter().filter(|e| **e == Some(2)).count(),
            times[times.len() / 2]
        );
    }
}

#[test]
fn test_identity_key_is_stable_across_loads() {
    let path = std::env::temp_dir().join(format!("nexsync_identity_{}", uuid::Uuid::new_v4())).join("id.key");
    let first = load_or_create_identity(&path).unwrap();
    let second = load_or_create_identity(&path).unwrap();
    assert_eq!(first.public(), second.public());
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

async fn start_test_node(label: &str) -> TestNode {
    let dir = std::env::temp_dir().join(format!("nexsync_p2p_{label}_{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(dir.join("notes")).unwrap();
    let (tx, events) = mpsc::unbounded_channel();
    let sink: EventSink = Arc::new(move |event, payload| {
        let _ = tx.send((event, payload));
    });
    let workspace: SharedWorkspace = Arc::new(Mutex::new(Some(dir.to_string_lossy().into_owned())));
    let node = Node::start(sink, workspace, None, None).await.unwrap();
    TestNode { node, events, dir }
}

async fn next_event(
    events: &mut mpsc::UnboundedReceiver<(&'static str, serde_json::Value)>,
    name: &str,
) -> serde_json::Value {
    tokio::time::timeout(Duration::from_secs(60), async {
        loop {
            let (event, payload) = events.recv().await.expect("event channel closed");
            if event == name {
                return payload;
            }
        }
    })
    .await
    .unwrap_or_else(|_| panic!("timed out waiting for {name}"))
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs network access for Iroh relays and address lookup"]
async fn test_invite_limits_single_use_expiry_and_removed_guests() {
    let mut host = start_test_node("lim-host").await;
    let first = start_test_node("lim-first").await;
    let second = start_test_node("lim-second").await;
    let make = |opts: InviteOptions| host.node.create_invite_with("Editor".into(), "ws".into(), "Demo".into(), "Host".into(), opts);

    // One use: the first guest gets in, the next is turned away
    let once = make(InviteOptions { expires_in_secs: None, single_use: true }).await.unwrap();
    let joined = first.node.join(&once.ticket, "First").await.unwrap();
    let err = second.node.join(&once.ticket, "Second").await.unwrap_err();
    assert!(err.contains("isn't accepting"), "unexpected error: {err}");

    // Expiry: a short-lived invite stops working on time
    let brief = make(InviteOptions { expires_in_secs: Some(1), single_use: false }).await.unwrap();
    assert!(brief.expires_at.is_some());
    tokio::time::sleep(Duration::from_millis(1300)).await;
    let err = second.node.join(&brief.ticket, "Second").await.unwrap_err();
    assert!(err.contains("expired"), "unexpected error: {err}");
    assert!(host.node.create_invite_with("Editor".into(), "ws".into(), "Demo".into(), "Host".into(), InviteOptions { expires_in_secs: Some(0), single_use: false }).await.is_err());

    // A removed guest cannot come back with the invite it used, but can with a new one
    let open = make(InviteOptions::default()).await.unwrap();
    let rejoined = first.node.join(&open.ticket, "First").await.unwrap();
    let guest_id = next_event(&mut host.events, EVENT_PEER_JOINED).await["id"].as_str().unwrap().to_string();
    host.node.block_device(&guest_id).unwrap();
    let _ = joined;
    let err = first.node.join(&open.ticket, "First").await.unwrap_err();
    assert!(err.contains("removed you"), "unexpected error: {err}");
    let fresh = make(InviteOptions::default()).await.unwrap();
    first.node.join(&fresh.ticket, "First").await.unwrap();
    let _ = rejoined;
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs network access for Iroh relays and address lookup"]
async fn test_a_known_member_comes_back_without_an_invite_and_nobody_else_can() {
    let mut host = start_test_node("km-host").await;
    let guest = start_test_node("km-guest").await;
    let stranger = start_test_node("km-stranger").await;

    let invite = host.node.create_invite("Editor".into(), "ws".into(), "Demo".into(), "Host".into()).await.unwrap();
    let joined = guest.node.join(&invite.ticket, "Guesty").await.unwrap();
    let guest_id = next_event(&mut host.events, EVENT_PEER_JOINED).await["id"].as_str().unwrap().to_string();
    assert!(!joined.rejoin_ticket.is_empty() && joined.rejoin_ticket != invite.ticket, "the kept address must not carry the invite secret");

    // The invite is gone and the guest left. Nothing is known about the guest yet, so it is turned away.
    host.node.revoke_invite();
    guest.node.disconnect(&joined.peer_id).unwrap();
    let err = guest.node.join(&joined.rejoin_ticket, "Guesty").await.unwrap_err();
    assert!(err.contains("isn't accepting"), "unexpected error: {err}");

    // Once the member list names the device, it comes back with its role and no invite
    host.node.set_known_members("ws".into(), "Demo".into(), "Host".into(), vec![(guest_id.clone(), "Editor".into())]);
    let back = guest.node.join(&joined.rejoin_ticket, "Guesty").await.unwrap();
    assert_eq!((back.role.as_str(), back.workspace_id.as_str()), ("Editor", "ws"));

    // A device that is not on the list cannot, even with the same address
    let err = stranger.node.join(&joined.rejoin_ticket, "Stranger").await.unwrap_err();
    assert!(err.contains("isn't accepting"), "unexpected error: {err}");

    // A removed member is refused at once, and so is one that is no longer on the list
    host.node.block_device(&guest_id).unwrap();
    let err = guest.node.join(&joined.rejoin_ticket, "Guesty").await.unwrap_err();
    assert!(err.contains("removed you"), "unexpected error: {err}");
    host.node.set_known_members("ws".into(), "Demo".into(), "Host".into(), vec![]);
    assert!(guest.node.join(&joined.rejoin_ticket, "Guesty").await.is_err());
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs network access for Iroh relays and address lookup"]
async fn test_guest_reconnects_after_the_link_drops() {
    let mut host = start_test_node("rc-host").await;
    let mut guest = start_test_node("rc-guest").await;
    let invite = host
        .node
        .create_invite("Editor".into(), "ws".into(), "Demo".into(), "Host".into())
        .await
        .unwrap();
    let joined = guest.node.join(&invite.ticket, "Guesty").await.unwrap();
    let guest_id = next_event(&mut host.events, EVENT_PEER_JOINED).await["id"].as_str().unwrap().to_string();

    // The host drops the link without the guest asking, so the guest re-dials on its own.
    host.node.disconnect(&guest_id).unwrap();
    next_event(&mut guest.events, EVENT_RECONNECTING).await;
    next_event(&mut host.events, EVENT_PEER_JOINED).await;

    // Leaving on purpose must not trigger another reconnect.
    while guest.events.try_recv().is_ok() {}
    guest.node.disconnect(&joined.peer_id).unwrap();
    let retried = tokio::time::timeout(Duration::from_secs(5), next_event(&mut guest.events, EVENT_RECONNECTING)).await;
    assert!(retried.is_err(), "a deliberate disconnect should not reconnect");
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs network access for Iroh relays and address lookup"]
async fn test_interrupted_download_resumes_only_for_the_same_file_version() {
    let host = start_test_node("rs-host").await;
    let mut guest = start_test_node("rs-guest").await;
    // No open workspace, so the guest ignores the host's connect-time catch-up and only fetches by hand.
    *guest.node.workspace.lock().unwrap() = None;
    let data: Vec<u8> = (0..1_000_000u32).map(|i| (i % 251) as u8).collect();
    let source = host.dir.join("notes").join("big.bin");
    std::fs::write(&source, &data).unwrap();
    let version = files::version_of(&std::fs::metadata(&source).unwrap());

    let invite = host
        .node
        .create_invite("Editor".into(), "ws".into(), "Demo".into(), "Host".into())
        .await
        .unwrap();
    let joined = guest.node.join(&invite.ticket, "Guesty").await.unwrap();
    let guest_ws = guest.dir.to_string_lossy().into_owned();
    let target = guest.dir.join("notes").join("big.bin");
    let part = |v: u64| guest.dir.join("notes").join(format!(".big.bin.{v}.nexsync-part"));

    // A partial from this exact version continues where it stopped.
    std::fs::write(part(version), &data[..300_000]).unwrap();
    files::fetch(&guest.node, &joined.peer_id, &guest_ws, "notes/big.bin").await.unwrap();
    assert_eq!(std::fs::read(&target).unwrap(), data);
    let first = next_event(&mut guest.events, files::EVENT_FILE_PROGRESS).await;
    assert_eq!(first["receivedBytes"], 300_000);
    assert!(!part(version).exists());

    // A partial from a different version is thrown away and the download starts over.
    std::fs::remove_file(&target).unwrap();
    while guest.events.try_recv().is_ok() {}
    std::fs::write(part(version + 1), vec![9u8; 300_000]).unwrap();
    files::fetch(&guest.node, &joined.peer_id, &guest_ws, "notes/big.bin").await.unwrap();
    assert_eq!(std::fs::read(&target).unwrap(), data);
    let first = next_event(&mut guest.events, files::EVENT_FILE_PROGRESS).await;
    assert_eq!(first["receivedBytes"], 0);
    assert!(!part(version + 1).exists());
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs network access for Iroh relays and address lookup"]
async fn test_host_and_guest_end_to_end() {
    let mut host = start_test_node("host").await;
    let mut guest = start_test_node("guest").await;
    std::fs::create_dir_all(host.dir.join("notes").join("sub")).unwrap();
    std::fs::write(host.dir.join("notes").join("sub").join("hello.md"), "# Hello from the host").unwrap();

    let invite = host
        .node
        .create_invite("Editor".into(), "ws-1".into(), "Demo".into(), "Hosty".into())
        .await
        .unwrap();
    assert!(invite.relay_connected, "host never reached an Iroh relay");
    assert!(Ticket::decode(&invite.ticket).unwrap().addr.relay_urls().next().is_some());
    let joined = guest.node.join(&invite.ticket, "Guesty").await.unwrap();
    assert_eq!(joined.workspace_name, "Demo");
    assert_eq!(joined.role, "Editor");
    assert_eq!(joined.host_name, "Hosty");

    let guest_on_host = next_event(&mut host.events, EVENT_PEER_JOINED).await;
    assert_eq!(guest_on_host["name"], "Guesty");
    assert_eq!(guest_on_host["isHost"], false);
    let guest_id = guest_on_host["id"].as_str().unwrap().to_string();

    // Guest broadcasts to the host, host replies to just that guest
    guest.node.send(None, &serde_json::json!({ "kind": "TEST", "n": 1 })).await.unwrap();
    let msg = next_event(&mut host.events, EVENT_MESSAGE).await;
    assert_eq!(msg["peerId"], guest_id.as_str());
    assert_eq!(msg["message"]["n"], 1);

    host.node
        .send(Some(&guest_id), &serde_json::json!({ "kind": "TEST", "n": 2 }))
        .await
        .unwrap();
    let msg = next_event(&mut guest.events, EVENT_MESSAGE).await;
    assert_eq!(msg["peerId"], joined.peer_id.as_str());
    assert_eq!(msg["message"]["n"], 2);

    // Guest streams a nested file from the host into its own workspace
    let guest_ws = guest.dir.to_string_lossy().into_owned();
    let size = files::fetch(&guest.node, &joined.peer_id, &guest_ws, "notes/sub/hello.md")
        .await
        .unwrap();
    assert_eq!(size, 21);
    assert_eq!(
        std::fs::read_to_string(guest.dir.join("notes").join("sub").join("hello.md")).unwrap(),
        "# Hello from the host"
    );
    assert!(files::fetch(&guest.node, &joined.peer_id, &guest_ws, "notes/missing.md").await.is_err());
    assert!(files::fetch(&guest.node, &joined.peer_id, &guest_ws, ".nexsync/nexsync.db").await.is_err());

    // A ticket with the host's real address but a guessed secret is rejected
    let intruder = start_test_node("intruder").await;
    let mut forged = Ticket::decode(&invite.ticket).unwrap();
    forged.secret = ticket::generate_secret();
    let err = intruder.node.join(&forged.encode(), "Mallory").await.unwrap_err();
    assert!(err.contains("expired"), "unexpected error: {err}");

    // A revoked invite no longer admits anyone
    host.node.revoke_invite();
    let err = intruder.node.join(&invite.ticket, "Late").await.unwrap_err();
    assert!(err.contains("isn't accepting"), "unexpected error: {err}");

    // Disconnecting on one side is observed by the other
    guest.node.disconnect(&joined.peer_id).unwrap();
    let left = next_event(&mut host.events, EVENT_PEER_LEFT).await;
    assert_eq!(left["peerId"], guest_id.as_str());
    assert!(host.node.peers().is_empty());
}

// Polls until `check` passes, panicking with `what` after 15 seconds
async fn wait_until(what: &str, check: impl Fn() -> bool) {
    for _ in 0..150 {
        if check() {
            return;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    panic!("timed out waiting until {what}");
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs network access for Iroh relays and address lookup"]
async fn test_workspace_deleted_notice_only_comes_from_the_host() {
    let mut host = start_test_node("wd-host").await;
    let mut guest = start_test_node("wd-guest").await;
    let invite = host
        .node
        .create_invite("Editor".into(), "ws".into(), "Demo".into(), "Host".into())
        .await
        .unwrap();
    guest.node.join(&invite.ticket, "Guesty").await.unwrap();
    wait_until("the guest is connected", || host.node.peers().len() == 1).await;

    // A guest cannot claim the workspace was deleted or hand hosting to anyone.
    let notice = serde_json::json!({ "kind": "WORKSPACE_DELETED", "timestamp": 1 });
    for kind in ["WORKSPACE_DELETED", KIND_HOST_HANDOFF, KIND_HOST_MOVED] {
        guest.node.send(None, &serde_json::json!({ "kind": kind, "timestamp": 1 })).await.unwrap();
    }
    let spoofed = tokio::time::timeout(Duration::from_secs(3), next_event(&mut host.events, EVENT_MESSAGE)).await;
    assert!(spoofed.is_err(), "the host must ignore host-only notices from a guest");

    // The host can, and the guest hears it.
    host.node.send(None, &notice).await.unwrap();
    let heard = next_event(&mut guest.events, EVENT_MESSAGE).await;
    assert_eq!(heard["message"]["kind"], "WORKSPACE_DELETED");
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs network access for Iroh relays and address lookup"]
async fn test_roles_follow_the_device_and_only_admins_can_ask_for_changes() {
    let mut host = start_test_node("role-host").await;
    let guest = start_test_node("role-guest").await;
    let invite = host
        .node
        .create_invite("Editor".into(), "ws".into(), "Demo".into(), "Host".into())
        .await
        .unwrap();
    guest.node.join(&invite.ticket, "Guesty").await.unwrap();
    wait_until("the guest is connected", || host.node.peers().len() == 1).await;
    let request = serde_json::json!({ "kind": "ROLE_REQUEST", "timestamp": 1, "payload": "{}" });

    // An Editor cannot ask for role changes.
    guest.node.send(None, &request).await.unwrap();
    let ignored = tokio::time::timeout(Duration::from_secs(3), next_event(&mut host.events, EVENT_MESSAGE)).await;
    assert!(ignored.is_err(), "the host must ignore a role request from an Editor");

    // Once the host promotes the device, its requests reach the host.
    let device = guest.node.self_id();
    host.node.set_roles(vec![(device.clone(), "Admin".into())]);
    assert_eq!(host.node.peers()[0].role, "Admin");
    guest.node.send(None, &request).await.unwrap();
    let heard = next_event(&mut host.events, EVENT_MESSAGE).await;
    assert_eq!(heard["message"]["kind"], "ROLE_REQUEST");

    // A host cannot receive a request from itself, and a guest never acts on one.
    host.node.send(None, &request).await.unwrap();
    let mut guest = guest;
    let echoed = tokio::time::timeout(Duration::from_secs(3), next_event(&mut guest.events, EVENT_MESSAGE)).await;
    assert!(echoed.is_err(), "a guest must ignore a role request from the host");

    // A demoted device keeps its role when it rejoins with a fresh Editor invite.
    host.node.set_roles(vec![(device, "Viewer".into())]);
    guest.node.disconnect_all();
    wait_until("the guest is gone", || host.node.peers().is_empty()).await;
    let invite = host
        .node
        .create_invite("Editor".into(), "ws".into(), "Demo".into(), "Host".into())
        .await
        .unwrap();
    let rejoined = guest.node.join(&invite.ticket, "Guesty").await.unwrap();
    assert_eq!(rejoined.role, "Viewer");
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs network access for Iroh relays and address lookup"]
async fn test_hosting_can_move_to_a_guest_and_everyone_follows() {
    let old_host = start_test_node("move-old").await;
    let new_host = start_test_node("move-new").await;
    let other = start_test_node("move-other").await;
    let invite = old_host
        .node
        .create_invite("Editor".into(), "ws".into(), "Demo".into(), "Old".into())
        .await
        .unwrap();
    new_host.node.join(&invite.ticket, "New").await.unwrap();
    other.node.join(&invite.ticket, "Other").await.unwrap();
    wait_until("both guests are connected", || old_host.node.peers().len() == 2).await;

    // The chosen guest takes over: it gets the role table, a fresh invite, and drops the old host.
    let old_id = old_host.node.self_id();
    new_host.node.set_roles(vec![(old_id.clone(), "Admin".into())]);
    let moved = new_host
        .node
        .create_invite("Editor".into(), "ws".into(), "Demo".into(), "New".into())
        .await
        .unwrap();
    new_host.node.disconnect(&old_host.node.self_id()).unwrap();

    // Another guest leaves the old host on purpose and follows, so it must not fight a reconnect.
    other.node.disconnect(&old_id).unwrap();
    other.node.join(&moved.ticket, "Other").await.unwrap();

    // The old host steps down and joins as a guest, keeping the Admin role it was given.
    old_host.node.disconnect_all();
    let rejoined = old_host.node.join(&moved.ticket, "Old").await.unwrap();
    assert_eq!(rejoined.role, "Admin");
    wait_until("everyone is on the new host", || new_host.node.peers().len() == 2).await;
    assert!(new_host.node.peers().iter().all(|p| !p.is_host));
    assert!(other.node.peers().iter().any(|p| p.is_host && p.id == new_host.node.self_id()));
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs network access for Iroh relays and address lookup"]
async fn test_guests_keep_syncing_with_each_other_when_the_host_is_gone() {
    let host = start_test_node("mesh-host").await;
    let mut editor = start_test_node("mesh-editor").await;
    let mut viewer = start_test_node("mesh-viewer").await;
    for (guest, role, name) in [(&editor, "Editor", "Ed"), (&viewer, "Viewer", "Vi")] {
        let invite = host
            .node
            .create_invite(role.into(), "ws".into(), "Demo".into(), "Host".into())
            .await
            .unwrap();
        guest.node.join(&invite.ticket, name).await.unwrap();
    }

    // The host vouches for them, so they link up directly.
    wait_until("the guests link up", || editor.node.peers().len() == 2 && viewer.node.peers().len() == 2).await;
    host.node.disconnect_all();
    wait_until("the host is gone", || editor.node.peers().len() == 1 && viewer.node.peers().len() == 1).await;

    // An Editor's change still reaches the other guest, with the host offline.
    let change = serde_json::json!({ "kind": KIND_DATA_CHANGE, "payload": "from-editor" });
    editor.node.send(None, &change).await.unwrap();
    let heard = next_shared_message(&mut viewer, Duration::from_secs(10)).await.expect("the viewer should hear the editor");
    assert_eq!(heard["message"]["payload"], "from-editor");

    // The Viewer's role travelled with the host's introduction, so its changes are still refused.
    let change = serde_json::json!({ "kind": KIND_DATA_CHANGE, "payload": "from-viewer" });
    viewer.node.send(None, &change).await.unwrap();
    assert!(next_shared_message(&mut editor, Duration::from_secs(2)).await.is_none());

    // A guest cannot make itself the source of host-only notices.
    let notice = serde_json::json!({ "kind": "WORKSPACE_DELETED", "timestamp": 1 });
    editor.node.send(None, &notice).await.unwrap();
    let spoofed = tokio::time::timeout(Duration::from_secs(2), next_event(&mut viewer.events, EVENT_MESSAGE)).await;
    assert!(spoofed.is_err(), "a guest must not act on another guest's host-only notice");
}

async fn short_code_for(host: &TestNode, ttl: Duration) -> String {
    host.node
        .create_short_code_with_ttl("Editor".into(), "ws".into(), "Demo".into(), "Host".into(), ttl)
        .await
        .unwrap()
        .code
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs network access for Iroh relays and address lookup"]
async fn test_short_code_join_needs_host_approval_and_works_once() {
    let mut host = start_test_node("sc-host").await;
    let guest = start_test_node("sc-guest").await;
    let second = start_test_node("sc-second").await;
    let code = short_code_for(&host, Duration::from_secs(120)).await;
    assert_eq!(code.len(), 6);

    // The guest types the code with a dash; nothing happens until the host allows it.
    let dashed = format!("{}-{}", &code[..3], &code[3..]);
    let g = guest.node.clone();
    let join = tokio::spawn(async move { g.join_with_code(&dashed, "Guesty").await });
    let request = next_event(&mut host.events, crate::commands::p2p::short_code::EVENT_JOIN_REQUEST).await;
    assert_eq!(request["name"], "Guesty");
    assert!(host.node.peers().is_empty(), "no one may join before approval");

    assert!(host.node.resolve_join_request(request["requestId"].as_str().unwrap(), true));
    let joined = join.await.unwrap().unwrap();
    assert_eq!(joined.role, "Editor");
    wait_until("the guest is connected", || host.node.peers().len() == 1).await;

    // The code is spent: a second guest cannot use it.
    assert!(second.node.join_with_code(&code, "Late").await.is_err());
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs network access for Iroh relays and address lookup"]
async fn test_short_code_denied_wrong_and_expired() {
    let mut host = start_test_node("sd-host").await;
    let guest = start_test_node("sd-guest").await;

    // Denied: the guest is told no and never connects.
    let code = short_code_for(&host, Duration::from_secs(120)).await;
    let g = guest.node.clone();
    let c = code.clone();
    let join = tokio::spawn(async move { g.join_with_code(&c, "Guesty").await });
    let request = next_event(&mut host.events, crate::commands::p2p::short_code::EVENT_JOIN_REQUEST).await;
    host.node.resolve_join_request(request["requestId"].as_str().unwrap(), false);
    let err = join.await.unwrap().unwrap_err();
    assert!(err.contains("declined"), "unexpected error: {err}");
    assert!(host.node.peers().is_empty());

    // Wrong digits and malformed codes fail.
    let wrong = if code == "000000" { "000001" } else { "000000" };
    assert!(guest.node.join_with_code(wrong, "Guesty").await.is_err());
    assert!(guest.node.join_with_code("12", "Guesty").await.is_err());

    // Expired: the code stops working after its lifetime.
    let short_lived = short_code_for(&host, Duration::from_secs(2)).await;
    tokio::time::sleep(Duration::from_secs(4)).await;
    assert!(guest.node.join_with_code(&short_lived, "Guesty").await.is_err());
}

// Creates the workspace database for a test node and seeds it with `tasks`
fn seed_workspace(node: &TestNode, tasks: Vec<crate::commands::workspace::models::Task>) {
    use crate::commands::workspace::data_sync::{merge_state, DataState};
    let dir = node.dir.to_string_lossy().into_owned();
    let db = crate::database::WorkspaceDb::open(&dir).unwrap();
    db.conn
        .execute(
            "INSERT INTO workspace (id, name, description, path, created_at, updated_at) VALUES ('ws', 'w', '', ?1, 't', 't')",
            [&dir],
        )
        .unwrap();
    merge_state(&db.conn, "ws", DataState { tasks, ..Default::default() }).unwrap();
}

fn test_task(id: &str, title: &str, updated_at: &str) -> crate::commands::workspace::models::Task {
    crate::commands::workspace::models::Task {
        id: id.into(),
        title: title.into(),
        description: String::new(),
        status: "todo".into(),
        priority: "medium".into(),
        due_date: None,
        assignee_id: None,
        created_at: "2026-01-01T00:00:00Z".into(),
        updated_at: updated_at.into(),
        ..Default::default()
    }
}

fn task_titles(node: &TestNode) -> Vec<String> {
    let mut titles: Vec<String> = crate::commands::workspace::data_sync::export_for(&node.dir.to_string_lossy())
        .unwrap()
        .tasks
        .into_iter()
        .map(|t| t.title)
        .collect();
    titles.sort();
    titles
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs network access for Iroh relays and address lookup"]
async fn test_reconnect_catches_up_offline_edits() {
    let host = start_test_node("cu-host").await;
    let guest = start_test_node("cu-guest").await;
    let notes = |n: &TestNode, f: &str| n.dir.join("notes").join(f);

    // Both sides worked while apart: different tasks, one task edited on both, files on each side,
    // and one note changed on both (the host's edit is newer).
    seed_workspace(
        &host,
        vec![test_task("a", "host task", "2026-01-02T00:00:00Z"), test_task("shared", "host edit", "2026-01-09T00:00:00Z")],
    );
    seed_workspace(
        &guest,
        vec![test_task("b", "guest task", "2026-01-02T00:00:00Z"), test_task("shared", "guest edit", "2026-01-05T00:00:00Z")],
    );
    std::fs::write(notes(&host, "only-host.md"), "host only").unwrap();
    std::fs::write(notes(&guest, "only-guest.md"), "guest only").unwrap();
    std::fs::write(notes(&guest, "both.md"), "guest version").unwrap();
    tokio::time::sleep(Duration::from_millis(1200)).await;
    std::fs::write(notes(&host, "both.md"), "host version").unwrap();

    let invite = host
        .node
        .create_invite("Editor".into(), "ws".into(), "Demo".into(), "Host".into())
        .await
        .unwrap();
    guest.node.join(&invite.ticket, "Guesty").await.unwrap();

    wait_until("tasks converge", || {
        task_titles(&host) == task_titles(&guest) && task_titles(&host).len() == 3
    })
    .await;
    assert!(task_titles(&host).contains(&"host edit".to_string()), "the newer edit should win");

    wait_until("files are exchanged", || {
        notes(&guest, "only-host.md").exists() && notes(&host, "only-guest.md").exists()
    })
    .await;
    wait_until("the newer note wins on the guest", || {
        std::fs::read_to_string(notes(&guest, "both.md")).map(|c| c == "host version").unwrap_or(false)
    })
    .await;
    // The guest's losing version is kept next to it instead of being lost.
    let kept = std::fs::read_dir(guest.dir.join("notes"))
        .unwrap()
        .flatten()
        .any(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            name.starts_with("both.conflict-") && std::fs::read_to_string(e.path()).unwrap() == "guest version"
        });
    assert!(kept, "the overwritten version should survive as a conflict copy");
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs network access for Iroh relays and address lookup"]
async fn test_catch_up_backs_up_files_it_overwrites() {
    let host = start_test_node("bk-host").await;
    let guest = start_test_node("bk-guest").await;
    let note = |n: &TestNode| n.dir.join("notes").join("stale.md");
    std::fs::write(note(&guest), "old").unwrap();
    tokio::time::sleep(Duration::from_millis(1200)).await;
    std::fs::write(note(&host), "new").unwrap();
    // The guest last synced after its copy was made, so only the host changed the note.
    let future = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() + 3_600_000;
    std::fs::create_dir_all(guest.dir.join(".nexsync")).unwrap();
    std::fs::write(guest.dir.join(".nexsync").join("last_sync"), future.to_string()).unwrap();

    let invite = host
        .node
        .create_invite("Editor".into(), "ws".into(), "Demo".into(), "Host".into())
        .await
        .unwrap();
    guest.node.join(&invite.ticket, "Guesty").await.unwrap();

    wait_until("the guest takes the host copy", || std::fs::read_to_string(note(&guest)).map(|c| c == "new").unwrap_or(false)).await;
    let backed_up = std::fs::read_dir(guest.dir.join(".nexsync").join("trash"))
        .unwrap()
        .flatten()
        .any(|e| std::fs::read_to_string(e.path().join("notes").join("stale.md")).map(|c| c == "old").unwrap_or(false));
    assert!(backed_up, "the replaced version should be recoverable from the trash");
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs network access for Iroh relays and address lookup"]
async fn test_live_file_sync() {
    let host = start_test_node("sync_host").await;
    let editor = start_test_node("sync_editor").await;
    let viewer = start_test_node("sync_viewer").await;

    let editor_invite = host
        .node
        .create_invite("Editor".into(), "ws".into(), "Demo".into(), "Host".into())
        .await
        .unwrap();
    editor.node.join(&editor_invite.ticket, "Ed").await.unwrap();
    let viewer_invite = host
        .node
        .create_invite("Viewer".into(), "ws".into(), "Demo".into(), "Host".into())
        .await
        .unwrap();
    viewer.node.join(&viewer_invite.ticket, "Vi").await.unwrap();
    wait_until("both guests are connected", || host.node.peers().len() == 2).await;

    // Host creates a nested note after both guests joined
    std::fs::create_dir_all(host.dir.join("notes").join("live")).unwrap();
    std::fs::write(host.dir.join("notes").join("live").join("new.md"), "from host").unwrap();
    let editor_copy = editor.dir.join("notes").join("live").join("new.md");
    let viewer_copy = viewer.dir.join("notes").join("live").join("new.md");
    wait_until("guests receive the host's note", || {
        std::fs::read_to_string(&editor_copy).ok().as_deref() == Some("from host")
            && std::fs::read_to_string(&viewer_copy).ok().as_deref() == Some("from host")
    })
    .await;

    // An Editor guest's edit reaches the host and, through it, the other guest
    std::fs::write(&editor_copy, "edited by editor").unwrap();
    let host_copy = host.dir.join("notes").join("live").join("new.md");
    wait_until("the editor's edit reaches everyone", || {
        std::fs::read_to_string(&host_copy).ok().as_deref() == Some("edited by editor")
            && std::fs::read_to_string(&viewer_copy).ok().as_deref() == Some("edited by editor")
    })
    .await;

    // A Viewer guest's local edit is ignored by the host
    std::fs::write(viewer.dir.join("notes").join("viewer.md"), "should not sync").unwrap();
    tokio::time::sleep(Duration::from_secs(3)).await;
    assert!(!host.dir.join("notes").join("viewer.md").exists());

    // Deleting on the editor moves the host's copy into the trash instead of destroying it
    std::fs::remove_file(&editor_copy).unwrap();
    wait_until("the deletion reaches the host", || !host_copy.exists()).await;
    let trash = host.dir.join(".nexsync").join("trash");
    let trashed = std::fs::read_dir(&trash)
        .unwrap()
        .flatten()
        .any(|stamp| stamp.path().join("notes").join("live").join("new.md").exists());
    assert!(trashed, "deleted file should be recoverable from .nexsync/trash");
}

// Next DATA_CHANGE / MEMBERS_UPDATE message this node's frontend receives, if any within `wait`
async fn next_shared_message(test: &mut TestNode, wait: Duration) -> Option<serde_json::Value> {
    tokio::time::timeout(wait, async {
        loop {
            let (event, payload) = test.events.recv().await?;
            let kind = payload["message"]["kind"].as_str().unwrap_or_default().to_string();
            if event == EVENT_MESSAGE && (kind == KIND_DATA_CHANGE || kind == KIND_MEMBERS_UPDATE) {
                return Some(payload);
            }
        }
    })
    .await
    .ok()
    .flatten()
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs network access for Iroh relays and address lookup"]
async fn test_data_changes_are_relayed_and_role_checked() {
    let mut host = start_test_node("data_host").await;
    let mut editor = start_test_node("data_editor").await;
    let mut viewer = start_test_node("data_viewer").await;

    let invite = host
        .node
        .create_invite("Editor".into(), "ws".into(), "Demo".into(), "Host".into())
        .await
        .unwrap();
    editor.node.join(&invite.ticket, "Ed").await.unwrap();
    let invite = host
        .node
        .create_invite("Viewer".into(), "ws".into(), "Demo".into(), "Host".into())
        .await
        .unwrap();
    viewer.node.join(&invite.ticket, "Vi").await.unwrap();
    wait_until("both guests are connected", || host.node.peers().len() == 2).await;

    // An Editor's task change reaches the host and is relayed to the other guest, not echoed back
    let change = serde_json::json!({ "kind": KIND_DATA_CHANGE, "payload": "editor-task" });
    editor.node.send(None, &change).await.unwrap();
    for node in [&mut host, &mut viewer] {
        let msg = next_shared_message(node, Duration::from_secs(20)).await.expect("change not delivered");
        assert_eq!(msg["message"]["payload"], "editor-task");
    }
    assert!(next_shared_message(&mut editor, Duration::from_secs(2)).await.is_none());

    // A Viewer's task change is dropped by the host and never relayed
    let change = serde_json::json!({ "kind": KIND_DATA_CHANGE, "payload": "viewer-task" });
    viewer.node.send(None, &change).await.unwrap();
    assert!(next_shared_message(&mut host, Duration::from_secs(3)).await.is_none());
    assert!(next_shared_message(&mut editor, Duration::from_secs(1)).await.is_none());

    // Guests can't rewrite the member list; the host can
    let members = serde_json::json!({ "kind": KIND_MEMBERS_UPDATE, "payload": "[]" });
    editor.node.send(None, &members).await.unwrap();
    assert!(next_shared_message(&mut host, Duration::from_secs(3)).await.is_none());
    host.node.send(None, &members).await.unwrap();
    assert!(next_shared_message(&mut editor, Duration::from_secs(20)).await.is_some());
    assert!(next_shared_message(&mut viewer, Duration::from_secs(20)).await.is_some());
}

// Next message of `kind` this node's frontend receives, if any within `wait`
async fn next_of_kind(test: &mut TestNode, kind: &str, wait: Duration) -> Option<serde_json::Value> {
    tokio::time::timeout(wait, async {
        loop {
            let (event, payload) = test.events.recv().await?;
            if event == EVENT_MESSAGE && payload["message"]["kind"].as_str() == Some(kind) {
                return Some(payload);
            }
        }
    })
    .await
    .ok()
    .flatten()
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs network access for Iroh relays and address lookup"]
async fn test_named_versions_are_signed_relayed_and_role_checked() {
    let mut host = start_test_node("ver_host").await;
    let mut editor = start_test_node("ver_editor").await;
    let mut viewer = start_test_node("ver_viewer").await;
    for (guest, role, name) in [(&editor, "Editor", "Ed"), (&viewer, "Viewer", "Vi")] {
        let invite = host
            .node
            .create_invite(role.into(), "ws".into(), "Demo".into(), "Host".into())
            .await
            .unwrap();
        guest.node.join(&invite.ticket, name).await.unwrap();
    }
    wait_until("both guests are connected", || host.node.peers().len() == 2).await;

    // An Editor's named version reaches the host and is relayed to the other guest, signed with the
    // Editor's real name even though the message claimed another author
    let message = serde_json::json!({ "kind": KIND_VERSION_NAMED, "timestamp": 1, "author": "Someone Else", "payload": "{}" });
    editor.node.send(None, &message).await.unwrap();
    for node in [&mut host, &mut viewer] {
        let heard = next_of_kind(node, KIND_VERSION_NAMED, Duration::from_secs(20)).await.expect("not delivered");
        assert_eq!(heard["message"]["author"], "Ed");
    }
    assert!(next_of_kind(&mut editor, KIND_VERSION_NAMED, Duration::from_secs(2)).await.is_none());

    // A Viewer's is dropped by the host and never relayed
    viewer.node.send(None, &message).await.unwrap();
    assert!(next_of_kind(&mut host, KIND_VERSION_NAMED, Duration::from_secs(3)).await.is_none());
    assert!(next_of_kind(&mut editor, KIND_VERSION_NAMED, Duration::from_secs(1)).await.is_none());
}

#[test]
fn test_author_is_stamped_by_the_receiver_and_a_hosts_stamp_is_kept() {
    // A host or a directly linked guest names the sender itself, whatever the message claims
    let mut message = serde_json::json!({ "kind": KIND_VERSION_NAMED, "author": "Someone Else", "authorId": "forged" });
    stamp_author(&mut message, "Ed", "key-ed", false);
    assert_eq!(message["author"], "Ed");
    assert_eq!(message["authorId"], "key-ed");

    // A guest hearing from the host keeps the name the host stamped, and names the host if there is none
    stamp_author(&mut message, "Host", "key-host", true);
    assert_eq!(message["author"], "Ed");
    assert_eq!(message["authorId"], "key-ed");
    let mut plain = serde_json::json!({ "kind": KIND_VERSION_NAMED });
    stamp_author(&mut plain, "Host", "key-host", true);
    assert_eq!(plain["author"], "Host");
    assert_eq!(plain["authorId"], "key-host");
    let mut empty = serde_json::json!({ "kind": KIND_VERSION_NAMED, "author": "" });
    stamp_author(&mut empty, "Host", "key-host", true);
    assert_eq!(empty["author"], "Host");
}

#[test]
fn test_the_lease_is_read_against_the_corrected_clock() {
    use crate::commands::workspace::crdt::set_clock_correction;
    let owner = SecretKey::from_bytes(&[1u8; 32]);
    let list = membership::next(None, &owner, "ws", "w", vec![(SecretKey::from_bytes(&[2u8; 32]).public().to_string(), "Editor".into())]).unwrap().unwrap();
    let me = SecretKey::from_bytes(&[2u8; 32]).public().to_string();
    // A list the owner signed just now
    set_clock_correction(0);
    assert!(list.vouches(&me, lease_now()));
    // This device's clock reads a day and an hour behind the others, so the watch moves it forward: the list has run out
    set_clock_correction(25 * 60 * 60 * 1000);
    let (expired, corrected) = (list.lease_expired(lease_now()), lease_now() > now_ms() + 24 * 60 * 60 * 1000);
    // And a device whose clock was set a day back, moved forward by the watch, no longer treats an old list as good
    set_clock_correction(0);
    assert!(expired && corrected, "the lease did not follow the corrected clock");
    assert!(!list.lease_expired(lease_now()));
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs network access for Iroh relays and address lookup"]
async fn test_an_erasure_made_while_a_device_was_away_reaches_it_over_a_real_link() {
    use crate::commands::workspace::{data_sync, erase};
    const MARKER: &str = "ZEBRA-4410-MARKER";
    let host = start_test_node("er-host").await;
    let guest = start_test_node("er-guest").await;
    let note = |n: &TestNode| n.dir.join("notes").join("secret.md");
    let has_marker = |n: &TestNode| -> bool {
        fn walk(dir: &std::path::Path) -> bool {
            std::fs::read_dir(dir).into_iter().flatten().flatten().any(|e| {
                let p = e.path();
                if p.is_dir() { walk(&p) } else { std::fs::read(&p).map(|b| b.windows(MARKER.len()).any(|w| w == MARKER.as_bytes())).unwrap_or(false) }
            })
        }
        walk(&n.dir)
    };
    // Both hold the same task and note; the host then erases them while the guest is away
    for n in [&host, &guest] {
        seed_workspace(n, vec![test_task("keep", "kept task", "2026-01-02T00:00:00Z"), test_task("secret", &format!("plan {MARKER}"), "2026-01-02T00:00:00Z")]);
        std::fs::write(note(n), format!("# note\n{MARKER}\n")).unwrap();
    }
    tokio::time::sleep(Duration::from_millis(1200)).await;
    {
        let dir = host.dir.to_string_lossy().into_owned();
        let db = crate::database::WorkspaceDb::open(&dir).unwrap();
        erase::erase_record(&db.conn, "ws", "task", "secret").unwrap();
        erase::erase_file(&db, &dir, "notes/secret.md", &[]).unwrap();
    }
    assert!(!has_marker(&host), "the host should hold nothing after erasing");

    let invite = host.node.create_invite("Editor".into(), "ws".into(), "Demo".into(), "Host".into()).await.unwrap();
    guest.node.join(&invite.ticket, "Guesty").await.unwrap();

    wait_until("the guest erases the task", || task_titles(&guest) == vec!["kept task".to_string()]).await;
    wait_until("the guest erases the note", || !note(&guest).exists()).await;
    wait_until("nothing of it is left on the guest's disk", || !has_marker(&guest)).await;
    // And it did not come back to the host
    tokio::time::sleep(Duration::from_secs(5)).await;
    assert_eq!(task_titles(&host), vec!["kept task".to_string()]);
    assert!(!note(&host).exists(), "the note came back to the host");
    assert!(!has_marker(&host), "the marker is back on the host");
    let _ = data_sync::export_for(&guest.dir.to_string_lossy()).unwrap();
}

// The entries of chat and comments over real links: an owner's entry reaches a guest, an Editor guest's reaches the host, a
// Viewer's is refused, and entries stored before a guest joined arrive when it does
#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs network access for Iroh relays and address lookup"]
async fn test_chat_entries_travel_are_role_checked_and_catch_up() {
    use crate::commands::workspace::chat::chatlog::{self, Ctx, Entry, Role};
    let mut host = start_test_node("log-host").await;
    let editor = start_test_node("log-editor").await;
    let viewer = start_test_node("log-viewer").await;
    let mut commenter = start_test_node("log-commenter").await;
    for n in [&host, &editor, &viewer, &commenter] {
        seed_workspace(n, vec![]);
    }
    let list = |n: &TestNode| -> Vec<Entry> { chatlog::list(&crate::database::WorkspaceDb::open_existing(&n.dir.to_string_lossy()).unwrap().conn).unwrap() };
    let bodies = |n: &TestNode| -> Vec<String> { list(n).into_iter().map(|e| e.body).collect() };
    let now = crate::commands::workspace::crdt::now_ms();

    // The host wrote one before anyone joined
    let early = Entry::signed_with(&host.node.secret, "message", "general", "", "written before you joined", now - 1_000);
    {
        let db = crate::database::WorkspaceDb::open_existing(&host.dir.to_string_lossy()).unwrap();
        let owner = |_: &str| Some(Role::Owner);
        chatlog::merge(&db.conn, vec![early], &Ctx { me: &host.node.self_id(), now, role_of: &owner }).unwrap();
    }

    let invite = host.node.create_invite("Editor".into(), "ws".into(), "Demo".into(), "Host".into()).await.unwrap();
    editor.node.join(&invite.ticket, "Ed").await.unwrap();
    let invite = host.node.create_invite("Viewer".into(), "ws".into(), "Demo".into(), "Host".into()).await.unwrap();
    viewer.node.join(&invite.ticket, "Vi").await.unwrap();
    let invite = host.node.create_invite("Commenter".into(), "ws".into(), "Demo".into(), "Host".into()).await.unwrap();
    commenter.node.join(&invite.ticket, "Co").await.unwrap();
    wait_until("all three guests are connected", || host.node.peers().len() == 3).await;

    // Catch-up: what the host stored before reaches both guests
    wait_until("the editor catches up", || bodies(&editor) == ["written before you joined"]).await;
    wait_until("the viewer catches up", || bodies(&viewer) == ["written before you joined"]).await;

    // A live entry from the owner reaches the guests
    let live = Entry::signed_with(&host.node.secret, "message", "general", "", "hello from the host", crate::commands::workspace::crdt::now_ms());
    chat::publish(&host.node, &live).await;
    wait_until("the guests get the live entry", || bodies(&editor).len() == 2 && bodies(&viewer).len() == 2).await;

    // An Editor's entry reaches the host
    let from_editor = Entry::signed_with(&editor.node.secret, "message", "general", "", "hello from the editor", crate::commands::workspace::crdt::now_ms());
    chat::publish(&editor.node, &from_editor).await;
    wait_until("the host gets the editor's entry", || bodies(&host).contains(&"hello from the editor".to_string())).await;

    // A Viewer's entry is refused by the host, and so never relayed on
    let from_viewer = Entry::signed_with(&viewer.node.secret, "message", "general", "", "a viewer cannot write", crate::commands::workspace::crdt::now_ms());
    chat::publish(&viewer.node, &from_viewer).await;
    tokio::time::sleep(Duration::from_secs(4)).await;
    assert!(!bodies(&host).contains(&"a viewer cannot write".to_string()));
    assert!(!bodies(&editor).contains(&"a viewer cannot write".to_string()));

    // A Commenter may write in the log, but its task and card changes are dropped by the host, as a Viewer's are
    let from_commenter = Entry::signed_with(&commenter.node.secret, "message", "general", "", "a commenter may write", crate::commands::workspace::crdt::now_ms());
    chat::publish(&commenter.node, &from_commenter).await;
    wait_until("the host gets the commenter's entry", || bodies(&host).contains(&"a commenter may write".to_string())).await;
    let change = serde_json::json!({ "kind": KIND_DATA_CHANGE, "payload": "commenter-task" });
    commenter.node.send(None, &change).await.unwrap();
    assert!(next_shared_message(&mut commenter, Duration::from_secs(1)).await.is_none());
    assert!(next_shared_message(&mut host, Duration::from_secs(3)).await.is_none(), "a Commenter's task change should be dropped");
}

// A timeout disconnects a member and keeps it out until it ends or is lifted; a ban keeps it out whatever invite it has
#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs network access for Iroh relays and address lookup"]
async fn test_a_timeout_disconnects_a_ban_stays_through_a_new_invite_and_both_can_be_lifted() {
    use crate::commands::workspace::chat::chatlog::{self, Ctx, Entry, Role};
    use crate::commands::workspace::{chat::moderation, crdt};
    let host = start_test_node("mod-host").await;
    let guest = start_test_node("mod-guest").await;
    seed_workspace(&host, vec![]);
    seed_workspace(&guest, vec![]);
    let guest_id = guest.node.self_id();
    let now = crdt::now_ms();

    // The host's signed member list names the guest, and the guest joins
    host.node.set_known_members("ws".into(), "Demo".into(), "Host".into(), vec![(guest_id.clone(), "Editor".into())]);
    let invite = host.node.create_invite("Editor".into(), "ws".into(), "Demo".into(), "Host".into()).await.unwrap();
    guest.node.join(&invite.ticket, "Gus").await.unwrap();
    wait_until("the guest is connected", || host.node.peers().len() == 1).await;

    // The owner writes a moderation entry into its log; the node acts on it
    let act = |action: &str, until: u64| {
        let a = moderation::Action { action: action.into(), target: guest_id.clone(), target_name: "Gus".into(), until, reason: "testing".into(), ..Default::default() };
        let e = Entry::signed_with(&host.node.secret, moderation::KIND, "moderation", "", &serde_json::to_string(&a).unwrap(), crdt::now_ms());
        let db = crate::database::WorkspaceDb::open_existing(&host.dir.to_string_lossy()).unwrap();
        let host_id = host.node.self_id();
        let roles = |k: &str| Some(if k == host_id { Role::Owner } else { Role::Editor });
        let merged = chatlog::merge(&db.conn, vec![e], &Ctx { me: &host_id, now: crdt::now_ms(), role_of: &roles }).unwrap();
        assert_eq!(merged.added.len(), 1, "the moderation entry was refused");
        host.node.refresh_moderation();
    };
    act("timeout", now + 3_600_000);
    wait_until("the timed out guest is disconnected", || host.node.peers().is_empty()).await;
    let invite = host.node.create_invite("Editor".into(), "ws".into(), "Demo".into(), "Host".into()).await.unwrap();
    let err = guest.node.join(&invite.ticket, "Gus").await.unwrap_err();
    assert!(err.contains("timed out"), "unexpected error: {err}");

    // Lifted, the guest comes back
    act("untimeout", 0);
    let invite = host.node.create_invite("Editor".into(), "ws".into(), "Demo".into(), "Host".into()).await.unwrap();
    guest.node.join(&invite.ticket, "Gus").await.unwrap();
    wait_until("the guest is back", || host.node.peers().len() == 1).await;

    // A ban sends it away, and a new invite does not let it back in
    act("ban", 0);
    wait_until("the banned guest is disconnected", || host.node.peers().is_empty()).await;
    for _ in 0..2 {
        let invite = host.node.create_invite("Editor".into(), "ws".into(), "Demo".into(), "Host".into()).await.unwrap();
        let err = guest.node.join(&invite.ticket, "Gus").await.unwrap_err();
        assert!(err.contains("banned"), "unexpected error: {err}");
    }
    // Only an unban lets a new invite work again
    act("unban", 0);
    let invite = host.node.create_invite("Editor".into(), "ws".into(), "Demo".into(), "Host".into()).await.unwrap();
    guest.node.join(&invite.ticket, "Gus").await.unwrap();
}

#[test]
fn only_editors_and_admins_may_change_things_and_a_commenter_may_only_write_messages() {
    assert!(can_edit("Admin") && can_edit("Editor"));
    assert!(!can_edit("Commenter") && !can_edit("Viewer"));
    assert!(INVITE_ROLES.contains(&"Commenter") && GUEST_ROLES.contains(&"Commenter"));
}

#[test]
fn test_sanitize_name() {
    assert_eq!(sanitize_name("  Alice  "), "Alice");
    assert_eq!(sanitize_name(""), "Collaborator");
    assert_eq!(sanitize_name("\u{7}\n"), "Collaborator");
    assert_eq!(sanitize_name(&"x".repeat(100)).len(), 64);
}
