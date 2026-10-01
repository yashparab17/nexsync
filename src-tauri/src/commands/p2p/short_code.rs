//! Short join codes: a 6-digit code derives a temporary address that hands out the invite ticket
//! once the host approves.
//!
//! The host starts a second, short-lived endpoint whose key comes from the code. A guest who types
//! the same code derives the same key and dials it through Iroh's normal address lookup, so no
//! extra server is involved. The code works for one request and for two minutes at most, and the
//! host must click Allow before the real ticket is revealed.
// ponytail: the code only stops guessing through expiry, single use and the Allow prompt; swap in Magic Wormhole (PAKE) if stronger guarantees are needed.

use std::{collections::HashMap, sync::Arc, sync::Mutex, time::Duration};

use iroh::{endpoint::presets, Endpoint, EndpointAddr, SecretKey};
use rand::Rng;
use serde::{Deserialize, Serialize};
use tokio::sync::oneshot;

use super::{
    node::{sanitize_name, InviteInfo, JoinResult, Node, HANDSHAKE_TIMEOUT, ONLINE_TIMEOUT},
    wire::{self, MAX_SMALL_FRAME, PROTOCOL_VERSION},
};

/// Protocol identifier for the temporary code endpoint
pub const ALPN_INVITE: &[u8] = b"nexsync/invite/1";
pub const EVENT_JOIN_REQUEST: &str = "p2p://join-request";
pub const EVENT_JOIN_REQUEST_CLOSED: &str = "p2p://join-request-closed";

const CODE_DIGITS: usize = 6;
/// How long a code stays usable
pub const CODE_TTL: Duration = Duration::from_secs(120);
/// How long a guest waits to find the host before deciding the code is not active
const LOOKUP_TIMEOUT: Duration = Duration::from_secs(12);
/// How long the host has to answer an Allow prompt
const APPROVAL_TIMEOUT: Duration = Duration::from_secs(60);

/// Sent by the guest to the temporary endpoint
#[derive(Debug, Serialize, Deserialize)]
struct InviteRequest {
    v: u32,
    name: String,
}

