//! Direct messages: text sealed so that only the two devices in the conversation can read it.
//!
//! A direct message is an entry of the signed log like any other (`chatlog.rs`, kind "dm"), so it travels through whichever
//! devices are linked, including the Owner's, which would otherwise be able to read what it relays. The text is therefore
//! sealed before it is written: the two devices derive the same secret from their device keys (the Ed25519 keys they are
//! known by, converted to the curve X25519 uses), and the text is encrypted with AES-256-GCM under a key made from that secret
//! and both keys. What stays visible to every device is who wrote to whom, and when; the words do not.
//!
//! What this does not give: forward secrecy (a device key that leaks opens every message ever sent to or from it), or any
//! hiding of who talks to whom. The device key is the same one that signs everything, so the people in a conversation
//! are the devices; a member who joins on a new device starts a new conversation.

use std::str::FromStr;

use aes_gcm::{aead::Aead, Aes256Gcm, KeyInit, Nonce};
use curve25519_dalek::edwards::CompressedEdwardsY;
use iroh::{PublicKey, SecretKey};
use rand::RngCore;
use sha2::{Digest, Sha512};

use crate::commands::workspace::signing::{from_hex, to_hex};

/// The channel id of the conversation between two devices: the same from either side
pub fn channel_of(a: &str, b: &str) -> String {
    let (lo, hi) = if a <= b { (a, b) } else { (b, a) };
    format!("dm.{lo}.{hi}")
}

fn key_between(mine: &SecretKey, peer: &str) -> Option<[u8; 32]> {
    let peer_public = PublicKey::from_str(peer).ok()?;
    let point = CompressedEdwardsY(*peer_public.as_bytes()).decompress()?.to_montgomery();
    // The X25519 secret of an Ed25519 key is the first half of the hash of its seed, clamped by `mul_clamped`
    let hash = Sha512::digest(mine.to_bytes());
    let mut scalar = [0u8; 32];
    scalar.copy_from_slice(&hash[..32]);
    let shared = point.mul_clamped(scalar);
    let mut keys = [mine.public().to_string(), peer.to_string()];
    keys.sort();
    let mut hasher = blake3::Hasher::new_derive_key("nexsync direct message v1");
    hasher.update(shared.as_bytes());
    hasher.update(keys[0].as_bytes());
    hasher.update(keys[1].as_bytes());
    Some(*hasher.finalize().as_bytes())
}

/// Seals text for the conversation with `peer`: hex of a fresh nonce followed by the ciphertext
pub fn seal(mine: &SecretKey, peer: &str, text: &str) -> Option<String> {
    let key = key_between(mine, peer)?;
    let mut nonce = [0u8; 12];
    rand::rngs::OsRng.fill_bytes(&mut nonce);
    let cipher = Aes256Gcm::new_from_slice(&key).ok()?;
    let sealed = cipher.encrypt(Nonce::from_slice(&nonce), text.as_bytes()).ok()?;
    Some(format!("{}{}", to_hex(&nonce), to_hex(&sealed)))
}

/// The text, or `None` for a message that is not for this device, was changed, or is not sealed
pub fn open(mine: &SecretKey, peer: &str, sealed: &str) -> Option<String> {
    let bytes = from_hex(sealed)?;
    if bytes.len() < 12 + 16 {
        return None;
    }
    let key = key_between(mine, peer)?;
    let cipher = Aes256Gcm::new_from_slice(&key).ok()?;
    let plain = cipher.decrypt(Nonce::from_slice(&bytes[..12]), &bytes[12..]).ok()?;
    String::from_utf8(plain).ok()
}

/// The body of a direct-message entry: who it is for, and the sealed text
pub fn body_for(mine: &SecretKey, to: &str, text: &str) -> Option<String> {
    let sealed = seal(mine, to, text)?;
    Some(serde_json::json!({ "to": to, "box": sealed }).to_string())
}

/// The recipient named in an entry's body
pub fn recipient(body: &str) -> Option<String> {
    serde_json::from_str::<serde_json::Value>(body).ok()?.get("to")?.as_str().map(str::to_string)
}

/// The text of a direct-message entry that `mine` wrote or was sent, with the other device's key
pub fn read_entry(mine: &SecretKey, author: &str, body: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(body).ok()?;
    let to = v.get("to")?.as_str()?;
    let me = mine.public().to_string();
    let peer = if author == me { to } else if to == me { author } else { return None };
    open(mine, peer, v.get("box")?.as_str()?)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key(n: u8) -> SecretKey {
        SecretKey::from_bytes(&[n; 32])
    }

    #[test]
    fn only_the_two_devices_read_a_message_and_either_may_read_it_back() {
        let (a, b, c) = (key(1), key(2), key(3));
        let (pa, pb) = (a.public().to_string(), b.public().to_string());
        let sealed = seal(&a, &pb, "meet at noon").unwrap();
        assert_eq!(open(&b, &pa, &sealed).as_deref(), Some("meet at noon"));
        assert_eq!(open(&a, &pb, &sealed).as_deref(), Some("meet at noon"), "the sender reads their own message");
        // A third device, with either key as the claimed peer, gets nothing
        assert!(open(&c, &pa, &sealed).is_none() && open(&c, &pb, &sealed).is_none());
        // Nothing readable is left in the sealed text, and two seals of the same words differ
        assert!(!sealed.contains("meet"));
        assert_ne!(seal(&a, &pb, "meet at noon").unwrap(), sealed);
    }

    #[test]
    fn a_changed_or_truncated_message_does_not_open_and_the_entry_helpers_pick_the_right_peer() {
        let (a, b) = (key(1), key(2));
        let (pa, pb) = (a.public().to_string(), b.public().to_string());
        let mut sealed = seal(&a, &pb, "hello").unwrap();
        let last = sealed.pop().unwrap();
        sealed.push(if last == '0' { '1' } else { '0' });
        assert!(open(&b, &pa, &sealed).is_none());
        assert!(open(&b, &pa, "abcd").is_none() && open(&b, &pa, "not hex").is_none());
        let body = body_for(&a, &pb, "hi there").unwrap();
        assert_eq!(recipient(&body).as_deref(), Some(pb.as_str()));
        assert_eq!(read_entry(&b, &pa, &body).as_deref(), Some("hi there"));
        assert_eq!(read_entry(&a, &pa, &body).as_deref(), Some("hi there"));
        assert!(read_entry(&key(3), &pa, &body).is_none());
        assert_eq!(channel_of(&pa, &pb), channel_of(&pb, &pa));
    }
}
