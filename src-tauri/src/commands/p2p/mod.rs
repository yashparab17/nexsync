//! Peer-to-peer workspace collaboration over Iroh.
//!
//! Iroh dials peers by public key over QUIC, hole-punches a direct UDP path
//! when possible and falls back to encrypted relay servers otherwise, so two
//! collaborators can connect from behind almost any NAT or firewall. All
//! networking lives here in the backend; the frontend drives it through the
//! commands below and listens to `p2p://*` events.

pub(crate) mod clock;
mod files;
#[cfg(test)]
mod compat;
#[cfg(test)]
mod hostless_sim;
mod membership;
#[cfg(test)]
mod membership_sim;
#[cfg(test)]
mod peer_check;
mod mesh;
mod node;
pub(crate) mod short_code;
mod sync;
mod ticket;
mod vault;
mod wire;

use tauri::{AppHandle, State};

use crate::commands::config::validate_allowed_root;
pub use node::P2pState;
pub(crate) use node::identity;
use node::{InviteInfo, InviteOptions, JoinResult, NetworkStatus, PeerInfo};
use short_code::ShortCodeInfo;
use files::ShareableFile;

/// Sets (or clears) the workspace folder shared with peers and kept in live sync
#[tauri::command]
pub async fn p2p_set_workspace(
    app: AppHandle,
    state: State<'_, P2pState>,
    workspace_path: Option<String>,
) -> Result<(), String> {
    if let Some(path) = &workspace_path {
        validate_allowed_root(&app, path)?;
    }
    // A workspace that has a signed member list has other members to be linked to, host or no host, so the network starts
    let has_members = workspace_path.as_deref().is_some_and(|p| membership::load(p).is_some());
    state.set_workspace_path(workspace_path).await;
    if has_members {
        state.node(&app).await?;
    }
    Ok(())
}

/// A workspace was just created as a copy of the host's: keep the member list the host sent with it. Returns whether
/// there was one to keep.
#[tauri::command]
pub async fn p2p_adopt_membership(
    app: AppHandle,
    state: State<'_, P2pState>,
    workspace_path: String,
    host_workspace_id: String,
) -> Result<bool, String> {
    validate_allowed_root(&app, &workspace_path)?;
    Ok(match state.existing().await {
        Some(node) => node.adopt_membership(&workspace_path, &host_workspace_id),
        None => false,
    })
}

/// The owner hands the workspace to another device: the signed member list is what says so
#[tauri::command]
pub async fn p2p_handoff_membership(state: State<'_, P2pState>, new_owner: String) -> Result<(), String> {
    match state.existing().await {
        Some(node) => node.hand_off_membership(&new_owner),
        None => Err("The network is not running.".into()),
    }
}

/// Creates an invite ticket for the active workspace, replacing any previous invite
#[tauri::command]
pub async fn p2p_create_invite(
    app: AppHandle,
    state: State<'_, P2pState>,
    role: String,
    workspace_id: String,
    workspace_name: String,
    host_name: String,
    options: Option<InviteOptions>,
) -> Result<InviteInfo, String> {
    let node = state.node(&app).await?;
    node.create_invite_with(role, workspace_id, workspace_name, host_name, options.unwrap_or_default()).await
}

/// Tells the host who is already a member of the open workspace, as (device key, role) pairs, so they can come back
/// without an invite. Call it whenever the member list changes. A workspace with members starts the network, because
/// they need a host that is there to be reached.
#[tauri::command]
pub async fn p2p_set_known_members(
    app: AppHandle,
    state: State<'_, P2pState>,
    workspace_id: String,
    workspace_name: String,
    host_name: String,
    members: Vec<(String, String)>,
) -> Result<(), String> {
    let any = !members.is_empty();
    state.set_known((workspace_id, workspace_name, host_name, members)).await;
    if any {
        state.node(&app).await?;
    }
    Ok(())
}

/// Dials a member by device key alone and reports whether and how it got through
#[tauri::command]
pub async fn p2p_probe_member(app: AppHandle, state: State<'_, P2pState>, device_id: String) -> Result<node::Probe, String> {
    let node = state.node(&app).await?;
    node.probe_member(&device_id).await
}

/// Disconnects a guest and stops them rejoining with an earlier invite or code
#[tauri::command]
pub async fn p2p_block_device(state: State<'_, P2pState>, device_id: String) -> Result<(), String> {
    match state.existing().await {
        Some(node) => node.block_device(&device_id),
        None => Ok(()),
    }
}

/// Creates an invite plus a 6-digit code that works for 2 minutes and needs the host to approve
#[tauri::command]
pub async fn p2p_create_short_code(
    app: AppHandle,
    state: State<'_, P2pState>,
    role: String,
    workspace_id: String,
    workspace_name: String,
    host_name: String,
) -> Result<ShortCodeInfo, String> {
    let node = state.node(&app).await?;
    node.create_short_code(role, workspace_id, workspace_name, host_name).await
}

