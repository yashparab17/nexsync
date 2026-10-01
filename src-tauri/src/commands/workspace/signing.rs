//! Signatures on the writes in a record's merge state.
//!
//! Every write to a task or card already says who made it, but that is only a name the writing device chose. Here each
//! write is also signed with the device's own key (the one it is known by to other devices), over exactly what was
//! written, where, and by which replica. A device that receives the write can check it came from that key, so a peer
//! cannot put words in another device's mouth, move a write to another record or field, or change a value in transit.
//!
//! What a signature does not say is who the person is: a key stands for a device. Binding a key to a name is the job of
//! the member list, which records each member's device key.

use std::str::FromStr;
use std::sync::OnceLock;

use iroh::{PublicKey, SecretKey, Signature};
use serde_json::Value;

static KEY: OnceLock<SecretKey> = OnceLock::new();

/// Sets the key writes are signed with; called once at startup. Without it writes are simply not signed.
pub fn init(secret: SecretKey) {
    let _ = KEY.set(secret);
}

/// One write, with everything a signature covers
pub struct Write<'a> {
    pub entity: &'a str,
    pub record: &'a str,
    pub path: &'a str,
    pub replica: &'a str,
    pub counter: u64,
    pub ts: u64,
    pub who: Option<&'a str>,
    pub value: &'a Value,
}

impl Write<'_> {
    /// The bytes that are signed. The prefix keeps a signature made for this purpose from being valid for any other.
    pub fn payload(&self) -> Vec<u8> {
        let Write { entity, record, path, replica, counter, ts, who, value } = self;
        format!("nexsync write v1\n{entity}\n{record}\n{path}\n{replica}\n{counter}\n{ts}\n{}\n{value}", who.unwrap_or("")).into_bytes()
    }
}

fn to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn from_hex(text: &str) -> Option<Vec<u8>> {
    if !text.len().is_multiple_of(2) || !text.is_ascii() {
        return None;
    }
    (0..text.len()).step_by(2).map(|i| u8::from_str_radix(&text[i..i + 2], 16).ok()).collect()
}

/// The signer's public key and the signature, both as text
pub fn sign_with(key: &SecretKey, write: &Write) -> (String, String) {
    (key.public().to_string(), to_hex(&key.sign(&write.payload()).to_bytes()))
}

/// Signs with this device's key, if it was set
pub fn sign(write: &Write) -> Option<(String, String)> {
    KEY.get().map(|key| sign_with(key, write))
}

/// Whether `sig` is `by`'s signature of the write
pub fn verify(by: &str, sig: &str, write: &Write) -> bool {
    let Ok(public) = PublicKey::from_str(by) else { return false };
    let Some(bytes) = from_hex(sig).and_then(|b| <[u8; Signature::LENGTH]>::try_from(b).ok()) else { return false };
    public.verify(&write.payload(), &Signature::from_bytes(&bytes)).is_ok()
}

/// A fixed key for tests that need writes to be signed
#[cfg(test)]
pub fn init_for_tests() {
    init(SecretKey::from_bytes(&[7u8; 32]));
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn key(seed: u8) -> SecretKey {
        SecretKey::from_bytes(&[seed; 32])
    }

    fn base(value: &Value) -> Write<'_> {
        Write { entity: "task", record: "t1", path: "title", replica: "r1", counter: 3, ts: 1_000, who: Some("Sam"), value }
    }

    #[test]
    fn a_signature_verifies_for_its_signer_and_for_nothing_else() {
        let (new, newer) = (json!("New"), json!("Newer"));
        let (by, sig) = sign_with(&key(1), &base(&new));
        assert!(verify(&by, &sig, &base(&new)));
        // A different value, a different signer, and a damaged or malformed signature all fail
        assert!(!verify(&by, &sig, &base(&newer)));
        assert!(!verify(&key(2).public().to_string(), &sig, &base(&new)));
        let flipped = format!("{}{}", if sig.starts_with('0') { '1' } else { '0' }, &sig[1..]);
        assert!(!verify(&by, &flipped, &base(&new)));
        assert!(!verify(&by, "not hex", &base(&new)));
        assert!(!verify("not a key", &sig, &base(&new)));
    }

    #[test]
    fn a_signature_cannot_be_moved_to_another_record_field_or_author() {
        let x = json!("x");
        let (by, sig) = sign_with(&key(1), &base(&x));
        let elsewhere = [
            Write { record: "t2", ..base(&x) },
            Write { path: "description", ..base(&x) },
            Write { entity: "card", ..base(&x) },
            Write { replica: "r2", ..base(&x) },
            Write { counter: 4, ..base(&x) },
            Write { ts: 1_001, ..base(&x) },
            Write { who: Some("Ana"), ..base(&x) },
            Write { who: None, ..base(&x) },
        ];
        for other in &elsewhere {
            assert!(!verify(&by, &sig, other));
        }
    }

    /// What signing costs, for the notes in RESEARCH.md: size added to each write, and time to sign and to check
    #[test]
    fn cost_of_signing() {
        let k = key(3);
        let title = json!("A title of the usual length for a task");
        let (by, sig) = sign_with(&k, &base(&title));
        let n = 5_000;
        let start = std::time::Instant::now();
        for _ in 0..n {
            std::hint::black_box(sign_with(&k, &base(&title)));
        }
        let sign_us = start.elapsed().as_micros() as f64 / n as f64;
        let start = std::time::Instant::now();
        for _ in 0..n {
            assert!(verify(&by, &sig, &base(&title)));
        }
        let verify_us = start.elapsed().as_micros() as f64 / n as f64;
        println!("\nsigning one write: {sign_us:.0} us, checking one: {verify_us:.0} us, added to each write as text: {} bytes (key {} + signature {})", by.len() + sig.len(), by.len(), sig.len());
    }
}
