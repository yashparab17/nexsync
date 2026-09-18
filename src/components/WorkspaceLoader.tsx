// React
import { useEffect, useRef, useState, type ReactNode } from "react";

// React Router
import { router } from "@/routes/router";

// Tauri IPC
import { getLastWorkspace } from "@/lib/tauri";

// Context
import { useWorkspace } from "@/store/workspace/WorkspaceContext";

// Hooks
import { useErrorLog } from "@/hooks/useErrorLog";

// Startup component that checks and restores the last opened workspace session
export default function WorkspaceLoader({ children }: { children: ReactNode }) {
	const { loadWorkspace, workspace } = useWorkspace();
	const logError = useErrorLog();
	const [ready, setReady] = useState(false);
	const hasRestored = useRef(false);

	// Attempt to restore last opened workspace on initial mount
	useEffect(() => {
		if (hasRestored.current) return;
		hasRestored.current = true;

		const checkLastWorkspace = async () => {
			try {
				const last = await getLastWorkspace();

				if (last && !workspace) {
					await loadWorkspace(last);
					router.navigate("/workspace", { replace: true });
				}
			} catch (err) {
				console.error("Failed to restore last workspace:", err);
				logError(err, { source: "startup" });
			} finally {
				setReady(true);
			}
		};

		checkLastWorkspace();
	}, [loadWorkspace, workspace, logError]);

	// Show loading placeholder while checking startup workspace
	if (!ready) {
		return (
			<div className="flex h-screen items-center justify-center">
				<p className="text-muted-foreground">Starting up…</p>
			</div>
		);
	}

	return <>{children}</>;
}
