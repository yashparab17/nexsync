//! Invite tickets: everything a guest needs to reach and join a host.
//!
//! A ticket carries the host's Iroh address (its public key, home relay and a
//! few direct IP hints) plus a random 128-bit invite secret. The host is
//! authenticated by its key during the QUIC/TLS handshake, and the guest
//! proves it holds the ticket by sending the secret over that encrypted
//! connection, so the secret is never exposed to relays or observers.

use std::net::SocketAddr;

use data_encoding::BASE32_NOPAD;
use iroh::{EndpointAddr, EndpointId, RelayUrl, TransportAddr};
use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Serialize};

const PREFIX: &str = "nexsync";
const TICKET_VERSION: u8 = 1;
const MAX_IP_HINTS: usize = 4;
pub const SECRET_LEN: usize = 16;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Ticket {
    pub addr: EndpointAddr,
    pub secret: [u8; SECRET_LEN],
}

#[derive(Serialize, Deserialize)]
struct TicketWire {
    v: u8,
    id: [u8; 32],
    relay: Option<String>,
    addrs: Vec<SocketAddr>,
    secret: [u8; SECRET_LEN],
}

/// Generates a fresh random invite secret
pub fn generate_secret() -> [u8; SECRET_LEN] {
    let mut secret = [0u8; SECRET_LEN];
    OsRng.fill_bytes(&mut secret);
    secret
}

/// Encodes a secret for the handshake `Hello` frame
pub fn encode_secret(secret: &[u8; SECRET_LEN]) -> String {
    BASE32_NOPAD.encode(secret)
}

/// Decodes a secret received in a handshake `Hello` frame
pub fn decode_secret(encoded: &str) -> Option<[u8; SECRET_LEN]> {
    BASE32_NOPAD.decode(encoded.as_bytes()).ok()?.try_into().ok()
}

impl Ticket {
    /// Encodes the ticket as a copy-pasteable string (`nexsync…`)
    pub fn encode(&self) -> String {
        let wire = TicketWire {
            v: TICKET_VERSION,
            id: *self.addr.id.as_bytes(),
            relay: self.addr.relay_urls().next().map(|u| u.to_string()),
            addrs: self.addr.ip_addrs().take(MAX_IP_HINTS).copied().collect(),
            secret: self.secret,
        };
        let bytes = postcard::to_stdvec(&wire).expect("ticket serialization cannot fail");
        format!("{PREFIX}{}", BASE32_NOPAD.encode(&bytes).to_ascii_lowercase())
    }

    /// Parses a ticket pasted by the user, tolerating whitespace and letter case
    pub fn decode(input: &str) -> Result<Self, String> {
        const INVALID: &str = "That invite code isn't valid. Copy the whole code from the host and try again.";

        let cleaned: String = input.chars().filter(|c| !c.is_whitespace()).collect::<String>().to_ascii_lowercase();
        let body = cleaned.strip_prefix(PREFIX).ok_or(INVALID)?;
        let bytes = BASE32_NOPAD
            .decode(body.to_ascii_uppercase().as_bytes())
            .map_err(|_| INVALID)?;
        let wire: TicketWire = postcard::from_bytes(&bytes).map_err(|_| INVALID)?;
        if wire.v != TICKET_VERSION {
            return Err("This invite was created by a different version of NexSync. Update both apps and try again.".into());
        }

        let id = EndpointId::from_bytes(&wire.id).map_err(|_| INVALID)?;
        let relay = match wire.relay {
            Some(url) => Some(url.parse::<RelayUrl>().map_err(|_| INVALID)?),
            None => None,
        };
        let addrs = relay
            .into_iter()
            .map(TransportAddr::Relay)
            .chain(wire.addrs.into_iter().take(MAX_IP_HINTS).map(TransportAddr::Ip));

        Ok(Self {
            addr: EndpointAddr::from_parts(id, addrs),
            secret: wire.secret,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_ticket() -> Ticket {
        let id = iroh::SecretKey::generate().public();
        let addr = EndpointAddr::from_parts(
            id,
            [
                TransportAddr::Relay("https://relay.example.com./".parse().unwrap()),
                TransportAddr::Ip("192.168.1.20:4433".parse().unwrap()),
            ],
        );
        Ticket { addr, secret: generate_secret() }
    }

    #[test]
    fn test_ticket_roundtrip() {
        let ticket = sample_ticket();
        let encoded = ticket.encode();
        assert!(encoded.starts_with(PREFIX));
        assert_eq!(Ticket::decode(&encoded).unwrap(), ticket);
    }

    #[test]
    fn test_ticket_tolerates_whitespace_and_case() {
        let ticket = sample_ticket();
        let encoded = ticket.encode();
        let (a, b) = encoded.split_at(20);
        let messy = format!("  {}\n {} ", a.to_ascii_uppercase(), b);
        assert_eq!(Ticket::decode(&messy).unwrap(), ticket);
    }

    #[test]
    fn test_invalid_tickets_rejected() {
        assert!(Ticket::decode("").is_err());
        assert!(Ticket::decode("NX-7F3K-9QRT").is_err());
        assert!(Ticket::decode("nexsyncnotbase32!!").is_err());
        let mut truncated = sample_ticket().encode();
        truncated.truncate(truncated.len() - 10);
        assert!(Ticket::decode(&truncated).is_err());
    }

    #[test]
    fn test_secret_roundtrip() {
        let secret = generate_secret();
        assert_eq!(decode_secret(&encode_secret(&secret)), Some(secret));
        assert_eq!(decode_secret("short"), None);
    }
}
