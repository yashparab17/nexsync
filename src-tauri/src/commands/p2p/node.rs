//! The local Iroh endpoint and the set of connected peers.
//!
//! One endpoint is started lazily per app run. A host accepts any number of
//! guests; a guest dials the host from an invite ticket. Each peer gets one
//! control stream (handshake, then JSON app messages in both directions) and
//! may open additional streams to request files.

use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use iroh::{
    endpoint::{presets, Connection, RecvStream, SendStream},
    Endpoint, EndpointId,
};
use serde::Serialize;
use subtle::ConstantTimeEq;
use tauri::{AppHandle, Emitter};
use tokio::{
    io::AsyncReadExt,
    sync::{mpsc, Mutex as AsyncMutex},
};

use super::{
    files,
    ticket::{self, Ticket, SECRET_LEN},
    wire::{self, HandshakeReply, Hello},
};

pub const EVENT_PEERS: &str = "p2p://peers";
pub const EVENT_PEER_JOINED: &str = "p2p://peer-joined";
pub const EVENT_PEER_LEFT: &str = "p2p://peer-left";
pub const EVENT_MESSAGE: &str = "p2p://message";

const ONLINE_TIMEOUT: Duration = Duration::from_secs(15);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(30);
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(15);
const REJECT_LINGER: Duration = Duration::from_secs(3);
const STATS_INTERVAL: Duration = Duration::from_secs(2);
const OUTBOX_CAPACITY: usize = 256;

const CLOSE_NORMAL: u32 = 0;
const CLOSE_REJECTED: u32 = 1;
const CLOSE_REPLACED: u32 = 2;

/// Roles a host may grant through an invite
const INVITE_ROLES: &[&str] = &["Editor", "Viewer"];

/// Workspace folder this device shares with peers (`None` when no workspace is open)
type SharedWorkspace = Arc<Mutex<Option<String>>>;

