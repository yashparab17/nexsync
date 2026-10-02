//! Who belongs to a workspace, as data that every member can check without the host.
//!
//! Until now a device believed the member list because the host sent it. With no host in the room that is not enough, so
//! the list the network acts on is a small signed document: the owner's key signs each version, versions are numbered
//! (`epoch`), and a device only accepts a version that is genuine and newer than the one it has. Admission to the
//! workspace, a member's role, and the removal of a member all follow from the newest document a device holds.
//!
//! Ownership passes by the same mechanism: the owner signs a version that names the next owner, and the next owner signs
//! the versions after it. Nothing else says who the owner is.
//!
//! What this does not do: a device that has not heard about a newer version still acts on its old one. Versions travel
//! to every device a member meets (see `Node::on_membership`), which bounds how long that lasts but cannot remove it.

use std::collections::{BTreeSet, HashMap};
use std::str::FromStr;

use iroh::{PublicKey, SecretKey, Signature};
use serde::{Deserialize, Serialize};

use crate::commands::workspace::signing::{from_hex, to_hex};
use crate::database::WorkspaceDb;

/// Most members one workspace can have; the merge state of a record has the same ceiling
pub const MAX_MEMBERS: usize = 64;
const ROLES: &[&str] = &["Admin", "Editor", "Viewer"];

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Membership {
    /// The workspace as the host knows it; a joined copy has another id of its own
    pub workspace_id: String,
    pub workspace_name: String,
    /// Grows by one with every change; a device keeps the highest it has seen
    pub epoch: u64,
    /// The device key whose signature the next version needs
    pub owner: String,
    /// Who signed this version: the owner, or the previous owner when handing over
    pub signer: String,
    /// Device key and role of every member except the owner, sorted by key
    pub members: Vec<(String, String)>,
    /// Devices that were members and no longer are, sorted
    pub removed: Vec<String>,
    pub sig: String,
}

#[derive(Serialize)]
struct Unsigned<'a> {
    workspace_id: &'a str,
    workspace_name: &'a str,
    epoch: u64,
    owner: &'a str,
    signer: &'a str,
    members: &'a [(String, String)],
    removed: &'a [String],
}

fn is_key(text: &str) -> bool {
    PublicKey::from_str(text).is_ok()
}

impl Membership {
    /// The bytes that are signed. The prefix keeps a signature made for this from being valid for anything else.
    fn payload(&self) -> Vec<u8> {
        let body = Unsigned {
            workspace_id: &self.workspace_id,
            workspace_name: &self.workspace_name,
            epoch: self.epoch,
            owner: &self.owner,
            signer: &self.signer,
            members: &self.members,
            removed: &self.removed,
        };
        let mut bytes = b"nexsync membership v1\n".to_vec();
        bytes.extend(serde_json::to_vec(&body).unwrap_or_default());
        bytes
    }

    pub fn role_of(&self, device: &str) -> Option<&str> {
        self.members.iter().find(|(id, _)| id == device).map(|(_, role)| role.as_str())
    }

    pub fn roles(&self) -> HashMap<String, String> {
        self.members.iter().cloned().collect()
    }

    /// Everything except the signature: sizes, order, roles and that the keys are keys
    fn well_formed(&self) -> Result<(), String> {
        if self.epoch == 0 || self.workspace_id.is_empty() {
            return Err("not a membership list".into());
        }
        if self.members.len() > MAX_MEMBERS || self.removed.len() > 4 * MAX_MEMBERS {
            return Err("too many members".into());
        }
        if !is_key(&self.owner) || !is_key(&self.signer) {
            return Err("owner or signer is not a key".into());
        }
        let ids: Vec<&String> = self.members.iter().map(|(id, _)| id).collect();
        if !ids.windows(2).all(|w| w[0] < w[1]) || !self.removed.windows(2).all(|w| w[0] < w[1]) {
            return Err("members are not sorted and unique".into());
        }
        let in_list: BTreeSet<&String> = ids.into_iter().collect();
        if in_list.contains(&self.owner) || self.removed.iter().any(|id| in_list.contains(id)) {
            return Err("a device is listed twice".into());
        }
        if self.members.iter().any(|(id, role)| !is_key(id) || !ROLES.contains(&role.as_str())) {
            return Err("a member has no key or an unknown role".into());
        }
        Ok(())
    }

