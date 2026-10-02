import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";

export type UpdateStatus =
	| "idle"
	| "checking"
	| "up-to-date"
	| "available"
	| "installing"
	| "error";

// Stable follows the newest release; beta follows the pre-release the maintainers point it at
export type UpdateChannel = "stable" | "beta";

const CHANNEL_KEY = "nexsync.updateChannel";

export function readChannel(): UpdateChannel {
	try {
		return localStorage.getItem(CHANNEL_KEY) === "beta" ? "beta" : "stable";
	} catch {
		return "stable";
	}
}

interface UpdateInfo {
	version: string;
	notes: string | null;
	date: string | null;
}

// Checks GitHub Releases for a newer signed build on the chosen channel and installs it on demand
export function useAppUpdater() {
	const [status, setStatus] = useState<UpdateStatus>("idle");
	const [info, setInfo] = useState<UpdateInfo | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [channel, setChannelState] = useState<UpdateChannel>(readChannel);

	const setChannel = useCallback((next: UpdateChannel) => {
		try {
			localStorage.setItem(CHANNEL_KEY, next);
		} catch {
			// Not remembered this time
		}
		setChannelState(next);
		// What was found on the other channel no longer applies
		setInfo(null);
		setError(null);
		setStatus("idle");
	}, []);

	const checkForUpdate = useCallback(async () => {
		setStatus("checking");
		setError(null);
		try {
			const found = await invoke<UpdateInfo | null>("check_for_update", { channel });
			setInfo(found);
			setStatus(found ? "available" : "up-to-date");
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
			setStatus("error");
		}
	}, [channel]);

	const installUpdate = useCallback(async () => {
		if (!info) return;
		setStatus("installing");
		setError(null);
		try {
			await invoke("install_update", { channel });
			await relaunch();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
			setStatus("error");
		}
	}, [info, channel]);

	return {
		status,
		version: info?.version ?? null,
		notes: info?.notes ?? null,
		date: info?.date ?? null,
		channel,
		setChannel,
		error,
		checkForUpdate,
		installUpdate,
	};
}
