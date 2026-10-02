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
    endpoint::{presets, Connection, RecvStream, RelayStatus, SendStream},
    Endpoint, EndpointAddr, EndpointId, SecretKey, Watcher,
};
use serde::Serialize;
use subtle::ConstantTimeEq;
use tauri::{AppHandle, Emitter, Manager};
use tokio::{
    io::AsyncReadExt,
    sync::{mpsc, Mutex as AsyncMutex},
};

use super::{
    files,
    membership::{self, Membership},
    mesh::{self, MeshAllow},
    short_code::ShortCodes,
    sync::{self, LiveSync, SyncMessage},
    ticket::{self, Ticket, SECRET_LEN},
    wire::{self, HandshakeReply, Hello},
};

pub const EVENT_PEERS: &str = "p2p://peers";
pub const EVENT_PEER_JOINED: &str = "p2p://peer-joined";
pub const EVENT_PEER_LEFT: &str = "p2p://peer-left";
pub const EVENT_MESSAGE: &str = "p2p://message";
pub const EVENT_RECONNECTING: &str = "p2p://reconnecting";
pub const EVENT_RECONNECT_FAILED: &str = "p2p://reconnect-failed";
pub const EVENT_NETWORK: &str = "p2p://network";

pub(super) const ONLINE_TIMEOUT: Duration = Duration::from_secs(15);
pub(super) const CONNECT_TIMEOUT: Duration = Duration::from_secs(30);
pub(super) const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(15);
const RECONNECT_ATTEMPTS: u32 = 8;
const RECONNECT_MAX_DELAY: Duration = Duration::from_secs(30);
const REJECT_LINGER: Duration = Duration::from_secs(3);
const STATS_INTERVAL: Duration = Duration::from_secs(2);
const OUTBOX_CAPACITY: usize = 256;
const MESH_DIAL_ATTEMPTS: u32 = 3;
const MESH_DIAL_DELAY: Duration = Duration::from_secs(2);
/// How often a member that is not linked to the others looks for them, which also covers the seconds after a device
/// starts before its address can be found
const MEMBER_DIAL_EVERY: Duration = Duration::from_secs(10);
const MEMBER_CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const MEMBER_DIAL_PARALLEL: usize = 6;

const CLOSE_NORMAL: u32 = 0;
const CLOSE_REJECTED: u32 = 1;
const CLOSE_REPLACED: u32 = 2;

/// Task/kanban edits; hosts drop them from Viewer guests
const KIND_DATA_CHANGE: &str = "DATA_CHANGE";
/// The host's member list; accepted only from the host
const KIND_MEMBERS_UPDATE: &str = "MEMBERS_UPDATE";
/// The rules the host has turned on, which become the workspace's rules; accepted only from the host
const KIND_RULES_UPDATE: &str = "RULES_UPDATE";
/// Where a person is in the workspace; stamped with who sent it so nobody can show up as someone else
const KIND_PRESENCE: &str = "PRESENCE";
/// A guest asking the host to change the name they go by in this workspace; only a host acts on it
const KIND_NAME_REQUEST: &str = "NAME_REQUEST";
/// A version of the signed member list; any device may pass one on, and each takes it only if it is genuine and newer
const KIND_MEMBERSHIP: &str = "MEMBERSHIP";
/// The host telling guests whether the workspace needs the host online to be worked in; only accepted from the host
const KIND_POLICY_UPDATE: &str = "POLICY_UPDATE";
/// An Admin guest asking the host to change that; only delivered to the host
const KIND_POLICY_REQUEST: &str = "POLICY_REQUEST";
/// The host telling guests the workspace was deleted; accepted only from the host
const KIND_WORKSPACE_DELETED: &str = "WORKSPACE_DELETED";
/// The host offering a guest to take over hosting; accepted only from the host
const KIND_HOST_HANDOFF: &str = "HOST_HANDOFF";
/// The host telling guests where the new host is; accepted only from the host
const KIND_HOST_MOVED: &str = "HOST_MOVED";
/// A collaborator naming a version of a file, so the others keep it too; dropped from Viewer guests
const KIND_VERSION_NAMED: &str = "VERSION_NAMED";
/// Catch-up content for a note that was closed while apart; dropped from Viewer guests like live edits
const KIND_YDOC_UPDATE: &str = "YDOC_UPDATE";
/// An Admin guest asking the host to change someone's role; dropped from everyone else
const KIND_ROLE_REQUEST: &str = "ROLE_REQUEST";
/// Puts the sender's name on a message. The one exception is a guest hearing from the host, which already
/// stamped a relayed message with whoever sent it.
fn stamp_author(message: &mut serde_json::Value, sender: &str, sender_id: &str, keep_existing: bool) {
    let stamped = message.get("author").and_then(|a| a.as_str()).is_some_and(|a| !a.is_empty());
    if keep_existing && stamped {
        return;
    }
    message["author"] = serde_json::Value::String(sender.to_string());
    // The device key says who it was even when two people typed the same name; the app shows the member's name for it
    message["authorId"] = serde_json::Value::String(sender_id.to_string());
}

/// App messages a host forwards from one guest to the others. Yjs sync messages are included
/// so live co-editing reaches every guest even when the host has the document closed: guests
/// only ever connect to the host (a star topology), so without this a guest's edits would stop
/// at the host and never reach a third peer.
const RELAYED_KINDS: &[&str] = &[
    KIND_DATA_CHANGE,
    KIND_VERSION_NAMED,
    "ACTIVITY_EVENT",
    "SYNC_STEP_1",
    "SYNC_STEP_2",
    "SYNC_UPDATE",
    "AWARENESS_UPDATE",
    KIND_PRESENCE,
];

/// Whether a message from a guest is passed on to the others. Only the owner's device does: a message says who wrote it
/// because the device that received it directly stamped it, and a member relaying it would be credited as its author.
/// Members that are not the owner reach each other by direct links instead, which `member_loop` makes between all pairs.
fn should_relay(from_host: bool, hosting: bool, owner_is_elsewhere: bool, kind: &str) -> bool {
    !from_host && hosting && !owner_is_elsewhere && RELAYED_KINDS.contains(&kind)
}

/// Roles a host may grant through an invite
const INVITE_ROLES: &[&str] = &["Editor", "Viewer"];
/// Roles a guest can hold once the host has promoted or demoted them
const GUEST_ROLES: &[&str] = &["Admin", "Editor", "Viewer"];

/// Workspace folder this device shares with peers (`None` when no workspace is open)
type SharedWorkspace = Arc<Mutex<Option<String>>>;

