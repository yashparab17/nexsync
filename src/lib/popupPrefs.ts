// Whether the brief pop-ups (collaborator joined, task assigned...) are shown on this device. Muted, the same notices still land in the
// notification list; only the pop-up is skipped.

import { readFlag, saveStored } from "@/lib/storage";

const KEY = "nexsync.popups.muted";

export const readPopupsMuted = (): boolean => readFlag(KEY);

export const savePopupsMuted = (muted: boolean): void => saveStored(KEY, muted ? "1" : null);
