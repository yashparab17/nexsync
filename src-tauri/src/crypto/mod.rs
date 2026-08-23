//! Cryptographic utilities for Nexsync using libsodium via libsodium-sys.

use libc::size_t;
use libsodium_sys::{crypto_secretbox_KEYBYTES, crypto_secretbox_NONCEBYTES, crypto_secretbox_MACBYTES};

/// Maximum allowed data size for encryption/decryption (100 MB).
#[allow(dead_code)]
pub const MAX_DATA_SIZE: usize = 100 * 1024 * 1024;

/// Maximum allowed buffer length for random byte generation (64 MB).
#[allow(dead_code)]
pub const MAX_RANDOM_BYTES: usize = 64 * 1024 * 1024;

/// Initialize libsodium. Should be called once at application startup.
pub fn init() -> Result<(), String> {
    unsafe {
        if libsodium_sys::sodium_init() < 0 {
            return Err("Failed to initialize libsodium".to_string());
        }
    }
    Ok(())
}

/// Generate a random cryptographic key for secretbox encryption.
#[allow(dead_code)]
pub fn generate_key() -> [u8; crypto_secretbox_KEYBYTES as usize] {
    let mut key = [0u8; crypto_secretbox_KEYBYTES as usize];
    unsafe {
        libsodium_sys::crypto_secretbox_keygen(key.as_mut_ptr() as *mut _);
    }
    key
}

/// Generates cryptographically secure random bytes with upper bound check.
#[allow(dead_code)]
pub fn random_bytes(len: usize) -> Result<Vec<u8>, String> {
    if len > MAX_RANDOM_BYTES {
        return Err(format!("Requested random byte length ({len}) exceeds maximum allowed ({MAX_RANDOM_BYTES})"));
    }
    let mut buf = vec![0u8; len];
    unsafe {
        libsodium_sys::randombytes_buf(buf.as_mut_ptr() as *mut _, len as size_t);
    }
    Ok(buf)
}

/// Encrypts data using libsodium's secretbox (authenticated encryption).
/// Returns nonce || ciphertext.
#[allow(dead_code)]
pub fn encrypt(data: &[u8], key: &[u8; crypto_secretbox_KEYBYTES as usize]) -> Result<Vec<u8>, String> {
    // Validate data constraints
    if data.is_empty() {
        return Err("Data cannot be empty".to_string());
    }
    if data.len() > MAX_DATA_SIZE {
        return Err(format!("Data length ({}) exceeds maximum limit ({} bytes)", data.len(), MAX_DATA_SIZE));
    }

    // Generate random nonce
    let mut nonce = [0u8; crypto_secretbox_NONCEBYTES as usize];
    unsafe {
        libsodium_sys::randombytes_buf(nonce.as_mut_ptr() as *mut _, crypto_secretbox_NONCEBYTES as size_t);
    }

    // Allocate buffer and encrypt payload
    let mac_len = crypto_secretbox_MACBYTES as usize;
    let total_len = mac_len.checked_add(data.len()).ok_or_else(|| "Ciphertext length overflow".to_string())?;
    let mut ciphertext = vec![0u8; total_len];

    unsafe {
        if libsodium_sys::crypto_secretbox_easy(
            ciphertext.as_mut_ptr() as *mut _,
            data.as_ptr(),
            data.len() as u64,
            nonce.as_ptr(),
            key.as_ptr(),
        ) != 0 {
            return Err("Encryption failed".to_string());
        }
    }

    // Prepend nonce to ciphertext for decryption later
    let mut result = Vec::with_capacity(crypto_secretbox_NONCEBYTES as usize + total_len);
    result.extend_from_slice(&nonce);
    result.extend(ciphertext);
    Ok(result)
}

/// Decrypts data encrypted with [`encrypt`].
#[allow(dead_code)]
pub fn decrypt(encrypted_data: &[u8], key: &[u8; crypto_secretbox_KEYBYTES as usize]) -> Result<Vec<u8>, String> {
    // Validate minimum and maximum ciphertext bounds
    let min_len = (crypto_secretbox_NONCEBYTES + crypto_secretbox_MACBYTES) as usize;
    if encrypted_data.len() < min_len {
        return Err("Encrypted data too short".to_string());
    }
    if encrypted_data.len() > MAX_DATA_SIZE + min_len {
        return Err("Encrypted data length exceeds maximum allowed limit".to_string());
    }

    // Extract nonce and ciphertext slices
    let nonce_start = 0;
    let nonce_end = crypto_secretbox_NONCEBYTES as usize;
    let nonce = &encrypted_data[nonce_start..nonce_end];
    let ciphertext_start = nonce_end;
    
    let ciphertext = &encrypted_data[ciphertext_start..];
    let decrypted_len = ciphertext.len() - crypto_secretbox_MACBYTES as usize;

    let mut plaintext = vec![0u8; decrypted_len];

    // Authenticate and decrypt
    unsafe {
        match libsodium_sys::crypto_secretbox_open_easy(
            plaintext.as_mut_ptr() as *mut _,
            ciphertext.as_ptr(),
            ciphertext.len() as u64,
            nonce.as_ptr(),
            key.as_ptr(),
        ) {
            0 => Ok(plaintext),
            _ => Err("Decryption failed or invalid key".to_string()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encrypt_decrypt_roundtrip() {
        let data = b"Hello, secure world!";
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
        assert!(decrypt(&encrypted, &key2).is_err(), "Decryption with wrong key should fail");
    }

    #[test]
    fn test_random_bytes() {
        let bytes = random_bytes(32).expect("Random bytes should succeed");
        assert_eq!(bytes.len(), 32);

        let too_large = random_bytes(MAX_RANDOM_BYTES + 1);
        assert!(too_large.is_err(), "Random bytes above limit should fail");
    }
}