/// Delivers a named event with a JSON payload to the frontend
pub type EventSink = Arc<dyn Fn(&'static str, serde_json::Value) + Send + Sync>;

/// Tauri-managed handle to the (lazily started) P2P node
#[derive(Default)]
pub struct P2pState {
    node: AsyncMutex<Option<Arc<Node>>>,
    workspace: SharedWorkspace,
    /// Latest role table, kept here so a node that starts later still enforces it
    roles: Mutex<Vec<(String, String)>>,
    /// Latest member list of the open workspace, likewise kept for a node that starts later
    known: Mutex<Option<KnownArgs>>,
}

/// Workspace id, workspace name, host name, and each member's device key with role
type KnownArgs = (String, String, String, Vec<(String, String)>);

impl P2pState {
    /// Returns the running node, starting the Iroh endpoint on first use
    pub async fn node(&self, app: &AppHandle) -> Result<Arc<Node>, String> {
        let mut guard = self.node.lock().await;
        if let Some(node) = guard.as_ref() {
            return Ok(node.clone());
        }
        // A missing or unwritable key file only costs a stable address, so fall back to a random key.
        let secret = identity(app);
        let proxy = crate::commands::config::load_config(app)
            .ok()
            .and_then(|c| crate::commands::config::parse_proxy_url(&c.proxy_url).ok().flatten());
        let app = app.clone();
        let events: EventSink = Arc::new(move |event, payload| {
            let _ = app.emit(event, payload);
        });
        let node = Node::start(events, self.workspace.clone(), secret, proxy).await?;
        node.set_roles(self.roles.lock().unwrap_or_else(|p| p.into_inner()).clone());
        node.reload_membership();
        if let Some((id, name, host, members)) = self.known.lock().unwrap_or_else(|p| p.into_inner()).clone() {
            node.set_known_members(id, name, host, members);
        }
        *guard = Some(node.clone());
        Ok(node)
    }

    /// Records who may come back without an invite and applies it to the running node, if there is one
    pub async fn set_known(&self, args: KnownArgs) {
        *self.known.lock().unwrap_or_else(|p| p.into_inner()) = Some(args.clone());
        if let Some(node) = self.existing().await {
            let (id, name, host, members) = args;
            node.set_known_members(id, name, host, members);
        }
    }

    /// Records the role table and applies it to the running node, if there is one
    pub async fn set_roles(&self, roles: Vec<(String, String)>) {
        *self.roles.lock().unwrap_or_else(|p| p.into_inner()) = roles.clone();
        if let Some(node) = self.existing().await {
            node.set_roles(roles);
        }
    }

    /// Returns the node only if it has already been started
    pub async fn existing(&self) -> Option<Arc<Node>> {
        self.node.lock().await.clone()
    }

    /// Sets the workspace shared with peers; takes effect without starting the network
    pub async fn set_workspace_path(&self, path: Option<String>) {
        *self.workspace.lock().unwrap_or_else(|p| p.into_inner()) = path.clone();
        if let Some(node) = self.existing().await {
            node.sync.watch(path.as_deref());
            node.reload_membership();
        }
    }
}

/// This device's identity key, or `None` if it can be neither read nor created. The app also signs writes with it.
pub(crate) fn identity(app: &AppHandle) -> Option<SecretKey> {
    app.path().app_data_dir().ok().and_then(|dir| load_or_create_identity(&dir.join("nexsync").join("p2p_identity.key")).ok())
}

/// Loads this device's P2P identity key, creating and saving one on first run.
///
/// The key lives in the operating system's credential store when there is one; a key file from an earlier
/// version is moved there and deleted. Without a store the file is used as before.
fn load_or_create_identity(path: &std::path::Path) -> std::io::Result<SecretKey> {
    if let Some(bytes) = super::vault::load() {
        return Ok(SecretKey::from_bytes(&bytes));
    }
    let from_file = std::fs::read(path).ok().and_then(|b| <[u8; 32]>::try_from(b.as_slice()).ok());
    let key = from_file.map(|b| SecretKey::from_bytes(&b)).unwrap_or_else(SecretKey::generate);
    if super::vault::store(&key.to_bytes()) {
        let _ = std::fs::remove_file(path);
    } else if from_file.is_none() {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(path, key.to_bytes())?;
    }
    Ok(key)
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
    /// When the invite stops working, if it expires
    pub expires_at: Option<u64>,
    pub single_use: bool,
}

/// Limits on who can use an invite and for how long
#[derive(Debug, Clone, Copy, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct InviteOptions {
    pub expires_in_secs: Option<u64>,
    pub single_use: bool,
}

/// The longest an invite may stay valid
const MAX_INVITE_SECS: u64 = 30 * 24 * 60 * 60;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JoinResult {
    pub peer_id: String,
    pub workspace_id: String,
    pub workspace_name: String,
    pub role: String,
    pub host_name: String,
    /// Where to find this host again, without the invite secret: a member the host knows can rejoin with it alone
    pub rejoin_ticket: String,
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
    /// Milliseconds since the Unix epoch after which the invite no longer admits anyone
    expires_at: Option<u64>,
    /// The invite stops working after one guest has joined with it
    single_use: bool,
    role: String,
    workspace_id: String,
    workspace_name: String,
    host_name: String,
}

/// Who a new peer is and how it is linked to us
struct PeerIdentity {
    name: String,
    role: String,
    is_host: bool,
    mesh: bool,
}

impl PeerIdentity {
    fn guest(name: String, role: String, mesh: bool) -> Self {
        Self { name, role, is_host: false, mesh }
    }
}

struct Peer {
    conn: Connection,
    outbox: mpsc::Sender<Vec<u8>>,
    name: String,
    role: String,
    is_host: bool,
    /// True for a link made directly between two guests rather than through the host
    mesh: bool,
    connected_at: u64,
}

#[derive(Default)]
struct NodeState {
    invite: Option<Invite>,
    /// Devices the host removed; they cannot join until the host creates a new invite
    blocked: std::collections::HashSet<String>,
    peers: HashMap<EndpointId, Peer>,
    /// Ticket and display name of the host we last joined, kept so a dropped link can be re-dialed
    last_join: Option<(String, String)>,
    /// The host we gave up re-dialing, kept so the user can retry by hand
    lost_host: Option<(String, String)>,
    reconnecting: bool,
    /// Roles the host has assigned by device key; these win over the role on the invite used to join
    roles: HashMap<String, String>,
    /// Other guests the host vouched for, keyed by device; a guest accepts a direct link only from these
    mesh_allow: HashMap<EndpointId, MeshAllow>,
    /// Host side: the token shared by each pair of guests
    mesh_tokens: mesh::MeshTokens,
    /// Who may come back without an invite, as the signed member list has it
    known: KnownMembers,
    /// The newest signed member list this device holds for the open workspace
    membership: Option<Membership>,
    /// The first list a host sent, kept until the workspace folder it belongs to exists
    pending_membership: Option<Membership>,
    /// Members being dialed right now, so one is not dialed twice
    dialing: std::collections::HashSet<EndpointId>,
}

/// The people already in a workspace, as the host's member list has them. A device on this list proves who it is with
/// its key when it connects, so it needs no invite to come back.
#[derive(Default, Clone)]
struct KnownMembers {
    workspace_id: String,
    workspace_name: String,
    host_name: String,
    /// Device key to role
    roles: HashMap<String, String>,
}

/// Whether this device can reach the relay that connects it to peers outside its own network
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct NetworkStatus {
    pub online: bool,
    /// Why the relay is unreachable; a firewall or proxy blocking it is the usual cause
    pub detail: Option<String>,
}

fn summarize(relays: &[RelayStatus]) -> NetworkStatus {
    let online = relays.iter().any(|r| r.is_connected());
    let detail = if online { None } else { relays.iter().find_map(|r| r.last_error().map(|e| e.to_string())) };
    NetworkStatus { online, detail }
}