/// Delivers a named event with a JSON payload to the frontend
pub type EventSink = Arc<dyn Fn(&'static str, serde_json::Value) + Send + Sync>;

/// Tauri-managed handle to the (lazily started) P2P node
#[derive(Default)]
pub struct P2pState {
    node: AsyncMutex<Option<Arc<Node>>>,
    workspace: SharedWorkspace,
}

impl P2pState {
    /// Returns the running node, starting the Iroh endpoint on first use
    pub async fn node(&self, app: &AppHandle) -> Result<Arc<Node>, String> {
        let mut guard = self.node.lock().await;
        if let Some(node) = guard.as_ref() {
            return Ok(node.clone());
        }
        let app = app.clone();
        let events: EventSink = Arc::new(move |event, payload| {
            let _ = app.emit(event, payload);
        });
        let node = Node::start(events, self.workspace.clone()).await?;
        *guard = Some(node.clone());
        Ok(node)
    }

    /// Returns the node only if it has already been started
    pub async fn existing(&self) -> Option<Arc<Node>> {
        self.node.lock().await.clone()
    }

    /// Sets the workspace served to peers; takes effect without starting the network
    pub fn set_workspace_path(&self, path: Option<String>) {
        *self.workspace.lock().unwrap_or_else(|p| p.into_inner()) = path;
    }
}

/// Live state of one connected peer, as shown in the UI
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PeerInfo {
    pub id: String,
    pub name: String,
    pub role: String,
    pub status: &'static str,
    pub latency_ms: u64,
    pub bytes_sent: u64,
    pub bytes_received: u64,
    pub connected_at: u64,
    /// `direct` (hole-punched UDP), `relay` (via an Iroh relay) or `connecting`
    pub connection_type: &'static str,
    /// True when this peer is the host whose workspace we joined
    pub is_host: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InviteInfo {
    pub ticket: String,
    /// False if no relay was reachable, so only same-network guests can join
    pub relay_connected: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JoinResult {
    pub peer_id: String,
    pub workspace_id: String,
    pub workspace_name: String,
    pub role: String,
    pub host_name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PeerLeft {
    peer_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct IncomingMessage {
    peer_id: String,
    message: serde_json::Value,
}

struct Invite {
    secret: [u8; SECRET_LEN],
    role: String,
    workspace_id: String,
    workspace_name: String,
    host_name: String,
}

struct Peer {
    conn: Connection,
    outbox: mpsc::Sender<Vec<u8>>,
    name: String,
    role: String,
    is_host: bool,
    connected_at: u64,
}

#[derive(Default)]
struct NodeState {
    invite: Option<Invite>,
    peers: HashMap<EndpointId, Peer>,
}

pub struct Node {
    endpoint: Endpoint,
    events: EventSink,
    workspace: SharedWorkspace,
    state: Mutex<NodeState>,
}

impl Node {
    /// Binds the Iroh endpoint and spawns the accept and stats loops
    async fn start(events: EventSink, workspace: SharedWorkspace) -> Result<Arc<Self>, String> {
        let endpoint = Endpoint::builder(presets::N0)
            .alpns(vec![wire::ALPN.to_vec()])
            .bind()
            .await
            .map_err(|e| format!("Failed to start the P2P network: {e}"))?;

        let node = Arc::new(Self {
            endpoint,
            events,
            workspace,
            state: Mutex::new(NodeState::default()),
        });

        tokio::spawn(node.clone().accept_loop());
        tokio::spawn(node.clone().stats_loop());
        Ok(node)
    }

    /// Emits a frontend event; payloads are plain structs, so serialization cannot fail
    pub fn emit(&self, event: &'static str, payload: impl Serialize) {
        if let Ok(value) = serde_json::to_value(payload) {
            (self.events)(event, value);
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, NodeState> {
        self.state.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    // ────────────────────────────
    // Hosting
    // ────────────────────────────

    /// Creates a new invite, replacing any previous one, and returns its ticket
    pub async fn create_invite(
        &self,
        role: String,
        workspace_id: String,
        workspace_name: String,
        host_name: String,
    ) -> Result<InviteInfo, String> {
        if !INVITE_ROLES.contains(&role.as_str()) {
            return Err(format!("Invalid invite role: {role}"));
        }

        // Wait for a home relay so guests outside this network can reach us
        let relay_connected = tokio::time::timeout(ONLINE_TIMEOUT, self.endpoint.online())
            .await
            .is_ok();

        let secret = ticket::generate_secret();
        let ticket = Ticket {
            addr: self.endpoint.addr(),
            secret,
        }
        .encode();

        self.lock().invite = Some(Invite {
            secret,
            role,
            workspace_id,
            workspace_name,
            host_name,
        });

        Ok(InviteInfo {
            ticket,
            relay_connected,
        })
    }

    /// Stops accepting new guests; already connected peers stay connected
    pub fn revoke_invite(&self) {
        self.lock().invite = None;
    }

    async fn accept_loop(self: Arc<Self>) {
        while let Some(incoming) = self.endpoint.accept().await {
            let node = self.clone();
            tokio::spawn(async move {
                let conn = match incoming.accept() {
                    Ok(accepting) => match accepting.await {
                        Ok(conn) => conn,
                        Err(e) => {
                            eprintln!("[P2P] Incoming connection failed: {e}");
                            return;
                        }
                    },
                    Err(e) => {
                        eprintln!("[P2P] Incoming connection refused: {e}");
                        return;
                    }
                };
                if let Err(e) = node.handle_incoming(conn).await {
                    eprintln!("[P2P] Rejected incoming peer: {e}");
                }
            });
        }
    }

    /// Runs the host side of the handshake for a newly accepted connection
    async fn handle_incoming(self: &Arc<Self>, conn: Connection) -> Result<(), String> {
        let (mut send, mut recv) = tokio::time::timeout(HANDSHAKE_TIMEOUT, conn.accept_bi())
            .await
            .map_err(|_| "peer never opened a control stream".to_string())?
            .map_err(|e| e.to_string())?;

        let kind = tokio::time::timeout(HANDSHAKE_TIMEOUT, recv.read_u8())
            .await
            .map_err(|_| "handshake timed out".to_string())?
            .map_err(|e| e.to_string())?;
        if kind != wire::STREAM_CONTROL {
            conn.close(CLOSE_REJECTED.into(), b"expected control stream");
            return Err("first stream was not a control stream".into());
        }

        let hello: Hello = tokio::time::timeout(
            HANDSHAKE_TIMEOUT,
            wire::read_json(&mut recv, wire::MAX_SMALL_FRAME),
        )
        .await
        .map_err(|_| "handshake timed out".to_string())??;

        let verdict = if hello.v != wire::PROTOCOL_VERSION {
            Err("You're running a different version of NexSync than the host. Update both apps and try again.".to_string())
        } else {
            self.check_invite(&hello.secret)
        };

        match verdict {
            Ok(welcome) => {
                let HandshakeReply::Welcome { role, .. } = &welcome else {
                    unreachable!("check_invite only returns Welcome on success")
                };
                let role = role.clone();
                wire::write_json(&mut send, &welcome).await?;
                self.register_peer(conn, send, recv, sanitize_name(&hello.name), role, false);
                Ok(())
            }
            Err(error) => {
                let _ = wire::write_json(&mut send, &HandshakeReply::Reject { error: error.clone() }).await;
                let _ = send.finish();
                // Give the guest a moment to read the reason before we hang up
                let _ = tokio::time::timeout(REJECT_LINGER, conn.closed()).await;
                conn.close(CLOSE_REJECTED.into(), b"rejected");
                Err(error)
            }
        }
    }

    fn check_invite(&self, presented: &str) -> Result<HandshakeReply, String> {
        let st = self.lock();
        let invite = st
            .invite
            .as_ref()
            .ok_or("The host isn't accepting new collaborators right now. Ask them for a new invite.")?;
        let presented = ticket::decode_secret(presented).unwrap_or([0u8; SECRET_LEN]);
        if !bool::from(presented.ct_eq(&invite.secret)) {
            return Err("This invite has expired or been replaced. Ask the host for a new one.".into());
        }
        Ok(HandshakeReply::Welcome {
            v: wire::PROTOCOL_VERSION,
            host_name: invite.host_name.clone(),
            role: invite.role.clone(),
            workspace_id: invite.workspace_id.clone(),
            workspace_name: invite.workspace_name.clone(),
        })
    }

    // ────────────────────────────
    // Joining
    // ────────────────────────────

    /// Dials the host named in `ticket_str` and completes the invite handshake
    pub async fn join(self: &Arc<Self>, ticket_str: &str, display_name: &str) -> Result<JoinResult, String> {
        let ticket = Ticket::decode(ticket_str)?;
        let host_id = ticket.addr.id;
        if host_id == self.endpoint.id() {
            return Err("That invite was created on this device. Share it with your collaborator instead.".into());
        }

        let conn = tokio::time::timeout(CONNECT_TIMEOUT, self.endpoint.connect(ticket.addr, wire::ALPN))
            .await
            .map_err(|_| "Timed out reaching the host. Make sure they're online and still have NexSync open.".to_string())?
            .map_err(|e| format!("Couldn't reach the host: {e}"))?;

        let (mut send, mut recv) = conn.open_bi().await.map_err(|e| e.to_string())?;
        send.write_all(&[wire::STREAM_CONTROL]).await.map_err(|e| e.to_string())?;
        wire::write_json(
            &mut send,
            &Hello {
                v: wire::PROTOCOL_VERSION,
                secret: ticket::encode_secret(&ticket.secret),
                name: sanitize_name(display_name),
            },
        )
        .await?;

        let reply: HandshakeReply = tokio::time::timeout(
            HANDSHAKE_TIMEOUT,
            wire::read_json(&mut recv, wire::MAX_SMALL_FRAME),
        )
        .await
        .map_err(|_| "The host didn't answer the invite in time.".to_string())??;

        match reply {
            HandshakeReply::Welcome {
                v,
                host_name,
                role,
                workspace_id,
                workspace_name,
            } => {
                if v != wire::PROTOCOL_VERSION {
                    conn.close(CLOSE_REJECTED.into(), b"version mismatch");
                    return Err("The host is running a different version of NexSync. Update both apps and try again.".into());
                }
                let host_name = sanitize_name(&host_name);
                self.register_peer(conn, send, recv, host_name.clone(), role.clone(), true);
                Ok(JoinResult {
                    peer_id: host_id.to_string(),
                    workspace_id,
                    workspace_name,
                    role,
                    host_name,
                })
            }
            HandshakeReply::Reject { error } => {
                conn.close(CLOSE_REJECTED.into(), b"rejected");
                Err(error)
            }
        }
    }

    // ────────────────────────────
    // Peer lifecycle
    // ────────────────────────────

    fn register_peer(
        self: &Arc<Self>,
        conn: Connection,
        send: SendStream,
        recv: RecvStream,
        name: String,
        role: String,
        is_host: bool,
    ) {
        let id = conn.remote_id();
        let (outbox, rx) = mpsc::channel(OUTBOX_CAPACITY);
        let peer = Peer {
            conn: conn.clone(),
            outbox,
            name,
            role,
            is_host,
            connected_at: now_ms(),
        };
        let info = peer_info(&id, &peer);

        let replaced = self.lock().peers.insert(id, peer);
        if let Some(old) = replaced {
            old.conn.close(CLOSE_REPLACED.into(), b"replaced by a newer connection");
        }

        // Announce the peer before reading from it, so the UI never sees a message from an unknown peer
        self.emit(EVENT_PEER_JOINED, &info);
        self.emit_peers();

        tokio::spawn(write_loop(send, rx));
        tokio::spawn(self.clone().run_peer(conn, recv));
    }

    /// Reads app messages and serves file requests until the connection ends
    async fn run_peer(self: Arc<Self>, conn: Connection, mut recv: RecvStream) {
        let id = conn.remote_id();

        let reader = async {
            loop {
                match wire::read_frame(&mut recv, wire::MAX_MESSAGE_FRAME).await {
                    Ok(Some(bytes)) => self.dispatch_message(&id, &bytes),
                    Ok(None) => break,
                    Err(e) => {
                        eprintln!("[P2P] Control stream from {} ended: {e}", id.fmt_short());
                        break;
                    }
                }
            }
        };

        let acceptor = async {
            while let Ok((send, recv)) = conn.accept_bi().await {
                let node = self.clone();
                tokio::spawn(async move { files::serve(&node, send, recv).await });
            }
        };

        tokio::select! {
            _ = reader => {}
            _ = acceptor => {}
        }

        conn.close(CLOSE_NORMAL.into(), b"bye");
        self.remove_peer(&id, conn.stable_id());
    }

    fn dispatch_message(&self, from: &EndpointId, bytes: &[u8]) {
        let message: serde_json::Value = match serde_json::from_slice(bytes) {
            Ok(value) => value,
            Err(_) => {
                eprintln!("[P2P] Dropping non-JSON message from {}", from.fmt_short());
                return;
            }
        };
        if !message.get("kind").is_some_and(|k| k.is_string()) {
            eprintln!("[P2P] Dropping message without a kind from {}", from.fmt_short());
            return;
        }
        self.emit(
            EVENT_MESSAGE,
            IncomingMessage {
                peer_id: from.to_string(),
                message,
            },
        );
    }

    /// Removes a peer only if the map still holds this exact connection
    fn remove_peer(&self, id: &EndpointId, stable_id: usize) {
        let removed = {
            let mut st = self.lock();
            match st.peers.get(id) {
                Some(peer) if peer.conn.stable_id() == stable_id => st.peers.remove(id),
                _ => None,
            }
        };
        if removed.is_some() {
            self.emit(EVENT_PEER_LEFT, PeerLeft { peer_id: id.to_string() });
            self.emit_peers();
        }
    }

    /// Closes the connection to one peer
    pub fn disconnect(&self, peer_id: &str) -> Result<(), String> {
        let id = parse_peer_id(peer_id)?;
        let removed = self.lock().peers.remove(&id);
        if let Some(peer) = removed {
            peer.conn.close(CLOSE_NORMAL.into(), b"disconnected");
            self.emit(EVENT_PEER_LEFT, PeerLeft { peer_id: id.to_string() });
            self.emit_peers();
        }
        Ok(())
    }

    /// Closes every peer connection and stops accepting new guests
    pub fn disconnect_all(&self) {
        let peers: Vec<(EndpointId, Peer)> = {
            let mut st = self.lock();
            st.invite = None;
            st.peers.drain().collect()
        };
        for (id, peer) in peers {
            peer.conn.close(CLOSE_NORMAL.into(), b"disconnected");
            self.emit(EVENT_PEER_LEFT, PeerLeft { peer_id: id.to_string() });
        }
        self.emit_peers();
    }

    // ────────────────────────────
    // Messaging & queries
    // ────────────────────────────

    /// Sends a JSON app message to one peer, or to all peers when `target` is `None`
    pub async fn send(&self, target: Option<&str>, message: &serde_json::Value) -> Result<usize, String> {
        let bytes = serde_json::to_vec(message).map_err(|e| e.to_string())?;
        if bytes.len() > wire::MAX_MESSAGE_FRAME {
            return Err(format!(
                "Message is too large to send ({} bytes, limit is {}).",
                bytes.len(),
                wire::MAX_MESSAGE_FRAME
            ));
        }

        let outboxes: Vec<mpsc::Sender<Vec<u8>>> = {
            let st = self.lock();
            match target {
                Some(peer_id) => {
                    let id = parse_peer_id(peer_id)?;
                    let peer = st.peers.get(&id).ok_or("That collaborator is no longer connected.")?;
                    vec![peer.outbox.clone()]
                }
                None => st.peers.values().map(|p| p.outbox.clone()).collect(),
            }
        };

        // A closed outbox just means the peer disconnected in the meantime
        for outbox in &outboxes {
            let _ = outbox.send(bytes.clone()).await;
        }
        Ok(outboxes.len())
    }

    pub fn peers(&self) -> Vec<PeerInfo> {
        let st = self.lock();
        let mut peers: Vec<PeerInfo> = st.peers.iter().map(|(id, p)| peer_info(id, p)).collect();
        peers.sort_by_key(|p| p.connected_at);
        peers
    }

    pub fn connection(&self, peer_id: &str) -> Result<Connection, String> {
        let id = parse_peer_id(peer_id)?;
        self.lock()
            .peers
            .get(&id)
            .map(|p| p.conn.clone())
            .ok_or_else(|| "That collaborator is no longer connected.".to_string())
    }

    pub fn workspace_path(&self) -> Option<String> {
        self.workspace.lock().unwrap_or_else(|p| p.into_inner()).clone()
    }

    fn emit_peers(&self) {
        self.emit(EVENT_PEERS, self.peers());
    }

    /// Periodically pushes fresh latency/traffic stats while peers are connected
    async fn stats_loop(self: Arc<Self>) {
        let mut interval = tokio::time::interval(STATS_INTERVAL);
        loop {
            interval.tick().await;
            let peers = self.peers();
            if !peers.is_empty() {
                self.emit(EVENT_PEERS, peers);
            }
        }
    }
}

async fn write_loop(mut send: SendStream, mut rx: mpsc::Receiver<Vec<u8>>) {
    while let Some(frame) = rx.recv().await {
        if wire::write_frame(&mut send, &frame).await.is_err() {
            return;
        }
    }
    let _ = send.finish();
}

fn peer_info(id: &EndpointId, peer: &Peer) -> PeerInfo {
    let paths = peer.conn.paths();
    let selected = paths.iter().find(|p| p.is_selected());
    let (latency_ms, connection_type) = match selected {
        Some(path) => (
            path.rtt().as_millis() as u64,
            if path.is_relay() { "relay" } else { "direct" },
        ),
        None => (0, "connecting"),
    };
    let stats = peer.conn.stats();

    PeerInfo {
        id: id.to_string(),
        name: peer.name.clone(),
        role: peer.role.clone(),
        status: "connected",
        latency_ms,
        bytes_sent: stats.udp_tx.bytes,
        bytes_received: stats.udp_rx.bytes,
        connected_at: peer.connected_at,
        connection_type,
        is_host: peer.is_host,
    }
}

fn parse_peer_id(peer_id: &str) -> Result<EndpointId, String> {
    peer_id
        .parse::<EndpointId>()
        .map_err(|_| format!("Invalid peer id: {peer_id}"))
}

/// Trims a display name received from a peer to something safe to show
fn sanitize_name(name: &str) -> String {
    let cleaned: String = name.chars().filter(|c| !c.is_control()).take(64).collect();
    let cleaned = cleaned.trim();
    if cleaned.is_empty() {
        "Collaborator".to_string()
    } else {
        cleaned.to_string()
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
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

    async fn start_test_node(label: &str) -> TestNode {
        let dir = std::env::temp_dir().join(format!("nexsync_p2p_{label}_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(dir.join("notes")).unwrap();
        let (tx, events) = mpsc::unbounded_channel();
        let sink: EventSink = Arc::new(move |event, payload| {
            let _ = tx.send((event, payload));
        });
        let workspace: SharedWorkspace = Arc::new(Mutex::new(Some(dir.to_string_lossy().into_owned())));
        let node = Node::start(sink, workspace).await.unwrap();
        TestNode { node, events, dir }
    }

    async fn next_event(
        events: &mut mpsc::UnboundedReceiver<(&'static str, serde_json::Value)>,
        name: &str,
    ) -> serde_json::Value {
        tokio::time::timeout(Duration::from_secs(20), async {
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

    #[test]
    fn test_sanitize_name() {
        assert_eq!(sanitize_name("  Alice  "), "Alice");
        assert_eq!(sanitize_name(""), "Collaborator");
        assert_eq!(sanitize_name("\u{7}\n"), "Collaborator");
        assert_eq!(sanitize_name(&"x".repeat(100)).len(), 64);
    }
}
