// React
import { useEffect } from "react";

// React Router
import { useNavigate } from "react-router-dom";

// Components
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";

// Context
import { useWorkspace } from "@/store/workspace/WorkspaceContext";

// Hooks
import { useErrorLog } from "@/hooks/useErrorLog";

/**
 * Global error popup. Rendered once at the app root so it can surface errors
 * from anywhere (Welcome, startup restore, or inside a workspace).
 *
 * The message is deliberately friendly: if a workspace failed to load, we tell
 * the user the folder may have moved or been deleted, and that it will be
 * removed from Recent automatically (the backend prunes invalid entries).
 */
export default function ErrorDialog() {
	const { error, clearError, workspace, failedWorkspace } = useWorkspace();
	const logError = useErrorLog();
	const navigate = useNavigate();

	const isWorkspaceError = !!failedWorkspace;

	// Record the dialog display as the canonical log entry. Individual error
	// raises (load/save/startup) already log at their source, so non-workspace
	// errors (which aren't logged elsewhere) are captured here. Using an effect
	// avoids re-logging on every re-render while the dialog is open.
	useEffect(() => {
		if (error && !isWorkspaceError) {
			logError(error, { source: "dialog" });
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [error]);

	const handleDismiss = () => {
		clearError();
		// If a workspace load failed, there's nothing valid to show — go home.
		if (!workspace) {
			navigate("/");
		}
	};

	// If the error relates to a failed workspace load, show a contextual
	// message that references the workspace by name.
	const title =
		isWorkspaceError ?
			`We couldn't open "${failedWorkspace.name}"`
		:	"Something went wrong";
	const message =
		isWorkspaceError ?
			"The workspace folder may have been moved, deleted, or is no longer accessible. It will be removed from your recent workspaces automatically."
		:	error;

	return (
		<Dialog
			isOpen={!!error}
			onOpenChange={(open) => {
				if (!open) handleDismiss();
			}}
		>
			<DialogHeader>
				<DialogTitle>{title}</DialogTitle>
				<DialogDescription>{message}</DialogDescription>
			</DialogHeader>

			<DialogFooter>
				<Button variant="outline" onPress={handleDismiss}>
					Dismiss
				</Button>
			</DialogFooter>
		</Dialog>
	);
}
