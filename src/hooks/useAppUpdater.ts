import { useCallback, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export type UpdateStatus =
	| "idle"
	| "checking"
	| "up-to-date"
	| "available"
	| "installing"
	| "error";

// Checks GitHub Releases for a newer signed build and installs it on demand
export function useAppUpdater() {
	const [status, setStatus] = useState<UpdateStatus>("idle");
	const [update, setUpdate] = useState<Update | null>(null);
	const [error, setError] = useState<string | null>(null);

	const checkForUpdate = useCallback(async () => {
		setStatus("checking");
		setError(null);
		try {
			const found = await check();
			setUpdate(found);
			setStatus(found ? "available" : "up-to-date");
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
			setStatus("error");
		}
	}, []);

	const installUpdate = useCallback(async () => {
		if (!update) return;
		setStatus("installing");
		setError(null);
		try {
			await update.downloadAndInstall();
			await relaunch();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
			setStatus("error");
		}
	}, [update]);

	return {
		status,
		version: update?.version ?? null,
		error,
		checkForUpdate,
		installUpdate,
	};
}