/// The result of dialing a member by key alone
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Probe {
    pub reachable: bool,
    /// Time until a connection existed, or until giving up
    pub connect_ms: u64,
    /// "direct", "relay", or "none" when nothing connected
    pub path: &'static str,
    /// Time until the path became direct; empty if it stayed on the relay
    pub direct_after_ms: Option<u64>,
    pub rtt_ms: u64,
    pub error: Option<String>,
}

const PROBE_TIMEOUT: Duration = Duration::from_secs(15);
const PROBE_DIRECT_WAIT_MS: u64 = 3000;

#[derive(Debug, Clone, Serialize)]
struct Reconnecting {
    attempt: u32,
    max: u32,
}

pub struct Node {
    endpoint: Endpoint,
    /// This device's key, which signs the member list when this device owns the workspace
    secret: SecretKey,
    events: EventSink,
    workspace: SharedWorkspace,
    sync: LiveSync,
    state: Mutex<NodeState>,
    short_codes: ShortCodes,
}

impl Node {
    /// Binds the Iroh endpoint and spawns the accept, stats and live-sync loops
    async fn start(events: EventSink, workspace: SharedWorkspace, secret: Option<SecretKey>, proxy: Option<url::Url>) -> Result<Arc<Self>, String> {
        // Behind a proxy-only network the relay is reached through the proxy from Settings, else the one in HTTPS_PROXY
        let mut builder = Endpoint::builder(presets::N0).alpns(vec![wire::ALPN.to_vec()]);
        builder = match proxy {
            Some(url) => builder.proxy_url(url),
            None => builder.proxy_from_env(),
        };
        // Without a stored identity the device gets a key for this run, which still has to be kept to sign with
        let secret = secret.unwrap_or_else(SecretKey::generate);
        builder = builder.secret_key(secret.clone());
        let endpoint = builder
            .bind()
            .await
            .map_err(|e| format!("Couldn't start collaboration: {e}"))?;

        let (live_sync, local_changes) = LiveSync::new();
        let node = Arc::new(Self {
            endpoint,
            secret,
            events,
            workspace,
            sync: live_sync,
            state: Mutex::new(NodeState::default()),
            short_codes: ShortCodes::default(),
        });

        tokio::spawn(node.clone().accept_loop());
        tokio::spawn(node.clone().stats_loop());
        tokio::spawn(node.clone().network_loop());
        tokio::spawn(node.clone().member_loop());
        tokio::spawn(sync::run_local_changes(node.clone(), local_changes));
        node.sync.watch(node.workspace_path().as_deref());
        Ok(node)
    }

    pub(super) fn endpoint(&self) -> &Endpoint {
        &self.endpoint
    }

    pub(super) fn short_codes(&self) -> &ShortCodes {
        &self.short_codes
    }

    pub fn sync(&self) -> &LiveSync {
        &self.sync
    }

    /// Whether a connected peer is the host we joined, or `None` if it isn't connected
    pub fn peer_is_host(&self, peer_id: &str) -> Option<bool> {
        let id = parse_peer_id(peer_id).ok()?;
        self.lock().peers.get(&id).map(|p| p.is_host)
    }

    /// This device's own key, which hosts record as the device's identity in the member list
    pub fn self_id(&self) -> String {
        self.endpoint.id().to_string()
    }

    /// Replaces the roles the host has assigned by device key and applies them to connected guests
    pub fn set_roles(self: &Arc<Self>, roles: Vec<(String, String)>) {
        let roles: HashMap<String, String> = roles
            .into_iter()
            .filter(|(_, role)| GUEST_ROLES.contains(&role.as_str()))
            .collect();
        let mut st = self.lock();
        for (id, peer) in st.peers.iter_mut() {
            if peer.is_host {
                continue;
            }
            if let Some(role) = roles.get(&id.to_string()) {
                peer.role = role.clone();
            }
        }
        st.roles = roles;
        drop(st);
        // Guests hold each other's roles too, so they hear about the change.
        self.broadcast_mesh();
    }

    pub fn has_peers(&self) -> bool {
        !self.lock().peers.is_empty()
    }

    /// Hosts accept file changes from Editor guests only; guests always accept the host's
    pub fn peer_may_write(&self, peer_id: &str) -> bool {
        let Ok(id) = parse_peer_id(peer_id) else { return false };
        self.lock()
            .peers
            .get(&id)
            .is_some_and(|p| p.is_host || p.role != "Viewer")
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
        self.create_invite_with(role, workspace_id, workspace_name, host_name, InviteOptions::default()).await
    }

    /// Like `create_invite`, with an optional expiry and single use
    pub async fn create_invite_with(
        &self,
        role: String,
        workspace_id: String,
        workspace_name: String,
        host_name: String,
        options: InviteOptions,
    ) -> Result<InviteInfo, String> {
        if !INVITE_ROLES.contains(&role.as_str()) {
            return Err(format!("Invalid invite role: {role}"));
        }
        if options.expires_in_secs.is_some_and(|s| s == 0 || s > MAX_INVITE_SECS) {
            return Err("An invite can last from one second to 30 days.".to_string());
        }
        let expires_at = options.expires_in_secs.map(|s| now_ms() + s * 1000);

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

        let mut st = self.lock();
        // A new invite is a fresh decision by the host, so earlier removals no longer stand
        st.blocked.clear();
        st.invite = Some(Invite {
            secret,
            expires_at,
            single_use: options.single_use,
            role,
            workspace_id,
            workspace_name,
            host_name,
        });
        drop(st);

        Ok(InviteInfo {
            ticket,
            relay_connected,
            expires_at,
            single_use: options.single_use,
        })
    }