    /// Whether the signature is the signer's over this exact content
    pub fn verify(&self) -> Result<(), String> {
        self.well_formed()?;
        let public = PublicKey::from_str(&self.signer).map_err(|_| "signer is not a key".to_string())?;
        let bytes = from_hex(&self.sig).and_then(|b| <[u8; Signature::LENGTH]>::try_from(b).ok()).ok_or("malformed signature")?;
        public.verify(&self.payload(), &Signature::from_bytes(&bytes)).map_err(|_| "the signature does not match".to_string())
    }
}

/// Builds and signs one version of the list
pub fn issue(secret: &SecretKey, workspace_id: &str, workspace_name: &str, epoch: u64, owner: &str, mut members: Vec<(String, String)>, mut removed: Vec<String>) -> Membership {
    members.sort();
    members.dedup_by(|a, b| a.0 == b.0);
    removed.sort();
    removed.dedup();
    let mut m = Membership {
        workspace_id: workspace_id.to_string(),
        workspace_name: workspace_name.to_string(),
        epoch,
        owner: owner.to_string(),
        signer: secret.public().to_string(),
        members,
        removed,
        sig: String::new(),
    };
    m.sig = to_hex(&secret.sign(&m.payload()).to_bytes());
    m
}

/// Whether a device holding `current` should take `incoming`. A first document is judged by the caller, which knows
/// whom it dialed; every later one must be signed by the owner `current` names, and be newer.
pub fn accept(current: Option<&Membership>, incoming: &Membership) -> Result<(), String> {
    incoming.verify()?;
    match current {
        None if incoming.signer != incoming.owner => Err("a first list must be signed by its owner".into()),
        None => Ok(()),
        Some(cur) if cur.workspace_id != incoming.workspace_id => Err("that is another workspace".into()),
        Some(cur) if incoming.epoch <= cur.epoch => Err("not newer than the list already held".into()),
        Some(cur) if incoming.signer != cur.owner => Err("not signed by the owner".into()),
        Some(_) => Ok(()),
    }
}

/// The owner's next version for the members it now has, or `None` when nothing changed. Whoever is not the owner cannot
/// publish.
pub fn next(current: Option<&Membership>, secret: &SecretKey, workspace_id: &str, workspace_name: &str, members: Vec<(String, String)>) -> Result<Option<Membership>, String> {
    let me = secret.public().to_string();
    let mut members: Vec<(String, String)> = members.into_iter().filter(|(id, _)| *id != me).collect();
    members.sort();
    members.dedup_by(|a, b| a.0 == b.0);
    let Some(cur) = current.filter(|c| c.workspace_id == workspace_id) else {
        return Ok(Some(issue(secret, workspace_id, workspace_name, 1, &me, members, vec![])));
    };
    if cur.owner != me {
        return Err("only the owner can change who is in the workspace".into());
    }
    if cur.members == members && cur.workspace_name == workspace_name {
        return Ok(None);
    }
    // Everyone who was a member and is not any more stays on record as removed, so peers can drop them
    let now: BTreeSet<&String> = members.iter().map(|(id, _)| id).collect();
    let mut removed: BTreeSet<String> = cur.removed.iter().cloned().collect();
    removed.extend(cur.members.iter().map(|(id, _)| id.clone()).filter(|id| !now.contains(id)));
    removed.retain(|id| !now.contains(id));
    Ok(Some(issue(secret, workspace_id, workspace_name, cur.epoch + 1, &me, members, removed.into_iter().collect())))
}

