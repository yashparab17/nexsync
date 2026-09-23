//! Peer-to-peer workspace collaboration over Iroh.
//!
//! Iroh dials peers by public key over QUIC, hole-punches a direct UDP path
//! when possible and falls back to encrypted relay servers otherwise, so two
//! collaborators can connect from behind almost any NAT or firewall. All
//! networking lives here in the backend; the frontend drives it through the
//! commands below and listens to `p2p://*` events.

mod files;
mod node;
mod ticket;
mod wire;

use tauri::{AppHandle, State};

use crate::commands::config::validate_allowed_root;
pub use node::P2pState;
use node::{InviteInfo, JoinResult, PeerInfo};
use files::ShareableFile;

/// Sets (or clears) the workspace folder that connected peers may read files from
#[tauri::command]
pub fn p2p_set_workspace(
    app: AppHandle,
    state: State<'_, P2pState>,
    workspace_path: Option<String>,
) -> Result<(), String> {
    if let Some(path) = &workspace_path {
        validate_allowed_root(&app, path)?;
    }
    state.set_workspace_path(workspace_path);
    Ok(())
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
) -> Result<InviteInfo, String> {
    let node = state.node(&app).await?;
    node.create_invite(role, workspace_id, workspace_name, host_name).await
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

/// Disconnects a single peer
#[tauri::command]
pub async fn p2p_disconnect(state: State<'_, P2pState>, peer_id: String) -> Result<(), String> {
    match state.existing().await {
        Some(node) => node.disconnect(&peer_id),
        None => Ok(()),
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
