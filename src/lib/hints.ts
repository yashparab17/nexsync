// Whether the first-visit hints on the Welcome page have been dealt with; when storage is blocked they count as seen, so they never nag
import { readFlag, saveFlag } from "@/lib/storage";

const SEEN_KEY = "nexsync.tourSeen";

export const hintsSeen = (): boolean => readFlag(SEEN_KEY, true);

export const markHintsSeen = () => saveFlag(SEEN_KEY, true);