/// The version that makes `new_owner` the owner: signed by the current owner, who stays a member as an Admin
pub fn hand_off(current: &Membership, secret: &SecretKey, new_owner: &str) -> Result<Membership, String> {
    let me = secret.public().to_string();
    if current.owner != me {
        return Err("only the owner can hand the workspace over".into());
    }
    if !is_key(new_owner) || new_owner == me {
        return Err("that is not another device".into());
    }
    let mut members: Vec<(String, String)> = current.members.iter().filter(|(id, _)| id != new_owner).cloned().collect();
    members.push((me.clone(), "Admin".into()));
    let removed = current.removed.iter().filter(|id| id.as_str() != new_owner).cloned().collect();
    Ok(issue(secret, &current.workspace_id, &current.workspace_name, current.epoch + 1, new_owner, members, removed))
}

// ────────────────────────────
// Storage: one row in the workspace's own database
// ────────────────────────────

/// The list stored with this workspace, if it is there and genuine
pub fn load(workspace: &str) -> Option<Membership> {
    let db = WorkspaceDb::open_existing(workspace).ok()?;
    let doc: String = db.conn.query_row("SELECT doc FROM membership WHERE id = 1", [], |r| r.get(0)).ok()?;
    let m: Membership = serde_json::from_str(&doc).ok()?;
    m.verify().ok().map(|_| m)
}

