// Looks for a newer signed build once, a few seconds after the app starts, and offers it in a small card: update and restart, later, or skip that
// version. The same check as Settings > Updates & About, on the channel chosen there; a failed check (no network, no release yet) says nothing.

import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { useAppUpdater } from "@/hooks/useAppUpdater";

// Long enough for the workspace to open before a network call is made
export const CHECK_DELAY_MS = 8000;
export const SKIPPED_KEY = "nexsync.skippedUpdate";

const readSkipped = () => {
	try {
		return localStorage.getItem(SKIPPED_KEY);
	} catch {
		return null;
	}
};

// Only the desktop app has an updater; a browser (the lab, the tests) has nothing to ask
const inDesktopApp = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export default function UpdatePrompt() {
	const updater = useAppUpdater();
	const [later, setLater] = useState(false);
	const [skipped, setSkipped] = useState(readSkipped);
	const check = useRef(updater.checkForUpdate);
	check.current = updater.checkForUpdate;

	useEffect(() => {
		if (!inDesktopApp()) return;
		const timer = setTimeout(() => void check.current(), CHECK_DELAY_MS);
		return () => clearTimeout(timer);
	}, []);

	const found = updater.status === "available" || updater.status === "installing";
	if (!found || later || !updater.version || updater.version === skipped) return null;
	const installing = updater.status === "installing";

	return (
		<section role="status" aria-label="Update available" className="fixed bottom-4 right-4 z-50 w-80 space-y-2 border bg-background p-4 text-sm shadow-lg ring-1 ring-foreground/10">
			<p className="font-semibold">Nexsync {updater.version} is ready</p>
			{updater.notes?.trim() && <p className="max-h-24 overflow-y-auto whitespace-pre-wrap text-[13px] text-muted-foreground">{updater.notes.trim()}</p>}
			{updater.status === "error" && updater.error && <p className="text-[13px] text-destructive">{updater.error}</p>}
			<div className="flex flex-wrap gap-2">
				<Button size="sm" onPress={updater.installUpdate} isDisabled={installing}>
					{installing ? "Installing…" : "Update & restart"}
				</Button>
				<Button size="sm" variant="outline" onPress={() => setLater(true)} isDisabled={installing}>
					Later
				</Button>
				<Button
					size="sm"
					variant="ghost"
					isDisabled={installing}
					onPress={() => {
						try {
							localStorage.setItem(SKIPPED_KEY, updater.version ?? "");
						} catch {
							// Not remembered this time
						}
						setSkipped(updater.version);
					}}
				>
					Skip this version
				</Button>
			</div>
		</section>
	);
}