/// Answers a guest's request to join with a short code
#[tauri::command]
pub async fn p2p_resolve_join_request(
    state: State<'_, P2pState>,
    request_id: String,
    approve: bool,
) -> Result<bool, String> {
    Ok(match state.existing().await {
        Some(node) => node.resolve_join_request(&request_id, approve),
        None => false,
    })
}

/// Connects to a host using a short code, once the host approves
#[tauri::command]
pub async fn p2p_join_with_code(
    app: AppHandle,
    state: State<'_, P2pState>,
    code: String,
    display_name: String,
) -> Result<JoinResult, String> {
    let node = state.node(&app).await?;
    node.join_with_code(&code, &display_name).await
}

/// This device's own P2P key, used as its identity in the member list
#[tauri::command]
pub async fn p2p_self_id(app: AppHandle, state: State<'_, P2pState>) -> Result<String, String> {
    Ok(state.node(&app).await?.self_id())
}

/// Tells the node which role each device key holds, so the host enforces the member list
#[tauri::command]
pub async fn p2p_set_roles(state: State<'_, P2pState>, roles: Vec<(String, String)>) -> Result<(), String> {
    state.set_roles(roles).await;
    Ok(())
}

/// Stops accepting new guests with the current invite
#[tauri::command]
pub async fn p2p_revoke_invite(state: State<'_, P2pState>) -> Result<(), String> {
    if let Some(node) = state.existing().await {
        node.revoke_invite();
    }
    Ok(())
}

/// Connects to a host using an invite ticket
#[tauri::command]
pub async fn p2p_join(
    app: AppHandle,
    state: State<'_, P2pState>,
    ticket: String,
    display_name: String,
) -> Result<JoinResult, String> {
    let node = state.node(&app).await?;
    node.join(&ticket, &display_name).await
}

/// Sends a JSON message to one peer, or to every peer when `peer_id` is omitted
#[tauri::command]
pub async fn p2p_send(
    state: State<'_, P2pState>,
    peer_id: Option<String>,
    message: serde_json::Value,
) -> Result<usize, String> {
    match state.existing().await {
        Some(node) => node.send(peer_id.as_deref(), &message).await,
        None => Ok(0),
    }
}

/// Lists currently connected peers with live latency and traffic stats
#[tauri::command]
pub async fn p2p_list_peers(state: State<'_, P2pState>) -> Result<Vec<PeerInfo>, String> {
    Ok(state.existing().await.map(|node| node.peers()).unwrap_or_default())
}

/// Cancels the downloads of one file, or every download when `rel_path` is omitted
#[tauri::command]
pub async fn p2p_cancel_transfers(state: State<'_, P2pState>, rel_path: Option<String>) -> Result<usize, String> {
    Ok(state.existing().await.map_or(0, |node| node.sync().cancel_transfers(rel_path.as_deref())))
}

/// Disconnects a single peer
#[tauri::command]
pub async fn p2p_disconnect(state: State<'_, P2pState>, peer_id: String) -> Result<(), String> {
    match state.existing().await {
        Some(node) => node.disconnect(&peer_id),
        None => Ok(()),
    }
}

/// Whether the relay is reachable right now; also starts the network so changes are reported from here on
#[tauri::command]
pub async fn p2p_network_status(app: AppHandle, state: State<'_, P2pState>) -> Result<NetworkStatus, String> {
    Ok(state.node(&app).await?.network_status())
}

/// The OS reported a network change, so re-probe the connection immediately
#[tauri::command]
pub async fn p2p_network_change(state: State<'_, P2pState>) -> Result<(), String> {
    if let Some(node) = state.existing().await {
        node.network_change().await;
    }
    Ok(())
}

/// Re-dials the host after the automatic attempts gave up
#[tauri::command]
pub async fn p2p_retry_connection(state: State<'_, P2pState>) -> Result<(), String> {
    match state.existing().await {
        Some(node) => node.retry_connection(),
        None => Err("There is no host to reconnect to. Join again with an invite or code.".into()),
    }
}

/// Disconnects every peer and revokes the current invite
#[tauri::command]
pub async fn p2p_disconnect_all(state: State<'_, P2pState>) -> Result<(), String> {
    if let Some(node) = state.existing().await {
        node.disconnect_all();
    }
    Ok(())
}

/// Downloads a file from a peer into the same relative path of a local workspace
#[tauri::command]
pub async fn p2p_fetch_file(
    app: AppHandle,
    state: State<'_, P2pState>,
    peer_id: String,
    workspace_path: String,
    rel_path: String,
) -> Result<u64, String> {
    validate_allowed_root(&app, &workspace_path)?;
    let node = state
        .existing()
        .await
        .ok_or("Not connected to any collaborators.")?;
    files::fetch(&node, &peer_id, &workspace_path, &rel_path).await
}

/// Recursively lists the files a workspace shares with collaborators
#[tauri::command]
pub async fn p2p_list_shareable_files(
    app: AppHandle,
    workspace_path: String,
) -> Result<Vec<ShareableFile>, String> {
    validate_allowed_root(&app, &workspace_path)?;
    tokio::task::spawn_blocking(move || files::list_shareable_files(&workspace_path))
        .await
        .map_err(|e| e.to_string())?
}
