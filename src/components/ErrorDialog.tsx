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

// Global error popup dialog rendered at app root
export default function ErrorDialog() {
	const { error, clearError, workspace, failedWorkspace } = useWorkspace();
	const logError = useErrorLog();
	const navigate = useNavigate();

	const isWorkspaceError = !!failedWorkspace;

	// Log non-workspace runtime errors when dialog opens
	useEffect(() => {
		if (error && !isWorkspaceError) {
			logError(error, { source: "dialog" });
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [error]);

	// Clear error and redirect to Welcome if no workspace loaded
	const handleDismiss = () => {
		clearError();
		if (!workspace) {
			navigate("/");
		}
	};

	// Determine contextual dialog title and description
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
