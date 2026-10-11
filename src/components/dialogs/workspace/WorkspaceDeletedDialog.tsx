import { useState } from "react";
import { Trash2 } from "@/components/animate-icons";

import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { useLeaveWorkspace } from "@/hooks/useLeaveWorkspace";
import { errorText } from "@/lib/utils";
import { useP2P } from "@/store/p2p/P2PContext";

// Tells a guest the host deleted the workspace and lets them keep or remove their own copy
export default function WorkspaceDeletedDialog() {
	const { workspaceDeleted, dismissWorkspaceDeleted } = useP2P();
	const leave = useLeaveWorkspace();
	const [error, setError] = useState<string | null>(null);
	if (!workspaceDeleted) return null;

	const run = async (deleteFiles: boolean) => {
		try {
			setError(null);
			await leave({ deleteFiles });
			dismissWorkspaceDeleted();
		} catch (err) {
			setError(errorText(err, "Something went wrong."));
		}
	};

	return (
		<Dialog isOpen isDismissable={false} showCloseButton={false} onOpenChange={() => {}}>
			<div className="space-y-4">
				<DialogHeader>
					<div className="flex items-center gap-2">
						<Trash2 className="size-5 text-destructive" />
						<DialogTitle>Workspace Deleted</DialogTitle>
					</div>
					<DialogDescription>
						The host deleted this workspace. Your copy is still on this device and nothing was removed.
					</DialogDescription>
				</DialogHeader>
				{error && <p className="text-xs text-destructive">{error}</p>}
				<DialogFooter>
					<Button variant="outline" onPress={dismissWorkspaceDeleted}>
						Keep My Copy
					</Button>
					<Button variant="outline" onPress={() => run(false)}>
						Remove From App
					</Button>
					<Button variant="destructive" onPress={() => run(true)}>
						Move Copy to Recycle Bin
					</Button>
				</DialogFooter>
			</div>
		</Dialog>
	);
}
