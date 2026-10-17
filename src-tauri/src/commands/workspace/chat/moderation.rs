//! Moderation of a workspace: timeouts, kicks, bans, the rule that needs a second Admin, and the log of all of it.
//!
//! Every moderation act is an entry of the signed log (`chatlog.rs`, kind "moderation"), so it is signed by whoever did it,
//! it spreads over direct links and in catch-up like a message does, it cannot be forged by a device that only relays it,
//! and it is the moderation log: what happened, who did it, to whom, when and why. What is in force now is worked out from
//! the entries by `reduce`, the same way on every device.
//!
//! Who may do what: the Owner may do everything but act on the Owner. An Admin may time out or kick a member who is not an
//! Admin, and may approve what another Admin asked for. Only the Owner bans, unbans, and sets the two-person rule. A kick
//! asks for the member to be removed from the signed member list, which only the Owner's device signs: it does that when it
//! sees the entry, so an Admin's kick takes effect while the Owner is online.
//!
//! A timeout is enforced by every device that holds the entry: the member is disconnected, refused while it lasts, and its
//! task and card writes are held for an Admin (`held.rs`). It ends by itself, by each device's clock (RESEARCH.md §8h).

use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use super::chatlog::{self, Entry, Role};
use crate::commands::p2p::membership::Membership;

pub const KIND: &str = "moderation";

/// The longest a timeout may be, and the longest reason
pub const MAX_TIMEOUT_MS: u64 = 30 * 24 * 60 * 60 * 1000;
pub const MAX_REASON: usize = 200;

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Action {
    /// "timeout", "untimeout", "kick", "ban", "unban", "approve", "policy", "delete", "kicked", "role" or "handoff"
    pub action: String,
    /// The device key acted on
    #[serde(default)]
    pub target: String,
    #[serde(default)]
    pub target_name: String,
    /// For a timeout: when it ends, in milliseconds since 1970
    #[serde(default)]
    pub until: u64,
    #[serde(default)]
    pub reason: String,
    /// For an approval, or the note that a kick was carried out: the entry it is about
    #[serde(default)]
    pub of: String,
    /// For a policy: whether a kick or ban needs a second person
    #[serde(default)]
    pub require_two: bool,
    /// For a role change: the new role
    #[serde(default)]
    pub role: String,
}

pub fn parse(body: &str) -> Option<Action> {
    serde_json::from_str(body).ok()
}

