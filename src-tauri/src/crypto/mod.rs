//! Cryptographic utilities for Nexsync using pure RustCrypto (AES-256-GCM & X25519).
//! 100% memory-safe, zero C dependencies, fully compatible with Web Crypto API (SubtleCrypto).

#![allow(dead_code, unused)]

use aes_gcm::{
	aead::{Aead, KeyInit},
	Aes256Gcm, Key, Nonce,
};
use rand::{rngs::OsRng, RngCore};
use x25519_dalek::{PublicKey, StaticSecret};

/// Key length for AES-256-GCM in bytes (32 bytes / 256 bits)
#[allow(dead_code)]
pub const KEY_BYTES: usize = 32;

/// Standard nonce / IV length for AES-256-GCM (12 bytes / 96 bits)
#[allow(dead_code)]
pub const NONCE_BYTES: usize = 12;

/// Standard tag length for AES-256-GCM (16 bytes / 128 bits)
#[allow(dead_code)]
pub const TAG_BYTES: usize = 16;

/// Maximum allowed data size for encryption/decryption (100 MB)
#[allow(dead_code)]
pub const MAX_DATA_SIZE: usize = 100 * 1024 * 1024;

/// Maximum allowed buffer length for random byte generation (64 MB)
#[allow(dead_code)]
pub const MAX_RANDOM_BYTES: usize = 64 * 1024 * 1024;


/// Initialize cryptography subsystem (no-op in pure RustCrypto, preserved for setup lifecycle)
pub fn init() -> Result<(), String> {
	Ok(())
}

/// Generate a cryptographically secure 256-bit key
#[allow(dead_code)]
pub fn generate_key() -> [u8; KEY_BYTES] {
	let mut key = [0u8; KEY_BYTES];
	OsRng.fill_bytes(&mut key);
	key
}

/// Generates cryptographically secure random bytes with upper bound check
#[allow(dead_code)]
pub fn random_bytes(len: usize) -> Result<Vec<u8>, String> {
	if len > MAX_RANDOM_BYTES {
		return Err(format!(
			"Requested random byte length ({len}) exceeds maximum allowed ({MAX_RANDOM_BYTES})"
		));
	}
	let mut buf = vec![0u8; len];
	OsRng.fill_bytes(&mut buf);
	Ok(buf)
}

/// Encrypts data using AES-256-GCM with a random 12-byte nonce.
/// Returns payload formatted as `nonce (12 bytes) || ciphertext + tag (16 bytes)`.
#[allow(dead_code)]
pub fn encrypt(data: &[u8], key: &[u8; KEY_BYTES]) -> Result<Vec<u8>, String> {
	if data.is_empty() {
		return Err("Data cannot be empty".to_string());
	}
	if data.len() > MAX_DATA_SIZE {
		return Err(format!(
			"Data length ({}) exceeds maximum limit ({} bytes)",
			data.len(),
			MAX_DATA_SIZE
		));
	}

	let mut nonce_bytes = [0u8; NONCE_BYTES];
	OsRng.fill_bytes(&mut nonce_bytes);

	let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
	let nonce = Nonce::from_slice(&nonce_bytes);

	let ciphertext = cipher
		.encrypt(nonce, data)
		.map_err(|e| format!("Encryption failed: {}", e))?;

	let mut result = Vec::with_capacity(NONCE_BYTES + ciphertext.len());
	result.extend_from_slice(&nonce_bytes);
	result.extend_from_slice(&ciphertext);
	Ok(result)
}

/// Decrypts data encrypted with [`encrypt`].
/// Expects payload formatted as `nonce (12 bytes) || ciphertext + tag (16 bytes)`.
#[allow(dead_code)]
pub fn decrypt(encrypted_data: &[u8], key: &[u8; KEY_BYTES]) -> Result<Vec<u8>, String> {
	let min_len = NONCE_BYTES + TAG_BYTES;
	if encrypted_data.len() < min_len {
		return Err("Encrypted data too short".to_string());
	}
	if encrypted_data.len() > MAX_DATA_SIZE + min_len {
		return Err("Encrypted data length exceeds maximum allowed limit".to_string());
	}

	let nonce = Nonce::from_slice(&encrypted_data[0..NONCE_BYTES]);
	let ciphertext = &encrypted_data[NONCE_BYTES..];

	let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));

	cipher
		.decrypt(nonce, ciphertext)
		.map_err(|_| "Decryption failed or invalid key".to_string())
}

/// Generate an X25519 keypair for peer key-exchange handshakes (returns `(public_key, secret_key)`)
#[allow(dead_code)]
pub fn generate_x25519_keypair() -> ([u8; 32], [u8; 32]) {
	let secret = StaticSecret::random_from_rng(OsRng);
	let public = PublicKey::from(&secret);
	(public.to_bytes(), secret.to_bytes())
}

/// Computes the Diffie-Hellman shared secret given a local secret key and remote public key
#[allow(dead_code)]
pub fn diffie_hellman(secret_bytes: &[u8; 32], public_bytes: &[u8; 32]) -> [u8; 32] {
	let secret = StaticSecret::from(*secret_bytes);
	let public = PublicKey::from(*public_bytes);
	secret.diffie_hellman(&public).to_bytes()
}


#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn test_encrypt_decrypt_roundtrip() {
		let data = b"Hello, secure world from pure RustCrypto!";
		let key = generate_key();

		let encrypted = encrypt(data, &key).expect("Encryption should succeed");
		let decrypted = decrypt(&encrypted, &key).expect("Decryption should succeed");

		assert_eq!(data, &decrypted[..]);
	}

	#[test]
	fn test_decrypt_with_wrong_key_fails() {
		let data = b"Secret data";
		let key1 = generate_key();
		let key2 = generate_key();

		let encrypted = encrypt(data, &key1).expect("Encryption should succeed");
		assert!(
			decrypt(&encrypted, &key2).is_err(),
			"Decryption with wrong key should fail"
		);
	}

	#[test]
	fn test_decrypt_tampered_payload_fails() {
		let data = b"Untampered content";
		let key = generate_key();

		let mut encrypted = encrypt(data, &key).expect("Encryption should succeed");
		let last_idx = encrypted.len() - 1;
		encrypted[last_idx] ^= 0xFF; // tamper with ciphertext/tag

		assert!(
			decrypt(&encrypted, &key).is_err(),
			"Decryption of tampered ciphertext should fail"
		);
	}

	#[test]
	fn test_random_bytes() {
		let bytes = random_bytes(32).expect("Random bytes should succeed");
		assert_eq!(bytes.len(), 32);

		let too_large = random_bytes(MAX_RANDOM_BYTES + 1);
		assert!(too_large.is_err(), "Random bytes above limit should fail");
	}

	#[test]
	fn test_x25519_diffie_hellman_agreement() {
		let (alice_pub, alice_sec) = generate_x25519_keypair();
		let (bob_pub, bob_sec) = generate_x25519_keypair();

		let alice_shared = diffie_hellman(&alice_sec, &bob_pub);
		let bob_shared = diffie_hellman(&bob_sec, &alice_pub);

		assert_eq!(alice_shared, bob_shared, "Diffie-Hellman keys must match");
	}
}