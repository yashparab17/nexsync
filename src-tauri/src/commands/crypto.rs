//! IPC-exposed cryptographic commands for the P2P E2EE handshake.
//! The X25519 primitives themselves already existed in `crypto::mod` but were
//! never wired up to the frontend — the TypeScript side had drifted to deriving
//! a static AES key straight from the human-readable short code instead. These
//! commands let the frontend perform a real ephemeral Diffie-Hellman exchange,
//! while all elliptic-curve math stays in the audited Rust implementation
//! (X25519 support is inconsistent across the WebViews Tauri embeds).

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};

use crate::crypto;

/// Base64url-encoded X25519 keypair returned to the frontend.
/// The secret key never leaves process memory beyond this single round trip —
/// the frontend holds it only for the lifetime of one handshake.
#[derive(serde::Serialize)]
pub struct X25519KeyPair {
	pub public_key: String,
	pub secret_key: String,
}

/// Generates a fresh ephemeral X25519 keypair for one P2P handshake.
#[tauri::command]
pub fn x25519_generate_keypair() -> X25519KeyPair {
	let (public, secret) = crypto::generate_x25519_keypair();
	X25519KeyPair {
		public_key: URL_SAFE_NO_PAD.encode(public),
		secret_key: URL_SAFE_NO_PAD.encode(secret),
	}
}

/// Computes the X25519 shared secret from a local secret key and a peer's public key.
/// Returns raw base64url-encoded shared secret bytes; the caller (frontend) is
/// responsible for running this through HKDF before using it as an AES key —
/// raw ECDH output must never be used directly as a symmetric key.
#[tauri::command]
pub fn x25519_derive_shared_secret(
	secret_key: String,
	peer_public_key: String,
) -> Result<String, String> {
	let secret_bytes = URL_SAFE_NO_PAD
		.decode(secret_key)
		.map_err(|e| format!("Invalid local secret key encoding: {e}"))?;
	let public_bytes = URL_SAFE_NO_PAD
		.decode(peer_public_key)
		.map_err(|e| format!("Invalid peer public key encoding: {e}"))?;

	if secret_bytes.len() != 32 || public_bytes.len() != 32 {
		return Err("X25519 keys must be exactly 32 bytes".to_string());
	}

	let mut secret_arr = [0u8; 32];
	let mut public_arr = [0u8; 32];
	secret_arr.copy_from_slice(&secret_bytes);
	public_arr.copy_from_slice(&public_bytes);

	let shared = crypto::diffie_hellman(&secret_arr, &public_arr);
	Ok(URL_SAFE_NO_PAD.encode(shared))
}