/// The host's answer to an [`InviteRequest`]
#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum InviteReply {
    Ticket { ticket: String },
    Denied,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShortCodeInfo {
    pub code: String,
    /// When the code stops working, in milliseconds since the Unix epoch
    pub expires_at: u64,
    /// False if no relay was reachable, so only same-network guests can join
    pub relay_connected: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct JoinRequest<'a> {
    request_id: &'a str,
    name: &'a str,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct JoinRequestClosed<'a> {
    request_id: &'a str,
}

/// The active code (if any) and the join requests waiting for the host's answer
#[derive(Default)]
pub struct ShortCodes {
    session: Mutex<Option<tokio::task::JoinHandle<()>>>,
    pending: Mutex<HashMap<String, oneshot::Sender<bool>>>,
}

impl ShortCodes {
    /// Stops the active code, if any; requests already waiting for an answer are denied.
    pub fn cancel(&self) {
        if let Some(task) = self.session.lock().unwrap_or_else(|p| p.into_inner()).take() {
            task.abort();
        }
        self.pending.lock().unwrap_or_else(|p| p.into_inner()).clear();
    }

    /// Delivers the host's answer for a waiting request; returns false if it is no longer waiting.
    pub fn resolve(&self, request_id: &str, approve: bool) -> bool {
        let sender = self.pending.lock().unwrap_or_else(|p| p.into_inner()).remove(request_id);
        sender.is_some_and(|tx| tx.send(approve).is_ok())
    }
}

/// A random zero-padded code such as `048213`.
pub fn generate_code() -> String {
    let n = rand::thread_rng().gen_range(0..10u32.pow(CODE_DIGITS as u32));
    format!("{n:0width$}", width = CODE_DIGITS)
}

/// Accepts a code typed with spaces or dashes and returns just its digits.
pub fn normalize_code(input: &str) -> Result<String, String> {
    let digits: String = input.chars().filter(|c| !c.is_whitespace() && *c != '-').collect();
    if digits.len() == CODE_DIGITS && digits.bytes().all(|b| b.is_ascii_digit()) {
        Ok(digits)
    } else {
        Err(format!("Enter the {CODE_DIGITS}-digit code from the host."))
    }
}

/// Both sides turn the same code into the same key, so the guest can find the host's address.
fn derive_key(code: &str) -> SecretKey {
    SecretKey::from_bytes(&blake3::derive_key("nexsync short invite code v1", code.as_bytes()))
}

impl Node {
    /// Delivers the host's answer for a waiting join request
    pub fn resolve_join_request(&self, request_id: &str, approve: bool) -> bool {
        self.short_codes().resolve(request_id, approve)
    }

    /// Creates an invite and a short code for it. Replaces any earlier invite and code.
    pub async fn create_short_code(
        self: &Arc<Self>,
        role: String,
        workspace_id: String,
        workspace_name: String,
        host_name: String,
    ) -> Result<ShortCodeInfo, String> {
        self.create_short_code_with_ttl(role, workspace_id, workspace_name, host_name, CODE_TTL).await
    }

    pub(super) async fn create_short_code_with_ttl(
        self: &Arc<Self>,
        role: String,
        workspace_id: String,
        workspace_name: String,
        host_name: String,
        ttl: Duration,
    ) -> Result<ShortCodeInfo, String> {
        let InviteInfo { ticket, .. } = self.create_invite(role, workspace_id, workspace_name, host_name).await?;

        let code = generate_code();
        let endpoint = Endpoint::builder(presets::N0)
            .secret_key(derive_key(&code))
            .alpns(vec![ALPN_INVITE.to_vec()])
            .bind()
            .await
            .map_err(|e| format!("Couldn't create the code: {e}"))?;
        // The address must be published before a guest can look the code up.
        let relay_connected = tokio::time::timeout(ONLINE_TIMEOUT, endpoint.online()).await.is_ok();

        // Only one code is active at a time, so drop the old one before starting this one.
        self.short_codes().cancel();
        let node = self.clone();
        let task = tokio::spawn(async move {
            let _ = tokio::time::timeout(ttl, node.serve_code(&endpoint, &ticket)).await;
            endpoint.close().await;
        });
        *self.short_codes().session.lock().unwrap_or_else(|p| p.into_inner()) = Some(task);

        Ok(ShortCodeInfo { code, expires_at: super::node::now_ms() + ttl.as_millis() as u64, relay_connected })
    }

    /// Answers connections to the temporary endpoint until one request has been handled.
    async fn serve_code(self: &Arc<Self>, endpoint: &Endpoint, ticket: &str) {
        while let Some(incoming) = endpoint.accept().await {
            let Ok(accepting) = incoming.accept() else { continue };
            let Ok(conn) = accepting.await else { continue };
            if self.handle_code_request(&conn, ticket).await {
                // Give the guest a moment to read the reply before the endpoint closes.
                let _ = tokio::time::timeout(Duration::from_secs(5), conn.closed()).await;
                return;
            }
        }
    }

    /// Asks the host to approve one request; true once the request was answered (allowed or not).
    async fn handle_code_request(self: &Arc<Self>, conn: &iroh::endpoint::Connection, ticket: &str) -> bool {
        let Ok(Ok((mut send, mut recv))) = tokio::time::timeout(HANDSHAKE_TIMEOUT, conn.accept_bi()).await else {
            return false;
        };
        let Ok(Ok(request)) = tokio::time::timeout(
            HANDSHAKE_TIMEOUT,
            wire::read_json::<_, InviteRequest>(&mut recv, MAX_SMALL_FRAME),
        )
        .await
        else {
            return false;
        };

        let reply = if request.v != PROTOCOL_VERSION {
            InviteReply::Denied
        } else {
            let request_id = uuid::Uuid::new_v4().to_string();
            let name = sanitize_name(&request.name);
            let (tx, rx) = oneshot::channel();
            self.short_codes().pending.lock().unwrap_or_else(|p| p.into_inner()).insert(request_id.clone(), tx);
            self.emit(EVENT_JOIN_REQUEST, JoinRequest { request_id: &request_id, name: &name });

            let approved = matches!(tokio::time::timeout(APPROVAL_TIMEOUT, rx).await, Ok(Ok(true)));
            self.short_codes().pending.lock().unwrap_or_else(|p| p.into_inner()).remove(&request_id);
            self.emit(EVENT_JOIN_REQUEST_CLOSED, JoinRequestClosed { request_id: &request_id });
            if approved {
                InviteReply::Ticket { ticket: ticket.to_string() }
            } else {
                InviteReply::Denied
            }
        };

        let _ = wire::write_json(&mut send, &reply).await;
        let _ = send.finish();
        true
    }

    /// Joins a host from a short code: finds the host, waits for its approval, then joins normally.
    pub async fn join_with_code(self: &Arc<Self>, code: &str, display_name: &str) -> Result<JoinResult, String> {
        let code = normalize_code(code)?;
        let addr = EndpointAddr::new(derive_key(&code).public());

        let conn = tokio::time::timeout(LOOKUP_TIMEOUT, self.endpoint().connect(addr, ALPN_INVITE))
            .await
            .map_err(|_| INACTIVE_CODE.to_string())?
            .map_err(|_| INACTIVE_CODE.to_string())?;
        let (mut send, mut recv) = conn.open_bi().await.map_err(|e| e.to_string())?;
        wire::write_json(&mut send, &InviteRequest { v: PROTOCOL_VERSION, name: sanitize_name(display_name) }).await?;

        let reply: InviteReply = tokio::time::timeout(
            APPROVAL_TIMEOUT + HANDSHAKE_TIMEOUT,
            wire::read_json(&mut recv, MAX_SMALL_FRAME),
        )
        .await
        .map_err(|_| "The host didn't answer in time.".to_string())??;
        conn.close(0u32.into(), b"done");

        match reply {
            InviteReply::Ticket { ticket } => self.join(&ticket, display_name).await,
            InviteReply::Denied => Err("The host declined your request.".to_string()),
        }
    }
}

const INACTIVE_CODE: &str = "That code isn't active. Check the digits, and note that a code only lasts 2 minutes.";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generated_codes_are_six_digits() {
        for _ in 0..200 {
            let code = generate_code();
            assert_eq!(code.len(), CODE_DIGITS);
            assert!(code.bytes().all(|b| b.is_ascii_digit()));
        }
    }

    #[test]
    fn test_codes_are_normalized_or_rejected() {
        assert_eq!(normalize_code("048 213").unwrap(), "048213");
        assert_eq!(normalize_code(" 048-213 ").unwrap(), "048213");
        for bad in ["", "12345", "1234567", "12345a", "abcdef"] {
            assert!(normalize_code(bad).is_err(), "should reject {bad:?}");
        }
    }

    #[test]
    fn test_same_code_derives_same_key_and_different_codes_differ() {
        assert_eq!(derive_key("048213").public(), derive_key("048213").public());
        assert_ne!(derive_key("048213").public(), derive_key("048214").public());
    }
}
