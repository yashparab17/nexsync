//! Noticing that a device's clock is off, and correcting for it.
//!
//! When two devices change the same field while apart, the write with the later time is the one shown, and the time is
//! the device's own clock (RESEARCH.md §8f). A clock that is minutes out therefore decides contests it should not. No
//! rule that only looks at the times can fix that without making other contests worse, so the clocks are fixed instead:
//! each device keeps what the devices it is linked to say the time is, and moves its own stamps to the middle of them.
//!
//! The estimate is the difference between a peer's clock, as it sent it, and ours when it arrived. That is wrong by the
//! time the message took, which is far below the minute at which a correction starts to matter.

use std::collections::{HashMap, VecDeque};

use iroh::EndpointId;

/// How many recent readings of each peer are kept
const KEPT: usize = 9;

/// A difference smaller than this is left alone: below it, who wins a contest is close to a coin toss anyway
pub const ACT_ABOVE_MS: i64 = 60_000;

#[derive(Default)]
pub struct SkewWatch {
    /// For each peer, recent (their clock minus ours), in milliseconds
    readings: HashMap<EndpointId, VecDeque<i64>>,
}

fn median(mut values: Vec<i64>) -> Option<i64> {
    if values.is_empty() {
        return None;
    }
    values.sort_unstable();
    let mid = values.len() / 2;
    Some(if values.len() % 2 == 1 { values[mid] } else { (values[mid - 1] + values[mid]) / 2 })
}

impl SkewWatch {
    /// A peer said its clock read `theirs` when ours read `ours`
    pub fn observe(&mut self, peer: EndpointId, theirs: u64, ours: u64) {
        let reading = theirs as i64 - ours as i64;
        let list = self.readings.entry(peer).or_default();
        list.push_back(reading);
        if list.len() > KEPT {
            list.pop_front();
        }
    }

    pub fn forget(&mut self, peer: &EndpointId) {
        self.readings.remove(peer);
    }

    /// How far a peer's clock is ahead of ours (negative: behind), when it has said anything
    pub fn offset_of(&self, peer: &EndpointId) -> Option<i64> {
        median(self.readings.get(peer)?.iter().copied().collect())
    }

    /// How much to add to this device's clock so it sits in the middle of the clocks it is linked to: the median of
    /// every peer's offset together with our own, which is zero. With one peer that is half the difference, so both sides
    /// move toward each other; with more, a single wrong clock moves and the others stay. Nothing under a minute.
    pub fn correction(&self, linked: &[EndpointId]) -> i64 {
        let mut offsets: Vec<i64> = linked.iter().filter_map(|p| self.offset_of(p)).collect();
        if offsets.is_empty() {
            return 0;
        }
        offsets.push(0);
        let c = median(offsets).unwrap_or(0);
        if c.abs() >= ACT_ABOVE_MS { c } else { 0 }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn peer(n: u8) -> EndpointId {
        iroh::SecretKey::from_bytes(&[n; 32]).public()
    }

    #[test]
    fn a_peer_that_is_an_hour_slow_is_seen_as_an_hour_behind_despite_message_delay() {
        let mut w = SkewWatch::default();
        let hour = 3_600_000u64;
        for (i, delay) in [40u64, 120, 15, 300, 60].into_iter().enumerate() {
            let ours = 1_000_000_000_000 + i as u64 * 10_000;
            // Their clock reads an hour less, and the message took `delay` ms to arrive
            w.observe(peer(1), ours - delay - hour, ours);
        }
        let off = w.offset_of(&peer(1)).unwrap();
        assert!((off + hour as i64).abs() < 500, "{off}");
    }

    #[test]
    fn with_one_peer_each_side_moves_half_the_way_and_they_meet() {
        let (mut a, mut b) = (SkewWatch::default(), SkewWatch::default());
        let ten_min = 600_000u64;
        // B's clock runs ten minutes slow
        a.observe(peer(2), 5_000_000 - ten_min, 5_000_000);
        b.observe(peer(1), 5_000_000, 5_000_000 - ten_min);
        let (ca, cb) = (a.correction(&[peer(2)]), b.correction(&[peer(1)]));
        assert_eq!((ca, cb), (-(ten_min as i64) / 2, ten_min as i64 / 2));
        // After both apply theirs, the clocks agree: A reads true time plus ca, B reads true time minus ten minutes plus cb
        let true_time = 5_000_000i64;
        assert_eq!(true_time + ca, true_time - ten_min as i64 + cb);
    }

    #[test]
    fn with_three_devices_only_the_one_that_is_wrong_moves() {
        let hour = 3_600_000i64;
        // From the odd device's side: both others are an hour ahead of it
        let mut odd = SkewWatch::default();
        odd.observe(peer(1), (1_000_000_000_000 + hour) as u64, 1_000_000_000_000);
        odd.observe(peer(2), (1_000_000_000_000 + hour) as u64, 1_000_000_000_000);
        assert_eq!(odd.correction(&[peer(1), peer(2)]), hour);
        // From a right device's side: one peer agrees with it and one is an hour behind
        let mut right = SkewWatch::default();
        right.observe(peer(1), 1_000_000_000_000, 1_000_000_000_000);
        right.observe(peer(3), (1_000_000_000_000 - hour) as u64, 1_000_000_000_000);
        assert_eq!(right.correction(&[peer(1), peer(3)]), 0, "a device that agrees with the majority moved");
    }

    #[test]
    fn small_differences_and_silence_change_nothing() {
        let mut w = SkewWatch::default();
        assert_eq!(w.correction(&[peer(1)]), 0);
        w.observe(peer(1), 1_020_000, 1_000_000); // twenty seconds
        assert_eq!(w.correction(&[peer(1)]), 0);
        w.forget(&peer(1));
        assert!(w.offset_of(&peer(1)).is_none());
    }
}