/// Why an act may not be done, or `Ok`. `target_role` is the role of the one acted on in the member list; a member who was
/// removed, or a key not on the list, has none.
pub fn allowed(actor: Role, target_role: Option<Role>, a: &Action, at: u64) -> Result<(), &'static str> {
    if a.reason.chars().count() > MAX_REASON {
        return Err("the reason is too long");
    }
    if actor < Role::Admin {
        return Err("only Admins and the Owner moderate");
    }
    match a.action.as_str() {
        "timeout" | "untimeout" | "kick" => {
            if a.target.is_empty() {
                return Err("it names nobody");
            }
            if target_role == Some(Role::Owner) {
                return Err("nobody acts on the Owner");
            }
            if actor == Role::Admin && target_role.is_some_and(|r| r >= Role::Admin) {
                return Err("an Admin cannot act on an Admin");
            }
            if a.action == "timeout" && (a.until <= at || a.until > at.saturating_add(MAX_TIMEOUT_MS)) {
                return Err("a timeout lasts from a moment to 30 days");
            }
            Ok(())
        }
        "ban" | "unban" | "policy" | "delete" | "kicked" if actor != Role::Owner => Err("only the Owner does that"),
        "ban" | "unban" => {
            if a.target.is_empty() {
                return Err("it names nobody");
            }
            if target_role == Some(Role::Owner) {
                return Err("nobody acts on the Owner");
            }
            Ok(())
        }
        // A request to delete the workspace names nobody; with the two-person rule on it waits for another Admin
        "kicked" | "policy" | "delete" => Ok(()),
        // An approval answers an entry; a role change or a handoff is a note of what the Owner's device did
        "approve" | "role" | "handoff" => Ok(()),
        _ => Err("unknown action"),
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Banned {
    pub key: String,
    pub name: String,
    pub by: String,
    pub at: u64,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimedOut {
    pub key: String,
    pub name: String,
    pub until: u64,
    pub by: String,
    pub at: u64,
    pub reason: String,
}

/// A kick or ban that is waiting for something
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Pending {
    pub id: String,
    pub action: String,
    pub target: String,
    pub target_name: String,
    pub by: String,
    pub by_key: String,
    pub at: u64,
    pub reason: String,
}

/// What is in force, worked out from the entries
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct State {
    pub banned: Vec<Banned>,
    /// Timeouts that have not ended yet
    pub timeouts: Vec<TimedOut>,
    /// Kicks and bans in force whose removal from the member list the Owner's device has not carried out yet
    pub to_remove: Vec<Pending>,
    /// Kicks and bans that need a second person under the two-person rule
    pub awaiting: Vec<Pending>,
    pub require_two: bool,
    /// When the Owner's newest request to delete the workspace was approved by a second person; 0 for none
    pub delete_approved_at: u64,
}

impl State {
    pub fn is_banned(&self, key: &str) -> bool {
        self.banned.iter().any(|b| b.key == key)
    }

    pub fn is_timed_out(&self, key: &str) -> bool {
        self.timeouts.iter().any(|t| t.key == key)
    }
}

/// The entries of kind "moderation" in order, with what each says; entries that are not allowed (by the author's role now)
/// are left out
fn actions(entries: &[Entry], role_of: &dyn Fn(&str) -> Option<Role>) -> Vec<(Entry, Action)> {
    let mut list: Vec<&Entry> = entries.iter().filter(|e| e.kind == KIND).collect();
    list.sort_by(|a, b| (a.ts, &a.id).cmp(&(b.ts, &b.id)));
    list.into_iter()
        .filter_map(|e| {
            let a = parse(&e.body)?;
            let actor = role_of(&e.author)?;
            allowed(actor, role_of(&a.target), &a, e.ts).ok()?;
            Some((e.clone(), a))
        })
        .collect()
}

pub fn reduce(entries: &[Entry], role_of: &dyn Fn(&str) -> Option<Role>, now: u64) -> State {
    let acts = actions(entries, role_of);
    // The two-person rule is the Owner's newest setting
    let require_two = acts.iter().rev().find(|(_, a)| a.action == "policy").is_some_and(|(_, a)| a.require_two);

    let mut st = State { require_two, ..Default::default() };
    // Kicks and bans that took effect, by target, with the time of the newest
    let mut effective: Vec<(Entry, Action)> = Vec::new();
    for (e, a) in &acts {
        let pending = |e: &Entry, a: &Action| Pending { id: e.id.clone(), action: a.action.clone(), target: a.target.clone(), target_name: a.target_name.clone(), by: e.name.clone(), by_key: e.author.clone(), at: e.ts, reason: a.reason.clone() };
        match a.action.as_str() {
            "timeout" => {
                st.timeouts.retain(|t| t.key != a.target);
                st.timeouts.push(TimedOut { key: a.target.clone(), name: a.target_name.clone(), until: a.until, by: e.name.clone(), at: e.ts, reason: a.reason.clone() });
            }
            "untimeout" => st.timeouts.retain(|t| t.key != a.target),
            "kick" | "ban" | "delete" if require_two => st.awaiting.push(pending(e, a)),
            "kick" | "ban" => effective.push((e.clone(), a.clone())),
            "approve" => {
                // A second person, not the one who asked
                if let Some(i) = st.awaiting.iter().position(|p| p.id == a.of && p.by_key != e.author) {
                    let p = st.awaiting.remove(i);
                    if let Some((orig, orig_action)) = acts.iter().find(|(o, _)| o.id == p.id) {
                        if orig_action.action == "delete" {
                            st.delete_approved_at = st.delete_approved_at.max(e.ts);
                        } else {
                            effective.push((orig.clone(), orig_action.clone()));
                        }
                    }
                }
            }
            "unban" => st.banned.retain(|b| b.key != a.target),
            _ => {}
        }
    }
    // Apply the bans in force in time order, so an unban after a ban cancels it
    let mut bans: Vec<(&Entry, &Action)> = effective.iter().filter(|(_, a)| a.action == "ban").map(|(e, a)| (e, a)).collect();
    bans.sort_by(|a, b| (a.0.ts, &a.0.id).cmp(&(b.0.ts, &b.0.id)));
    for (e, a) in bans {
        // An unban newer than the ban cancels it
        let cancelled = acts.iter().any(|(u, ua)| ua.action == "unban" && ua.target == a.target && (u.ts, &u.id) > (e.ts, &e.id));
        if !cancelled && !st.is_banned(&a.target) {
            st.banned.push(Banned { key: a.target.clone(), name: a.target_name.clone(), by: e.name.clone(), at: e.ts, reason: a.reason.clone() });
        }
    }
    // A banned member is not also timed out
    let banned: Vec<String> = st.banned.iter().map(|b| b.key.clone()).collect();
    st.timeouts.retain(|t| t.until > now && !banned.contains(&t.key));

    // Removals the Owner's device still has to carry out: a kick or ban in force with no later "kicked" note for the target
    for (e, a) in &effective {
        let done = acts.iter().any(|(k, ka)| ka.action == "kicked" && ka.target == a.target && (k.ts, &k.id) > (e.ts, &e.id));
        let cancelled = a.action == "ban" && !st.is_banned(&a.target);
        if !done && !cancelled && !st.to_remove.iter().any(|p| p.target == a.target) {
            st.to_remove.push(Pending { id: e.id.clone(), action: a.action.clone(), target: a.target.clone(), target_name: a.target_name.clone(), by: e.name.clone(), by_key: e.author.clone(), at: e.ts, reason: a.reason.clone() });
        }
    }
    st
}

/// The signed member list stored with the workspace, if there is a genuine one, and what the moderation entries say now
pub fn load(conn: &Connection, now: u64) -> (Option<Membership>, State) {
    let doc: Option<String> = conn.query_row("SELECT doc FROM membership WHERE id = 1", [], |r| r.get(0)).optional().ok().flatten();
    let list = doc.and_then(|d| serde_json::from_str::<Membership>(&d).ok()).filter(|m| m.verify().is_ok());
    let Some(m) = &list else { return (None, State::default()) };
    let roles = m.roles();
    let role_of = |k: &str| if k == m.owner { Some(Role::Owner) } else { roles.get(k).and_then(|r| Role::parse(r)) };
    let entries = chatlog::list_kind(conn, KIND).unwrap_or_default();
    let state = reduce(&entries, &role_of, now);
    (list, state)
}

#[cfg(test)]
mod tests {
    use super::*;
    use iroh::SecretKey;

    fn key(n: u8) -> SecretKey {
        SecretKey::from_bytes(&[n; 32])
    }
    fn id(n: u8) -> String {
        key(n).public().to_string()
    }

    /// Owner 1, Admins 2 and 3, Editor 4, Commenter 5, Viewer 6
    fn role_of(k: &str) -> Option<Role> {
        [(1, Role::Owner), (2, Role::Admin), (3, Role::Admin), (4, Role::Editor), (5, Role::Commenter), (6, Role::Viewer)].into_iter().find(|(n, _)| id(*n) == k).map(|(_, r)| r)
    }

    fn act(by: u8, ts: u64, a: Action) -> Entry {
        Entry::signed_with(&key(by), KIND, "moderation", "", &serde_json::to_string(&a).unwrap(), ts)
    }
    fn on(action: &str, target: u8) -> Action {
        Action { action: action.into(), target: id(target), target_name: format!("member {target}"), ..Default::default() }
    }
    fn timeout(target: u8, until: u64) -> Action {
        Action { until, reason: "cool off".into(), ..on("timeout", target) }
    }

    #[test]
    fn deleting_the_workspace_waits_for_a_second_person_when_the_rule_is_on() {
        let on = act(1, 500, Action { action: "policy".into(), require_two: true, ..Default::default() });
        let ask = act(1, 600, Action { action: "delete".into(), ..Default::default() });
        let st = reduce(&[on.clone(), ask.clone()], &role_of, 2_000);
        assert_eq!((st.awaiting.len(), st.delete_approved_at), (1, 0));
        // The Owner cannot approve their own request, an Admin can
        let own = act(1, 700, Action { action: "approve".into(), of: ask.id.clone(), ..Default::default() });
        assert_eq!(reduce(&[on.clone(), ask.clone(), own], &role_of, 2_000).delete_approved_at, 0);
        let other = act(2, 800, Action { action: "approve".into(), of: ask.id.clone(), ..Default::default() });
        let st = reduce(&[on, ask.clone(), other], &role_of, 2_000);
        assert_eq!((st.awaiting.len(), st.delete_approved_at), (0, 800));
        // An Admin may not ask for it
        assert!(allowed(Role::Admin, None, &Action { action: "delete".into(), ..Default::default() }, 100).is_err());
    }

    #[test]
    fn who_may_do_what() {
        let a = |name: &str| on(name, 4);
        assert!(allowed(Role::Admin, Some(Role::Editor), &Action { until: 500, ..a("timeout") }, 100).is_ok());
        assert!(allowed(Role::Admin, Some(Role::Editor), &a("kick"), 100).is_ok());
        assert!(allowed(Role::Editor, Some(Role::Viewer), &a("kick"), 100).is_err(), "an Editor does not moderate");
        assert!(allowed(Role::Admin, Some(Role::Admin), &a("kick"), 100).is_err(), "an Admin cannot act on an Admin");
        assert!(allowed(Role::Owner, Some(Role::Admin), &a("kick"), 100).is_ok());
        assert!(allowed(Role::Owner, Some(Role::Owner), &a("kick"), 100).is_err(), "nobody acts on the Owner");
        assert!(allowed(Role::Admin, Some(Role::Editor), &a("ban"), 100).is_err(), "only the Owner bans");
        assert!(allowed(Role::Admin, Some(Role::Editor), &a("unban"), 100).is_err());
        assert!(allowed(Role::Admin, None, &Action { action: "policy".into(), require_two: true, ..Default::default() }, 100).is_err());
        assert!(allowed(Role::Owner, Some(Role::Editor), &Action { until: 100 + MAX_TIMEOUT_MS + 1, ..a("timeout") }, 100).is_err(), "too long");
        assert!(allowed(Role::Owner, Some(Role::Editor), &Action { until: 100, ..a("timeout") }, 100).is_err(), "already over");
        assert!(allowed(Role::Owner, None, &Action { reason: "x".repeat(201), ..a("kick") }, 100).is_err());
    }

    #[test]
    fn a_timeout_is_in_force_until_it_ends_and_an_untimeout_cancels_it() {
        let entries = vec![act(2, 1_000, timeout(4, 5_000)), act(2, 1_100, timeout(5, 9_000))];
        let during = reduce(&entries, &role_of, 2_000);
        assert!(during.is_timed_out(&id(4)) && during.is_timed_out(&id(5)));
        let after = reduce(&entries, &role_of, 6_000);
        assert!(!after.is_timed_out(&id(4)), "ended by itself");
        assert!(after.is_timed_out(&id(5)));
        let mut cancelled = entries.clone();
        cancelled.push(act(1, 1_500, on("untimeout", 5)));
        assert!(!reduce(&cancelled, &role_of, 2_000).is_timed_out(&id(5)));
        // An Admin's timeout of an Admin does nothing
        assert!(!reduce(&[act(2, 1_000, timeout(3, 5_000))], &role_of, 2_000).is_timed_out(&id(3)));
    }

    #[test]
    fn a_ban_holds_until_the_owner_lifts_it_and_an_admin_cannot_ban_or_lift() {
        let ban = act(1, 1_000, Action { reason: "spam".into(), ..on("ban", 4) });
        let st = reduce(std::slice::from_ref(&ban), &role_of, 2_000);
        assert!(st.is_banned(&id(4)));
        assert_eq!(st.banned[0].reason, "spam");
        assert_eq!(st.to_remove.len(), 1, "the Owner's device still has to remove them from the list");
        // An Admin's ban is not allowed, and neither is an Admin's unban
        assert!(!reduce(&[act(2, 1_000, on("ban", 4))], &role_of, 2_000).is_banned(&id(4)));
        assert!(reduce(&[ban.clone(), act(2, 1_500, on("unban", 4))], &role_of, 2_000).is_banned(&id(4)));
        assert!(!reduce(&[ban, act(1, 1_500, on("unban", 4))], &role_of, 2_000).is_banned(&id(4)));
    }

    #[test]
    fn an_admins_kick_waits_for_the_owner_device_and_is_done_once_it_notes_it() {
        let kick = act(2, 1_000, on("kick", 4));
        let st = reduce(std::slice::from_ref(&kick), &role_of, 2_000);
        assert_eq!(st.to_remove.iter().map(|p| p.target.clone()).collect::<Vec<_>>(), vec![id(4)]);
        let done = act(1, 1_200, Action { of: kick.id.clone(), ..on("kicked", 4) });
        assert!(reduce(&[kick.clone(), done], &role_of, 2_000).to_remove.is_empty());
        // Someone who joins again later and is kicked again is a new kick
        let again = act(2, 3_000, on("kick", 4));
        let both = [kick, act(1, 1_200, on("kicked", 4)), again];
        assert_eq!(reduce(&both, &role_of, 4_000).to_remove.len(), 1);
    }

    #[test]
    fn under_the_two_person_rule_a_kick_needs_a_second_person_who_is_not_the_one_who_asked() {
        let policy = act(1, 500, Action { action: "policy".into(), require_two: true, ..Default::default() });
        let kick = act(2, 1_000, on("kick", 4));
        let st = reduce(&[policy.clone(), kick.clone()], &role_of, 2_000);
        assert!(st.require_two && st.to_remove.is_empty());
        assert_eq!(st.awaiting.len(), 1);
        // The same Admin approving their own request does nothing
        let own = act(2, 1_100, Action { of: kick.id.clone(), ..on("approve", 4) });
        assert_eq!(reduce(&[policy.clone(), kick.clone(), own], &role_of, 2_000).to_remove.len(), 0);
        // Another Admin does it
        let other = act(3, 1_200, Action { of: kick.id.clone(), ..on("approve", 4) });
        let done = reduce(&[policy.clone(), kick.clone(), other.clone()], &role_of, 2_000);
        assert_eq!((done.to_remove.len(), done.awaiting.len()), (1, 0));
        // And the Owner may turn the rule off: then the same kick needs no one
        let off = act(1, 600, Action { action: "policy".into(), require_two: false, ..Default::default() });
        assert_eq!(reduce(&[policy.clone(), off.clone(), kick.clone()], &role_of, 2_000).to_remove.len(), 1, "the newest policy decides");
        // A ban asked for by the Owner needs an Admin to approve
        let ban = act(1, 1_000, on("ban", 5));
        let st = reduce(&[policy, ban.clone()], &role_of, 2_000);
        assert!(!st.is_banned(&id(5)) && st.awaiting.len() == 1);
        let approve = act(2, 1_100, Action { of: ban.id.clone(), ..on("approve", 5) });
        assert!(reduce(&[act(1, 500, Action { action: "policy".into(), require_two: true, ..Default::default() }), ban, approve], &role_of, 2_000).is_banned(&id(5)));
    }

    #[test]
    fn entries_from_a_stranger_or_a_non_moderator_change_nothing() {
        let strangers_ban = Entry::signed_with(&key(9), KIND, "moderation", "", &serde_json::to_string(&on("ban", 4)).unwrap(), 1_000);
        let st = reduce(&[strangers_ban, act(4, 1_000, on("kick", 5)), act(6, 1_000, timeout(5, 9_000))], &role_of, 2_000);
        assert_eq!(st, State::default());
    }
}
