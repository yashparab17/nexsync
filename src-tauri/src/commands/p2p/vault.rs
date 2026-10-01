//! Keeps this device's secret key in the operating system's credential store instead of a plain file.
//!
//! Windows (Credential Manager) and macOS (Keychain) are supported. Elsewhere, or if the store refuses,
//! callers fall back to the key file, so a missing store never stops the app from starting.

const SERVICE: &str = "nexsync";
const ACCOUNT: &str = "p2p-identity";

fn to_hex(bytes: &[u8; 32]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn from_hex(text: &str) -> Option<[u8; 32]> {
    let text = text.trim();
    if text.len() != 64 || !text.is_ascii() {
        return None;
    }
    let mut out = [0u8; 32];
    for (i, byte) in out.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&text[i * 2..i * 2 + 2], 16).ok()?;
    }
    Some(out)
}

#[cfg(any(windows, target_os = "macos"))]
pub fn load() -> Option<[u8; 32]> {
    keyring::Entry::new(SERVICE, ACCOUNT).ok()?.get_password().ok().and_then(|t| from_hex(&t))
}

/// True only if the key was saved and reads back unchanged, so the key file is never dropped on a hope
#[cfg(any(windows, target_os = "macos"))]
pub fn store(key: &[u8; 32]) -> bool {
    keyring::Entry::new(SERVICE, ACCOUNT).and_then(|e| e.set_password(&to_hex(key))).is_ok() && load() == Some(*key)
}

#[cfg(not(any(windows, target_os = "macos")))]
pub fn load() -> Option<[u8; 32]> {
    let _ = (SERVICE, ACCOUNT, from_hex);
    None
}

#[cfg(not(any(windows, target_os = "macos")))]
pub fn store(key: &[u8; 32]) -> bool {
    let _ = to_hex(key);
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hex_round_trips_and_rejects_bad_text() {
        let key: [u8; 32] = std::array::from_fn(|i| (i * 7) as u8);
        assert_eq!(from_hex(&to_hex(&key)), Some(key));
        assert_eq!(from_hex("   "), None);
        assert_eq!(from_hex(&"zz".repeat(32)), None);
        assert_eq!(from_hex(&"ab".repeat(31)), None);
    }
}
