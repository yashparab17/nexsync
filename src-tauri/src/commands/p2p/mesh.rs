//! Guest-to-guest links, so collaborators keep syncing when the host goes offline.
//!
//! The host knows every guest, so it vouches for them: it gives each pair of guests a shared random
//! token and tells both about the other (`MESH_STATE`). The guest that joined later dials the
//! earlier one and shows the token, which the receiver checks against what the host told it.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use super::ticket::{self, SECRET_LEN};

pub const KIND_MESH_STATE: &str = "MESH_STATE";

/// One other guest, as the host describes it to a guest
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MeshPeer {
    pub id: String,
    pub name: String,
    pub role: String,
    /// Secret shared by this pair of guests
    pub token: String,
    /// True if the receiver of this entry should open the connection
    pub dial: bool,
}

/// Sent by the host to each guest whenever guests join, leave or change role
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MeshState {
    pub kind: String,
    pub peers: Vec<MeshPeer>,
}

/// What a guest may accept from another guest, as vouched for by the host
#[derive(Debug, Clone)]
pub struct MeshAllow {
    pub token: [u8; SECRET_LEN],
    pub name: String,
    pub role: String,
}

/// A connected guest as the host sees it
#[derive(Debug, Clone)]
pub struct GuestRow {
    pub id: String,
    pub name: String,
    pub role: String,
    pub connected_at: u64,
}

/// The host's tokens, one per pair of guests, kept stable so repeated updates agree
#[derive(Default)]
pub struct MeshTokens(HashMap<(String, String), [u8; SECRET_LEN]>);

impl MeshTokens {
    fn token(&mut self, a: &str, b: &str) -> [u8; SECRET_LEN] {
        let key = if a < b { (a.to_string(), b.to_string()) } else { (b.to_string(), a.to_string()) };
        *self.0.entry(key).or_insert_with(ticket::generate_secret)
    }

    /// Forgets every pair that includes `id`, so a guest that left cannot be dialed back in later
    pub fn forget(&mut self, id: &str) {
        self.0.retain(|(a, b), _| a != id && b != id);
    }

    pub fn clear(&mut self) {
        self.0.clear();
    }
}

/// The state the host sends `guest`: every other guest, the shared token and who dials whom
pub fn state_for(guest: &GuestRow, all: &[GuestRow], tokens: &mut MeshTokens) -> MeshState {
    let peers = all
        .iter()
        .filter(|other| other.id != guest.id)
        .map(|other| MeshPeer {
            id: other.id.clone(),
            name: other.name.clone(),
            role: other.role.clone(),
            token: ticket::encode_secret(&tokens.token(&guest.id, &other.id)),
            dial: (other.connected_at, &other.id) < (guest.connected_at, &guest.id),
        })
        .collect();
    MeshState { kind: KIND_MESH_STATE.to_string(), peers }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(id: &str, connected_at: u64) -> GuestRow {
        GuestRow { id: id.into(), name: id.into(), role: "Editor".into(), connected_at }
    }

    #[test]
    fn test_only_the_later_guest_dials_and_both_share_one_token() {
        let (early, late) = (row("a", 1), row("b", 2));
        let all = [early.clone(), late.clone()];
        let mut tokens = MeshTokens::default();

        let for_early = state_for(&early, &all, &mut tokens);
        let for_late = state_for(&late, &all, &mut tokens);
        assert_eq!(for_early.peers.len(), 1);
        assert!(!for_early.peers[0].dial, "the earlier guest waits");
        assert!(for_late.peers[0].dial, "the later guest dials");
        assert_eq!(for_early.peers[0].token, for_late.peers[0].token);
        assert_eq!(state_for(&late, &all, &mut tokens), for_late, "repeat updates must agree");
    }

    #[test]
    fn test_a_guest_that_left_gets_a_new_token_if_it_returns() {
        let (a, b) = (row("a", 1), row("b", 2));
        let all = [a.clone(), b.clone()];
        let mut tokens = MeshTokens::default();
        let before = state_for(&a, &all, &mut tokens).peers[0].token.clone();
        tokens.forget("b");
        assert_ne!(state_for(&a, &all, &mut tokens).peers[0].token, before);
    }
}
