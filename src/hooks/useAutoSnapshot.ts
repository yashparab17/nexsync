import { useEffect, useRef } from "react";

import { recordFileVersion } from "@/lib/tauri";

const EVERY_MS = 2 * 60 * 1000;

// Keeps what an editor holds as a version every couple of minutes while it changes, and once more when the
// editor closes, so history covers work that was never saved with the Save button. The backend skips text
// that equals the newest version, so calling it for an unchanged file costs nothing.
export function useAutoSnapshot(workspacePath: string | undefined, path: string | undefined, text: string, enabled: boolean) {
	const latest = useRef(text);
	latest.current = text;
	const lastSent = useRef<string | null>(null);

	useEffect(() => {
		if (!enabled || !workspacePath || !path) return;
		lastSent.current = null;
		const send = () => {
			const current = latest.current;
			if (current.trim() === "" || current === lastSent.current) return;
			lastSent.current = current;
			recordFileVersion(workspacePath, path, current).catch(() => {});
		};
		const timer = setInterval(send, EVERY_MS);
		return () => {
			clearInterval(timer);
			send();
		};
	}, [workspacePath, path, enabled]);
}