pub fn store(workspace: &str, m: &Membership) -> Result<(), String> {
    let db = WorkspaceDb::open_existing(workspace)?;
    let doc = serde_json::to_string(m).map_err(|e| e.to_string())?;
    db.conn
        .execute("INSERT OR REPLACE INTO membership (id, doc) VALUES (1, ?1)", [&doc])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key(seed: u8) -> SecretKey {
        SecretKey::from_bytes(&[seed; 32])
    }
    fn id(seed: u8) -> String {
        key(seed).public().to_string()
    }
    fn roster(seeds: &[(u8, &str)]) -> Vec<(String, String)> {
        seeds.iter().map(|(s, role)| (id(*s), role.to_string())).collect()
    }
    fn first(owner: u8, members: &[(u8, &str)]) -> Membership {
        next(None, &key(owner), "ws", "Demo", roster(members)).unwrap().unwrap()
    }

    #[test]
    fn a_list_is_genuine_only_if_nothing_in_it_was_changed() {
        let m = first(1, &[(2, "Editor"), (3, "Viewer")]);
        assert_eq!(m.epoch, 1);
        assert!(m.verify().is_ok());
        for tampered in [
            Membership { members: roster(&[(2, "Admin"), (3, "Viewer")]), ..m.clone() },
            Membership { epoch: 9, ..m.clone() },
            Membership { workspace_name: "Other".into(), ..m.clone() },
            Membership { sig: "00".repeat(64), ..m.clone() },
        ] {
            assert!(tampered.verify().is_err());
        }
        // Someone else's key, even with a correct signature, is not the owner's
        let forged = issue(&key(9), "ws", "Demo", 2, &id(1), roster(&[(9, "Admin")]), vec![]);
        assert!(forged.verify().is_ok());
        assert!(accept(Some(&m), &forged).is_err(), "signed by a device that is not the owner");
    }

    #[test]
    fn only_a_newer_list_from_the_owner_is_taken() {
        let one = first(1, &[(2, "Editor")]);
        let two = next(Some(&one), &key(1), "ws", "Demo", roster(&[(2, "Editor"), (3, "Editor")])).unwrap().unwrap();
        assert_eq!(two.epoch, 2);
        assert!(accept(Some(&one), &two).is_ok());
        assert!(accept(Some(&two), &one).is_err(), "an old list does not replace a newer one");
        assert!(accept(Some(&two), &two).is_err(), "nor does the same one");
        let other = next(None, &key(1), "elsewhere", "Demo", vec![]).unwrap().unwrap();
        assert!(accept(Some(&one), &Membership { epoch: 5, ..other }).is_err(), "another workspace");
        // A first list must at least be signed by the owner it names
        let claim = issue(&key(9), "ws", "Demo", 1, &id(1), vec![], vec![]);
        assert!(accept(None, &claim).is_err());
        assert!(accept(None, &one).is_ok());
    }

    #[test]
    fn publishing_changes_the_epoch_only_when_the_members_change() {
        let one = first(1, &[(2, "Editor"), (3, "Viewer")]);
        assert!(next(Some(&one), &key(1), "ws", "Demo", roster(&[(3, "Viewer"), (2, "Editor")])).unwrap().is_none(), "same members in another order");
        let changed = next(Some(&one), &key(1), "ws", "Demo", roster(&[(2, "Admin"), (3, "Viewer")])).unwrap().unwrap();
        assert_eq!((changed.epoch, changed.role_of(&id(2))), (2, Some("Admin")));
        assert!(next(Some(&one), &key(2), "ws", "Demo", vec![]).is_err(), "a member cannot publish");
    }

    #[test]
    fn a_removed_member_stays_on_record_and_can_be_added_again() {
        let one = first(1, &[(2, "Editor"), (3, "Viewer")]);
        let gone = next(Some(&one), &key(1), "ws", "Demo", roster(&[(3, "Viewer")])).unwrap().unwrap();
        assert_eq!(gone.removed, vec![id(2)]);
        assert!(gone.role_of(&id(2)).is_none());
        let back = next(Some(&gone), &key(1), "ws", "Demo", roster(&[(2, "Viewer"), (3, "Viewer")])).unwrap().unwrap();
        assert!(back.removed.is_empty());
        assert_eq!(back.role_of(&id(2)), Some("Viewer"));
    }

    #[test]
    fn the_owner_does_not_appear_among_the_members_and_the_size_is_capped() {
        let m = first(1, &[(1, "Editor"), (2, "Editor")]);
        assert_eq!(m.members.len(), 1);
        let many: Vec<(String, String)> = (0..=MAX_MEMBERS as u8).map(|s| (id(s + 10), "Editor".to_string())).collect();
        let big = issue(&key(1), "ws", "Demo", 1, &id(1), many, vec![]);
        assert!(big.verify().is_err());
    }

    #[test]
    fn ownership_passes_by_a_list_the_old_owner_signs_and_the_new_owner_continues() {
        let one = first(1, &[(2, "Editor"), (3, "Viewer")]);
        let handed = hand_off(&one, &key(1), &id(2)).unwrap();
        assert_eq!((handed.owner.as_str(), handed.signer.as_str()), (id(2).as_str(), id(1).as_str()));
        assert_eq!(handed.role_of(&id(1)), Some("Admin"), "the old owner stays on as an Admin");
        assert!(handed.role_of(&id(2)).is_none(), "the owner is not listed as a member");
        assert!(accept(Some(&one), &handed).is_ok());
        // From then on the new owner's signature counts and the old owner's does not
        let after = next(Some(&handed), &key(2), "ws", "Demo", roster(&[(1, "Admin"), (3, "Editor")])).unwrap().unwrap();
        assert!(accept(Some(&handed), &after).is_ok());
        assert!(next(Some(&handed), &key(1), "ws", "Demo", vec![]).is_err());
        let late = issue(&key(1), "ws", "Demo", 9, &id(1), vec![], vec![]);
        assert!(accept(Some(&after), &late).is_err(), "the old owner can no longer take the workspace back");
        assert!(hand_off(&one, &key(2), &id(3)).is_err(), "only the owner hands over");
    }

    #[test]
    fn the_list_is_kept_with_the_workspace_and_a_damaged_copy_is_ignored() {
        let dir = std::env::temp_dir().join(format!("nexsync-membership-{}", uuid::Uuid::new_v4()));
        let db = WorkspaceDb::open(dir.to_str().unwrap()).unwrap();
        let path = dir.to_string_lossy().to_string();
        assert!(load(&path).is_none());
        let m = first(1, &[(2, "Editor")]);
        store(&path, &m).unwrap();
        assert_eq!(load(&path), Some(m.clone()));
        let newer = next(Some(&m), &key(1), "ws", "Demo", vec![]).unwrap().unwrap();
        store(&path, &newer).unwrap();
        assert_eq!(load(&path).map(|l| l.epoch), Some(2));
        db.conn.execute("UPDATE membership SET doc = replace(doc, 'Demo', 'Evil')", []).unwrap();
        assert!(load(&path).is_none(), "an edited list fails its signature");
        drop(db);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
