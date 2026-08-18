// React
import { useEffect, useRef, useState, type ReactNode } from "react";

// React Router
import { router } from "@/routes/router";

// Tauri
import { getLastWorkspace } from "@/lib/tauri";

// Context
import { useWorkspace } from "@/store/workspace/WorkspaceContext";

// Hooks
import { useErrorLog } from "@/hooks/useErrorLog";

/**
 * On app startup, checks whether a workspace was previously open.
 * If one is found (and its directory still exists on disk), it is loaded
 * into the WorkspaceContext and the user is sent straight to `/workspace`.
 * Otherwise the app falls through to the Welcome page.
 *
 * This component sits *outside* RouterProvider in the tree, so it uses
 * the module-level `router` instance for navigation rather than
 * `useNavigate()`.
 *
 * The `hasRestored` ref ensures the initial check runs only once on mount.
 * Without it, clearing the workspace (which sets `workspace` to `null`)
 * would re-trigger the effect and reload the workspace in an infinite loop.
 */
export default function WorkspaceLoader({ children }: { children: ReactNode }) {
	const { loadWorkspace, workspace } = useWorkspace();
	const logError = useErrorLog();
	const [ready, setReady] = useState(false);
	const hasRestored = useRef(false);

	useEffect(() => {
		// Only run the initial workspace check once.
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
				// If Tauri isn't available (e.g. running in a plain browser)
				// or the registry doesn't exist, just fall through to the
				// Welcome page.
				console.error("Failed to restore last workspace:", err);
				logError(err, { source: "startup" });
			} finally {
				setReady(true);
			}
		};

		checkLastWorkspace();
	}, [loadWorkspace, workspace, logError]);

	if (!ready) {
		return (
			<div className="flex h-screen items-center justify-center">
				<p className="text-muted-foreground">Starting up…</p>
			</div>
		);
	}

	return <>{children}</>;
}