    /// Stops accepting new guests; already connected peers stay connected
    pub fn revoke_invite(&self) {
        self.lock().invite = None;
        self.short_codes.cancel();
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

        // A guest the host vouched for shows the token from the host instead of an invite secret.
        let mesh_peer = (hello.v == wire::PROTOCOL_VERSION)
            .then(|| self.check_mesh(&hello.secret, &conn.remote_id()))
            .flatten();
        let mut member_link = false;
        let verdict = if hello.v != wire::PROTOCOL_VERSION {
            Err("You're running a different version of Nexsync than the host. Update both apps and try again.".to_string())
        } else if let Some(allow) = &mesh_peer {
            Ok(HandshakeReply::Welcome {
                v: wire::PROTOCOL_VERSION,
                host_name: String::new(),
                role: allow.role.clone(),
                workspace_id: String::new(),
                workspace_name: String::new(),
            })
        } else if let Some(welcome) = self.check_known_member(&conn.remote_id()) {
            // A device that is not the owner and is let in as a member is another member's direct link, not a guest of a host
            member_link = self.is_not_owner();
            Ok(welcome)
        } else {
            self.check_invite(&hello.secret, &conn.remote_id())
        };

        match verdict {
            Ok(welcome) => {
                let HandshakeReply::Welcome { role, .. } = &welcome else {
                    unreachable!("check_invite only returns Welcome on success")
                };
                let role = role.clone();
                wire::write_json(&mut send, &welcome).await?;
                match mesh_peer {
                    Some(allow) => self.register_peer(conn, send, recv, PeerIdentity::guest(allow.name, role, true)),
                    None => self.register_peer(conn, send, recv, PeerIdentity::guest(sanitize_name(&hello.name), role, member_link)),
                }
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

    #[cfg(test)]
    fn membership_epoch(&self) -> Option<u64> {
        self.lock().membership.as_ref().map(|m| m.epoch)
    }

    /// Whether the member list this device holds names another device as the owner
    fn is_not_owner(&self) -> bool {
        let mine = self.endpoint.id().to_string();
        self.lock().membership.as_ref().is_some_and(|m| m.owner != mine)
    }

    /// The guest entry if `id` was vouched for by the host and presented the right token
    fn check_mesh(&self, presented: &str, id: &EndpointId) -> Option<MeshAllow> {
        let st = self.lock();
        let allow = st.mesh_allow.get(id)?;
        let presented = ticket::decode_secret(presented)?;
        bool::from(presented.ct_eq(&allow.token)).then(|| allow.clone())
    }

    /// The owner says who the members are, and signs that as the next version of the list; call it whenever the member
    /// list changes, so a removed member stops being let in at once. A device that is not the owner has nothing to say
    /// here: it takes the list from the owner's signed versions instead.
    pub fn set_known_members(self: &Arc<Self>, workspace_id: String, workspace_name: String, host_name: String, members: Vec<(String, String)>) {
        let members: Vec<(String, String)> = members.into_iter().filter(|(_, role)| GUEST_ROLES.contains(&role.as_str())).collect();
        let current = {
            let mut st = self.lock();
            st.known.host_name = host_name;
            st.membership.clone()
        };
        match membership::next(current.as_ref(), &self.secret, &workspace_id, &workspace_name, members) {
            Ok(Some(doc)) => {
                self.install_membership(doc, true);
                self.push_membership(None, None);
            }
            Ok(None) => {}
            Err(e) => eprintln!("[P2P] Not publishing the member list: {e}"),
        }
    }

    /// Takes the list stored with the open workspace, or none when there is none; called when the workspace changes
    pub fn reload_membership(self: &Arc<Self>) {
        let loaded = self.workspace_path().and_then(|path| membership::load(&path));
        let mut st = self.lock();
        match loaded {
            Some(m) => {
                st.known.workspace_id = m.workspace_id.clone();
                st.known.workspace_name = m.workspace_name.clone();
                st.known.roles = m.roles();
                st.membership = Some(m);
            }
            None => {
                st.known.workspace_id.clear();
                st.known.roles.clear();
                st.membership = None;
            }
        }
    }

    /// Makes `m` the list this device acts on: who may come in, with which role, and who has to go
    fn install_membership(self: &Arc<Self>, m: Membership, persist: bool) {
        if persist {
            if let Some(path) = self.workspace_path() {
                if let Err(e) = membership::store(&path, &m) {
                    eprintln!("[P2P] Could not keep the member list with the workspace: {e}");
                }
            }
        }
        let roles = m.roles();
        let mut removed_now = Vec::new();
        {
            let mut st = self.lock();
            st.known.workspace_id = m.workspace_id.clone();
            st.known.workspace_name = m.workspace_name.clone();
            st.known.roles = roles.clone();
            for (id, peer) in st.peers.iter_mut() {
                if peer.is_host {
                    continue;
                }
                let key = id.to_string();
                match roles.get(&key) {
                    Some(role) => peer.role = role.clone(),
                    None if m.removed.contains(&key) => removed_now.push(key),
                    None => {}
                }
            }
            if st.pending_membership.as_ref().is_some_and(|p| p.workspace_id == m.workspace_id) {
                st.pending_membership = Some(m.clone());
            }
            st.membership = Some(m);
        }
        // Whoever was removed is sent away at once, whichever device found out first
        for id in removed_now {
            let _ = self.disconnect(&id);
        }
    }

    /// Sends this device's list to one peer, or to all but `except`; a device that is behind then catches up, and a
    /// version the owner just signed spreads to every member that is online
    fn push_membership(&self, to: Option<EndpointId>, except: Option<EndpointId>) {
        let Some(doc) = self.lock().membership.clone() else { return };
        let message = serde_json::json!({ "kind": KIND_MEMBERSHIP, "timestamp": now_ms(), "payload": serde_json::to_string(&doc).unwrap_or_default() });
        let Ok(bytes) = serde_json::to_vec(&message) else { return };
        let outboxes: Vec<mpsc::Sender<Vec<u8>>> = self
            .lock()
            .peers
            .iter()
            .filter(|(id, _)| to.is_none_or(|t| **id == t) && except.is_none_or(|e| **id != e))
            .map(|(_, p)| p.outbox.clone())
            .collect();
        if outboxes.is_empty() {
            return;
        }
        tokio::spawn(async move {
            for outbox in outboxes {
                let _ = outbox.send(bytes.clone()).await;
            }
        });
    }

    /// A peer sent a version of the member list. It is taken only if it is genuine and newer; a peer that sent an older
    /// one is sent ours.
    fn on_membership(self: &Arc<Self>, from: &EndpointId, message: &serde_json::Value) {
        let Some(doc) = message.get("payload").and_then(|p| p.as_str()).and_then(|p| serde_json::from_str::<Membership>(p).ok()) else {
            return;
        };
        let (current, from_is_host) = {
            let st = self.lock();
            (st.membership.clone(), st.peers.get(from).is_some_and(|p| p.is_host))
        };
        let verdict = match &current {
            // With nothing yet, a list is believed only from the host that was dialed, and only if it names that host
            None => membership::accept(None, &doc).and_then(|_| {
                if from_is_host && doc.owner == from.to_string() {
                    Ok(())
                } else {
                    Err("a first list from somebody other than the host".to_string())
                }
            }),
            Some(cur) => membership::accept(Some(cur), &doc),
        };
        match verdict {
            Ok(()) => {
                if current.is_none() {
                    self.lock().pending_membership = Some(doc.clone());
                }
                self.install_membership(doc, true);
                self.push_membership(None, Some(*from));
            }
            Err(reason) => {
                let behind = current.as_ref().is_some_and(|c| c.workspace_id == doc.workspace_id && doc.epoch < c.epoch) && doc.verify().is_ok();
                if behind {
                    self.push_membership(Some(*from), None);
                } else {
                    eprintln!("[P2P] Ignoring a member list from {}: {reason}", from.fmt_short());
                }
            }
        }
    }

    /// A joined copy was just created from the host's workspace: keep the list the host sent with it. The list arrives
    /// when the connection is made, which can be before there is a workspace folder to keep it in.
    pub fn adopt_membership(self: &Arc<Self>, workspace: &str, host_workspace_id: &str) -> bool {
        let doc = {
            let st = self.lock();
            st.membership.clone().into_iter().chain(st.pending_membership.clone()).find(|m| m.workspace_id == host_workspace_id)
        };
        let Some(doc) = doc else { return false };
        if let Err(e) = membership::store(workspace, &doc) {
            eprintln!("[P2P] Could not keep the member list with the workspace: {e}");
            return false;
        }
        if self.workspace_path().as_deref() == Some(workspace) {
            self.reload_membership();
        }
        true
    }

    /// The owner makes another device the owner; the new owner and everyone else learn it from the signed list
    pub fn hand_off_membership(self: &Arc<Self>, new_owner: &str) -> Result<(), String> {
        let current = self.lock().membership.clone().ok_or("There is no member list to hand over.")?;
        let doc = membership::hand_off(&current, &self.secret, new_owner)?;
        self.install_membership(doc, true);
        self.push_membership(None, None);
        Ok(())
    }

    /// Members this device should be linked to and is not. Only while a workspace is open, and only by a member that is
    /// not the owner: the owner is dialed, it does not dial. Of any two members only the one with the smaller key dials,
    /// so they do not both try at once.
    /// The owner's running device signs a fresh version of the list every few hours, so the others' leases do not run out
    /// while it is online
    fn refresh_lease(self: &Arc<Self>) {
        let Some(current) = self.lock().membership.clone() else { return };
        if self.workspace_path().is_none() {
            return;
        }
        if let Some(doc) = membership::refresh(&current, &self.secret, now_ms()) {
            self.install_membership(doc, true);
            self.push_membership(None, None);
        }
    }

    /// A device whose own list has run out lets go of the direct links it made on the strength of it
    fn drop_stale_links(self: &Arc<Self>) {
        let mine = self.endpoint.id().to_string();
        let stale: Vec<String> = {
            let st = self.lock();
            match &st.membership {
                Some(m) if !m.vouches(&mine, now_ms()) => st.peers.iter().filter(|(_, p)| p.mesh && !p.is_host).map(|(id, _)| id.to_string()).collect(),
                _ => Vec::new(),
            }
        };
        for id in stale {
            let _ = self.disconnect(&id);
        }
    }

    fn member_targets(&self) -> Vec<EndpointId> {
        if self.workspace_path().is_none() {
            return Vec::new();
        }
        let mine = self.endpoint.id().to_string();
        let mut st = self.lock();
        let Some(m) = &st.membership else { return Vec::new() };
        if m.owner == mine || m.role_of(&mine).is_none() || m.lease_expired(now_ms()) {
            return Vec::new();
        }
        let ids: Vec<EndpointId> = m
            .members
            .iter()
            .filter(|(id, _)| mine < *id)
            .filter_map(|(id, _)| parse_peer_id(id).ok())
            .filter(|id| !st.peers.contains_key(id) && !st.dialing.contains(id))
            .take(MEMBER_DIAL_PARALLEL)
            .collect();
        st.dialing.extend(ids.iter().copied());
        ids
    }

    /// Looks for the other members by key every so often, which is what keeps a workspace working when the host is away
    async fn member_loop(self: Arc<Self>) {
        tokio::time::sleep(Duration::from_secs(2)).await;
        loop {
            self.refresh_lease();
            self.drop_stale_links();
            for id in self.member_targets() {
                tokio::spawn(self.clone().dial_member(id));
            }
            tokio::time::sleep(MEMBER_DIAL_EVERY).await;
        }
    }

    async fn dial_member(self: Arc<Self>, id: EndpointId) {
        let result = self.try_dial_member(id).await;
        self.lock().dialing.remove(&id);
        // A member that is not online has no address to find, which is the usual and quiet case
        if let Err(e) = result {
            eprintln!("[P2P] No link to member {}: {e}", id.fmt_short());
        }
    }

    async fn try_dial_member(self: &Arc<Self>, id: EndpointId) -> Result<(), String> {
        let (workspace_id, role) = {
            let st = self.lock();
            let m = st.membership.as_ref().ok_or("no member list")?;
            (m.workspace_id.clone(), m.role_of(&id.to_string()).ok_or("not a member")?.to_string())
        };
        let conn = tokio::time::timeout(MEMBER_CONNECT_TIMEOUT, self.endpoint.connect(EndpointAddr::new(id), wire::ALPN))
            .await
            .map_err(|_| "no answer".to_string())?
            .map_err(|e| e.to_string())?;
        let (mut send, mut recv) = conn.open_bi().await.map_err(|e| e.to_string())?;
        send.write_all(&[wire::STREAM_CONTROL]).await.map_err(|e| e.to_string())?;
        // No secret: the other device knows this one's key from the member list
        wire::write_json(
            &mut send,
            &Hello { v: wire::PROTOCOL_VERSION, secret: ticket::encode_secret(&[0u8; SECRET_LEN]), name: "Member".to_string() },
        )
        .await?;
        let reply: HandshakeReply = tokio::time::timeout(HANDSHAKE_TIMEOUT, wire::read_json(&mut recv, wire::MAX_SMALL_FRAME))
            .await
            .map_err(|_| "no answer".to_string())??;
        match reply {
            HandshakeReply::Welcome { workspace_id: theirs, .. } if theirs == workspace_id => {
                self.register_peer(conn, send, recv, PeerIdentity::guest("Member".to_string(), role, true));
                Ok(())
            }
            HandshakeReply::Welcome { .. } => {
                conn.close(CLOSE_REJECTED.into(), b"another workspace");
                Err("that device is sharing another workspace".into())
            }
            HandshakeReply::Reject { error } => {
                conn.close(CLOSE_REJECTED.into(), b"rejected");
                Err(error)
            }
        }
    }

    /// Welcomes a device the host already has as a member. The connection has proved the device's key, so nothing else
    /// is asked of it; a device the host removed, or one it does not know, goes on to the invite check.
    fn check_known_member(&self, guest: &EndpointId) -> Option<HandshakeReply> {
        let st = self.lock();
        let id = guest.to_string();
        if st.blocked.contains(&id) || st.known.workspace_id.is_empty() {
            return None;
        }
        // A device that is not the owner and has not had a fresh list for a day does not vouch for anyone: it may have missed
        // a removal, and this is what stops it being a way back in for the removed
        if st.membership.as_ref().is_some_and(|m| !m.vouches(&self.endpoint.id().to_string(), now_ms())) {
            return None;
        }
        let role = st.roles.get(&id).or_else(|| st.known.roles.get(&id))?.clone();
        Some(HandshakeReply::Welcome {
            v: wire::PROTOCOL_VERSION,
            host_name: st.known.host_name.clone(),
            role,
            workspace_id: st.known.workspace_id.clone(),
            workspace_name: st.known.workspace_name.clone(),
        })
    }

    fn check_invite(&self, presented: &str, guest: &EndpointId) -> Result<HandshakeReply, String> {
        let mut st = self.lock();
        if st.blocked.contains(&guest.to_string()) {
            return Err("The host has removed you from this workspace.".into());
        }
        let invite = st
            .invite
            .as_ref()
            .ok_or("The host isn't accepting new collaborators right now. Ask them for a new invite.")?;
        let presented = ticket::decode_secret(presented).unwrap_or([0u8; SECRET_LEN]);
        if !bool::from(presented.ct_eq(&invite.secret)) {
            return Err("This invite has expired or been replaced. Ask the host for a new one.".into());
        }
        if invite.expires_at.is_some_and(|t| now_ms() >= t) {
            return Err("This invite has expired. Ask the host for a new one.".into());
        }
        // A device the host already assigned a role keeps it, whatever the invite says
        let role = st.roles.get(&guest.to_string()).unwrap_or(&invite.role).clone();
        let reply = HandshakeReply::Welcome {
            v: wire::PROTOCOL_VERSION,
            host_name: invite.host_name.clone(),
            role,
            workspace_id: invite.workspace_id.clone(),
            workspace_name: invite.workspace_name.clone(),
        };
        if invite.single_use {
            st.invite = None;
        }
        Ok(reply)
    }

    /// Disconnects a guest and refuses it until the host creates a new invite
    pub fn block_device(self: &Arc<Self>, device_id: &str) -> Result<(), String> {
        parse_peer_id(device_id)?;
        self.lock().blocked.insert(device_id.to_string());
        self.disconnect(device_id)
    }

    // ────────────────────────────
    // Joining
    // ────────────────────────────

    /// Dials the host named in `ticket_str` and completes the invite handshake
    pub async fn join(self: &Arc<Self>, ticket_str: &str, display_name: &str) -> Result<JoinResult, String> {
        self.join_impl(ticket_str, display_name).await.map_err(|(error, _)| error)
    }

    /// Like [`Node::join`], but the error also says whether retrying can never succeed
    async fn join_impl(self: &Arc<Self>, ticket_str: &str, display_name: &str) -> Result<JoinResult, (String, bool)> {
        let ticket = Ticket::decode(ticket_str).map_err(|e| (e, true))?;
        let host_id = ticket.addr.id;
        // The same address with the invite secret left out, to keep for coming back
        let rejoin_ticket = Ticket { addr: ticket.addr.clone(), secret: [0u8; SECRET_LEN] }.encode();
        if host_id == self.endpoint.id() {
            return Err(("That invite was created on this device. Share it with your collaborator instead.".into(), true));
        }

        let conn = tokio::time::timeout(CONNECT_TIMEOUT, self.endpoint.connect(ticket.addr, wire::ALPN))
            .await
            .map_err(|_| ("Timed out reaching the host. Make sure they're online and still have Nexsync open.".to_string(), false))?
            .map_err(|e| {
                eprintln!("[P2P] Could not reach the host: {e}");
                ("Couldn't reach the host. Check that you are both online.".to_string(), false)
            })?;

        let (mut send, mut recv) = conn.open_bi().await.map_err(|e| (e.to_string(), false))?;
        send.write_all(&[wire::STREAM_CONTROL]).await.map_err(|e| (e.to_string(), false))?;
        wire::write_json(
            &mut send,
            &Hello {
                v: wire::PROTOCOL_VERSION,
                secret: ticket::encode_secret(&ticket.secret),
                name: sanitize_name(display_name),
            },
        )
        .await
        .map_err(|e| (e, false))?;

        let reply: HandshakeReply = tokio::time::timeout(
            HANDSHAKE_TIMEOUT,
            wire::read_json(&mut recv, wire::MAX_SMALL_FRAME),
        )
        .await
        .map_err(|_| ("The host didn't answer the invite in time.".to_string(), false))?
        .map_err(|e| (e, false))?;

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
                    return Err(("The host is running a different version of Nexsync. Update both apps and try again.".into(), true));
                }
                let host_name = sanitize_name(&host_name);
                self.lock().last_join = Some((ticket_str.to_string(), display_name.to_string()));
                self.register_peer(conn, send, recv, PeerIdentity { name: host_name.clone(), role: role.clone(), is_host: true, mesh: false });
                Ok(JoinResult {
                    peer_id: host_id.to_string(),
                    workspace_id,
                    workspace_name,
                    role,
                    host_name,
                    rejoin_ticket,
                })
            }
            HandshakeReply::Reject { error } => {
                conn.close(CLOSE_REJECTED.into(), b"rejected");
                Err((error, true))
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
        who: PeerIdentity,
    ) {
        let PeerIdentity { name, role, is_host, mesh } = who;
        let id = conn.remote_id();
        let (outbox, rx) = mpsc::channel(OUTBOX_CAPACITY);
        let peer = Peer {
            conn: conn.clone(),
            outbox,
            name,
            role,
            is_host,
            mesh,
            connected_at: now_ms(),
        };
        let info = peer_info(&id, &peer);

        let replaced = {
            let mut st = self.lock();
            // A direct guest link never displaces a connection we already have, such as the one to the host.
            if mesh && st.peers.contains_key(&id) {
                drop(st);
                conn.close(CLOSE_REPLACED.into(), b"already connected");
                return;
            }
            st.peers.insert(id, peer)
        };
        if let Some(old) = replaced {
            old.conn.close(CLOSE_REPLACED.into(), b"replaced by a newer connection");
        }

        // Announce the peer before reading from it, so the UI never sees a message from an unknown peer
        self.emit(EVENT_PEER_JOINED, &info);
        self.emit_peers();
        if !mesh {
            self.broadcast_mesh();
        }

        tokio::spawn(write_loop(send, rx));
        tokio::spawn(self.clone().run_peer(conn, recv));
        tokio::spawn(sync::send_catch_up(self.clone(), id.to_string()));
        // Each side tells the other which version of the member list it holds, so whichever is behind catches up
        self.push_membership(Some(id), None);
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
        let was_host = self.remove_peer(&id, conn.stable_id());
        // Once nobody is connected, later local edits count as changes made while apart.
        if !self.has_peers() {
            if let Some(workspace) = self.workspace_path() {
                sync::mark_synced(&workspace);
            }
        }
        if was_host {
            self.start_reconnect();
        }
    }

    /// Re-dials the host after an unexpected drop, backing off between attempts
    fn start_reconnect(self: &Arc<Self>) {
        {
            let mut st = self.lock();
            if st.last_join.is_none() || st.reconnecting {
                return;
            }
            st.reconnecting = true;
        }
        let node = self.clone();
        tokio::spawn(async move {
            let mut delay = Duration::from_secs(2);
            for attempt in 1..=RECONNECT_ATTEMPTS {
                node.emit(EVENT_RECONNECTING, Reconnecting { attempt, max: RECONNECT_ATTEMPTS });
                tokio::time::sleep(delay).await;
                // The user disconnecting on purpose clears the saved ticket and ends the loop.
                let Some((ticket, name)) = node.lock().last_join.clone() else { break };
                match node.join_impl(&ticket, &name).await {
                    Ok(_) => {
                        node.lock().reconnecting = false;
                        return;
                    }
                    Err((_, true)) => break,
                    Err((_, false)) => delay = (delay * 2).min(RECONNECT_MAX_DELAY),
                }
            }
            let mut st = node.lock();
            st.reconnecting = false;
            st.lost_host = st.last_join.take();
            drop(st);
            node.emit(EVENT_RECONNECT_FAILED, ());
        });
    }

    /// Current relay reachability, for a frontend that starts listening after the first change
    pub fn network_status(&self) -> NetworkStatus {
        summarize(&self.endpoint.home_relay_status().get())
    }

    /// Tells Iroh the OS network changed (WiFi toggled, VPN, new network) so it re-probes at once
    pub async fn network_change(&self) {
        self.endpoint.network_change().await;
    }

    /// Reports every change in relay reachability, and re-dials a lost host as soon as the network is back
    async fn network_loop(self: Arc<Self>) {
        let mut watcher = self.endpoint.home_relay_status();
        let mut last: Option<NetworkStatus> = None;
        loop {
            let status = summarize(&watcher.get());
            if last.as_ref() != Some(&status) {
                let came_back = status.online && last.as_ref().is_some_and(|l| !l.online);
                self.emit(EVENT_NETWORK, status.clone());
                last = Some(status);
                if came_back {
                    let _ = self.retry_connection();
                }
            }
            if watcher.updated().await.is_err() {
                break;
            }
        }
    }

    /// Manual retry after the automatic attempts gave up (or while they are backing off)
    pub fn retry_connection(self: &Arc<Self>) -> Result<(), String> {
        {
            let mut st = self.lock();
            if st.reconnecting || st.peers.values().any(|p| p.is_host) {
                return Ok(());
            }
            if st.last_join.is_none() {
                st.last_join = st.lost_host.take();
            }
            if st.last_join.is_none() {
                return Err("There is no host to reconnect to. Join again with an invite or code.".into());
            }
        }
        self.start_reconnect();
        Ok(())
    }

    fn dispatch_message(self: &Arc<Self>, from: &EndpointId, bytes: &[u8]) {
        let mut message: serde_json::Value = match serde_json::from_slice(bytes) {
            Ok(value) => value,
            Err(_) => {
                eprintln!("[P2P] Dropping non-JSON message from {}", from.fmt_short());
                return;
            }
        };
        let Some(kind) = message.get("kind").and_then(|k| k.as_str()) else {
            eprintln!("[P2P] Dropping message without a kind from {}", from.fmt_short());
            return;
        };

        // Who else is in the workspace is decided by the host and handled here
        if kind == mesh::KIND_MESH_STATE {
            if self.peer_is_host(&from.to_string()) == Some(true) {
                if let Ok(state) = serde_json::from_value::<mesh::MeshState>(message) {
                    self.handle_mesh_state(state);
                }
            }
            return;
        }

        // Who belongs to the workspace is settled by signed lists, which the backend checks itself
        if kind == KIND_MEMBERSHIP {
            self.on_membership(from, &message);
            return;
        }

        // File sync is handled entirely in the backend
        if SyncMessage::is_sync_kind(kind) {
            match serde_json::from_value::<SyncMessage>(message) {
                Ok(sync_message) => {
                    tokio::spawn(sync::handle_remote(self.clone(), from.to_string(), sync_message));
                }
                Err(_) => eprintln!("[P2P] Dropping malformed file sync message from {}", from.fmt_short()),
            }
            return;
        }

        let kind = kind.to_owned();
        let Some((from_host, may_write, is_admin, hosting, sender)) = ({
            let st = self.lock();
            st.peers.get(from).map(|p| {
                (p.is_host, p.is_host || p.role != "Viewer", p.role == "Admin", is_hosting(&st), p.name.clone())
            })
        }) else {
            return;
        };
        match kind.as_str() {
            KIND_DATA_CHANGE | KIND_VERSION_NAMED if !may_write => {
                eprintln!("[P2P] Ignoring a change from Viewer {}", from.fmt_short());
                return;
            }
            // A Viewer's readOnly editor is a UI nicety, not a security boundary: a modified
            // client could still send raw Yjs updates, so the host must drop them itself. Sync
            // step 1/2 (state-vector handshake, no content) and presence stay allowed.
            "SYNC_UPDATE" | KIND_YDOC_UPDATE if !may_write => {
                eprintln!("[P2P] Ignoring a Yjs update from Viewer {}", from.fmt_short());
                return;
            }
            // Only the host decides who is in the workspace
            KIND_MEMBERS_UPDATE | KIND_RULES_UPDATE | KIND_POLICY_UPDATE | KIND_WORKSPACE_DELETED | KIND_HOST_HANDOFF | KIND_HOST_MOVED if !from_host => return,
            // Only Admin guests may ask for role changes, and only a host acts on them
            KIND_NAME_REQUEST if from_host || !hosting => return,
            KIND_ROLE_REQUEST | KIND_POLICY_REQUEST if from_host || !is_admin || !hosting => {
                eprintln!("[P2P] Ignoring a role request from {}", from.fmt_short());
                return;
            }
            _ => {}
        }
        // Only the host passes changes on; guests linked directly to each other would otherwise loop them
        // Who named a version is decided here, not by the sender, so nobody can sign as someone else
        let mut relayed = bytes.to_vec();
        // The same goes for note text: the catch-up review credits a change to whoever it says sent it
        if matches!(kind.as_str(), KIND_VERSION_NAMED | KIND_YDOC_UPDATE | "SYNC_UPDATE" | "SYNC_STEP_2" | KIND_PRESENCE) {
            stamp_author(&mut message, &sender, &from.to_string(), from_host && !hosting);
            relayed = serde_json::to_vec(&message).unwrap_or(relayed);
        }
        if should_relay(from_host, hosting, self.is_not_owner(), &kind) {
            self.relay(from, relayed);
        }

        self.emit(
            EVENT_MESSAGE,
            IncomingMessage {
                peer_id: from.to_string(),
                message,
            },
        );
    }

    /// Host only: tells every guest about the other guests so they can link up directly
    fn broadcast_mesh(&self) {
        let sends: Vec<(mpsc::Sender<Vec<u8>>, Vec<u8>)> = {
            let mut st = self.lock();
            if !is_hosting(&st) {
                return;
            }
            let rows: Vec<(mesh::GuestRow, mpsc::Sender<Vec<u8>>)> = st
                .peers
                .iter()
                .filter(|(_, p)| !p.mesh)
                .map(|(id, p)| {
                    let row = mesh::GuestRow {
                        id: id.to_string(),
                        name: p.name.clone(),
                        role: p.role.clone(),
                        connected_at: p.connected_at,
                    };
                    (row, p.outbox.clone())
                })
                .collect();
            let all: Vec<mesh::GuestRow> = rows.iter().map(|(row, _)| row.clone()).collect();
            rows.into_iter()
                .filter_map(|(row, outbox)| {
                    let state = mesh::state_for(&row, &all, &mut st.mesh_tokens);
                    serde_json::to_vec(&state).ok().map(|bytes| (outbox, bytes))
                })
                .collect()
        };
        tokio::spawn(async move {
            for (outbox, bytes) in sends {
                let _ = outbox.send(bytes).await;
            }
        });
    }

    /// Guest side: remembers who the host vouched for, dials those we should, and drops any that left
    fn handle_mesh_state(self: &Arc<Self>, state: mesh::MeshState) {
        let me = self.endpoint.id();
        let mut to_dial = Vec::new();
        let mut dropped = Vec::new();
        {
            let mut st = self.lock();
            let mut allowed = HashMap::new();
            for entry in state.peers {
                let Ok(id) = entry.id.parse::<EndpointId>() else { continue };
                let Some(token) = ticket::decode_secret(&entry.token) else { continue };
                if id == me {
                    continue;
                }
                let role = if GUEST_ROLES.contains(&entry.role.as_str()) { entry.role } else { "Viewer".to_string() };
                let allow = MeshAllow { token, name: sanitize_name(&entry.name), role };
                match st.peers.get_mut(&id) {
                    Some(peer) if !peer.is_host => peer.role = allow.role.clone(),
                    Some(_) => {}
                    None if entry.dial => to_dial.push((id, allow.clone())),
                    None => {}
                }
                allowed.insert(id, allow);
            }
            for (id, peer) in st.peers.iter() {
                if peer.mesh && !allowed.contains_key(id) {
                    dropped.push(peer.conn.clone());
                }
            }
            st.mesh_allow = allowed;
        }
        for conn in dropped {
            conn.close(CLOSE_NORMAL.into(), b"left the workspace");
        }
        for (id, allow) in to_dial {
            tokio::spawn(self.clone().dial_mesh(id, allow));
        }
    }

    /// Opens a direct link to another guest, retrying a few times while the other side hears about us
    async fn dial_mesh(self: Arc<Self>, id: EndpointId, allow: MeshAllow) {
        for attempt in 0..MESH_DIAL_ATTEMPTS {
            if attempt > 0 {
                tokio::time::sleep(MESH_DIAL_DELAY).await;
            }
            {
                let st = self.lock();
                if st.peers.contains_key(&id) || !st.mesh_allow.contains_key(&id) {
                    return;
                }
            }
            match self.try_dial_mesh(id, &allow).await {
                Ok(()) => return,
                Err(e) => eprintln!("[P2P] Could not link to guest {}: {e}", id.fmt_short()),
            }
        }
    }

    async fn try_dial_mesh(self: &Arc<Self>, id: EndpointId, allow: &MeshAllow) -> Result<(), String> {
        let conn = tokio::time::timeout(CONNECT_TIMEOUT, self.endpoint.connect(EndpointAddr::new(id), wire::ALPN))
            .await
            .map_err(|_| "timed out".to_string())?
            .map_err(|e| e.to_string())?;
        let (mut send, mut recv) = conn.open_bi().await.map_err(|e| e.to_string())?;
        send.write_all(&[wire::STREAM_CONTROL]).await.map_err(|e| e.to_string())?;
        wire::write_json(
            &mut send,
            &Hello {
                v: wire::PROTOCOL_VERSION,
                secret: ticket::encode_secret(&allow.token),
                name: "Guest".to_string(),
            },
        )
        .await?;
        let reply: HandshakeReply =
            tokio::time::timeout(HANDSHAKE_TIMEOUT, wire::read_json(&mut recv, wire::MAX_SMALL_FRAME))
                .await
                .map_err(|_| "no answer".to_string())??;
        match reply {
            HandshakeReply::Welcome { .. } => {
                self.register_peer(conn, send, recv, PeerIdentity::guest(allow.name.clone(), allow.role.clone(), true));
                Ok(())
            }
            HandshakeReply::Reject { error } => {
                conn.close(CLOSE_REJECTED.into(), b"rejected");
                Err(error)
            }
        }
    }

    /// Phase 0 of syncing without the host: can this device reach another member from nothing but its key? Dials it,
    /// notes how long that took and whether the path is direct or through a relay, then hangs up without a handshake.
    pub async fn probe_member(self: &Arc<Self>, device_id: &str) -> Result<Probe, String> {
        let id = parse_peer_id(device_id)?;
        if id == self.endpoint.id() {
            return Err("That is this device.".into());
        }
        let started = std::time::Instant::now();
        let ms = |t: std::time::Instant| t.elapsed().as_millis() as u64;
        let failed = |error: String| Probe { reachable: false, connect_ms: ms(started), path: "none", direct_after_ms: None, rtt_ms: 0, error: Some(error) };
        let conn = match tokio::time::timeout(PROBE_TIMEOUT, self.endpoint.connect(EndpointAddr::new(id), wire::ALPN)).await {
            Err(_) => return Ok(failed(format!("No answer in {} s. They are probably offline.", PROBE_TIMEOUT.as_secs()))),
            Ok(Err(e)) => return Ok(failed(e.to_string())),
            Ok(Ok(conn)) => conn,
        };
        let connect_ms = ms(started);
        // A first link often goes through the relay and moves to a direct path once hole punching works, so give it a moment
        let (mut path, mut rtt_ms, mut direct_after_ms) = ("relay", 0, None);
        loop {
            if let Some(p) = conn.paths().iter().find(|p| p.is_selected()) {
                rtt_ms = p.rtt().as_millis() as u64;
                path = if p.is_relay() { "relay" } else { "direct" };
                if !p.is_relay() {
                    direct_after_ms = Some(ms(started));
                    break;
                }
            }
            if ms(started) > connect_ms + PROBE_DIRECT_WAIT_MS {
                break;
            }
            tokio::time::sleep(Duration::from_millis(250)).await;
        }
        conn.close(CLOSE_NORMAL.into(), b"probe");
        Ok(Probe { reachable: true, connect_ms, path, direct_after_ms, rtt_ms, error: None })
    }

    /// Forwards a message to every peer except the one it came from
    fn relay(&self, from: &EndpointId, bytes: Vec<u8>) {
        let outboxes: Vec<mpsc::Sender<Vec<u8>>> = self
            .lock()
            .peers
            .iter()
            .filter(|(id, _)| *id != from)
            .map(|(_, p)| p.outbox.clone())
            .collect();
        if outboxes.is_empty() {
            return;
        }
        tokio::spawn(async move {
            for outbox in outboxes {
                let _ = outbox.send(bytes.clone()).await;
            }
        });
    }

    /// Removes a peer only if the map still holds this exact connection
    /// Removes a peer whose connection ended; returns true when it was the host we joined
    fn remove_peer(self: &Arc<Self>, id: &EndpointId, stable_id: usize) -> bool {
        let removed = {
            let mut st = self.lock();
            match st.peers.get(id) {
                Some(peer) if peer.conn.stable_id() == stable_id => st.peers.remove(id),
                _ => None,
            }
        };
        let Some(peer) = removed else { return false };
        self.emit(EVENT_PEER_LEFT, PeerLeft { peer_id: id.to_string() });
        self.emit_peers();
        self.lock().mesh_tokens.forget(&id.to_string());
        self.broadcast_mesh();
        peer.is_host
    }

    /// Closes the connection to one peer
    pub fn disconnect(self: &Arc<Self>, peer_id: &str) -> Result<(), String> {
        let id = parse_peer_id(peer_id)?;
        let removed = {
            let mut st = self.lock();
            let removed = st.peers.remove(&id);
            if removed.as_ref().is_some_and(|p| p.is_host) {
                st.last_join = None;
                st.lost_host = None;
            }
            removed
        };
        if let Some(peer) = removed {
            peer.conn.close(CLOSE_NORMAL.into(), b"disconnected");
            self.emit(EVENT_PEER_LEFT, PeerLeft { peer_id: id.to_string() });
            self.emit_peers();
            self.lock().mesh_tokens.forget(&id.to_string());
            self.broadcast_mesh();
        }
        Ok(())
    }

    /// Closes every peer connection and stops accepting new guests
    pub fn disconnect_all(&self) {
        let peers: Vec<(EndpointId, Peer)> = {
            let mut st = self.lock();
            st.invite = None;
            self.short_codes.cancel();
            st.last_join = None;
            st.lost_host = None;
            st.mesh_allow.clear();
            st.mesh_tokens.clear();
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

/// True on the device that runs the hub: it did not join anyone and no peer is its host
fn is_hosting(st: &NodeState) -> bool {
    st.last_join.is_none() && st.peers.values().all(|p| !p.is_host)
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
pub(super) fn sanitize_name(name: &str) -> String {
    let cleaned: String = name.chars().filter(|c| !c.is_control()).take(64).collect();
    let cleaned = cleaned.trim();
    if cleaned.is_empty() {
        "Collaborator".to_string()
    } else {
        cleaned.to_string()
    }
}

pub(super) fn now_ms() -> u64 {
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
    fn test_sanitize_name() {
        assert_eq!(sanitize_name("  Alice  "), "Alice");
        assert_eq!(sanitize_name(""), "Collaborator");
        assert_eq!(sanitize_name("\u{7}\n"), "Collaborator");
        assert_eq!(sanitize_name(&"x".repeat(100)).len(), 64);
    }
}
