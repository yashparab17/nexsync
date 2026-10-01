import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, Check, Download, Loader2, Save, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Dialog,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import RulesCard from "@/components/elements/RulesCard";

import { useErrorLog } from "@/hooks/useErrorLog";
import { useLeaveWorkspace } from "@/hooks/useLeaveWorkspace";
import { exportFolders } from "@/lib/export";
import { errorText } from "@/lib/utils";
import { removeRecentWorkspace, writeWorkspaceMetadata } from "@/lib/tauri";
import { useWorkspace } from "@/store/workspace/WorkspaceContext";
import { useP2P } from "@/store/p2p/P2PContext";

export default function WorkspaceSettings() {
	const {
		workspace,
		metadata,
		refreshMetadata,
		clearWorkspace,
		addActivityEvent,
	} = useWorkspace();
	const logError = useErrorLog();
	const navigate = useNavigate();
	const { selfName, peers, announceWorkspaceDeleted } = useP2P();
	const leaveWorkspace = useLeaveWorkspace();
	// Only the workspace owner may change settings; a joined copy's local edits would just
	// get overwritten by the next full snapshot pull anyway, same rule as the Members page.
	const isJoinedCopy = selfName !== null;

	const [name, setName] = useState(workspace?.name || "");
	const [description, setDescription] = useState(
		workspace?.description || "",
	);
	const [autosave, setAutosave] = useState(
		metadata?.settings.autosave ?? true,
	);
	const [sync, setSync] = useState(metadata?.settings.sync ?? true);
	const [theme, setTheme] = useState(metadata?.settings.theme ?? "dark");

	const [exporting, setExporting] = useState(false);
	const [exportResult, setExportResult] = useState<{ ok: boolean; text: string } | null>(null);
	const [saving, setSaving] = useState(false);
	const [savedSuccess, setSavedSuccess] = useState(false);
	const [isRemoveConfirmOpen, setIsRemoveConfirmOpen] = useState(false);
	const [isLeaveOpen, setIsLeaveOpen] = useState(false);
	const [isDeleteOpen, setIsDeleteOpen] = useState(false);
	const [confirmName, setConfirmName] = useState("");
	const [busy, setBusy] = useState(false);
	const [actionError, setActionError] = useState<string | null>(null);
	const guestCount = peers.filter((p) => !p.isHost).length;

	// Leaves (guest) or deletes (owner) the workspace; the page unmounts once it succeeds
	const runAction = async (deleteFiles: boolean, announce = false) => {
		try {
			setBusy(true);
			setActionError(null);
			if (announce && guestCount > 0) await announceWorkspaceDeleted();
			await leaveWorkspace({ deleteFiles });
		} catch (err) {
			setActionError(errorText(err, "Something went wrong."));
			setBusy(false);
		}
	};

	const handleSaveSettings = async (e: React.FormEvent) => {
		e.preventDefault();
		if (isJoinedCopy || !workspace?.path || !metadata) return;

		try {
			setSaving(true);
			const updatedMetadata = {
				...metadata,
				workspace: {
					...metadata.workspace,
					name: name.trim() || metadata.workspace.name,
					description: description.trim(),
					updated_at: new Date().toISOString(),
				},
				settings: {
					...metadata.settings,
					autosave,
					sync,
					theme,
				},
			};

			await writeWorkspaceMetadata({
				path: workspace.path,
				metadata: updatedMetadata,
			});
			await addActivityEvent(
				"Updated settings",
				"Saved workspace configuration",
				undefined,
				"settings",
			);
			setSavedSuccess(true);
			setTimeout(() => setSavedSuccess(false), 2500);
			await refreshMetadata();
		} catch (err) {
			console.error("Failed to save workspace settings:", err);
			logError(err, { source: "settings" });
		} finally {
			setSaving(false);
		}
	};

	const handleRemoveWorkspace = async () => {
		if (!workspace?.id) return;
		const workspaceId = workspace.id;
		try {
			// Close first: clearWorkspace saves the workspace, which re-adds it to the recent list
			await clearWorkspace();
			await removeRecentWorkspace(workspaceId);
			navigate("/");
		} catch (err) {
			console.error("Failed to remove workspace:", err);
			logError(err, { source: "settings" });
		}
	};

	return (
		<div className="max-w-4xl space-y-6">
			{/* Header */}
			<div>
				<h1 className="text-2xl font-bold tracking-tight">
					Workspace Settings
				</h1>
				<p className="mt-1 text-sm text-muted-foreground">
					Configure preferences, identity and sharing for this workspace.
				</p>
			</div>

			<form onSubmit={handleSaveSettings} className="space-y-6">
				{/* General Settings */}
				<Card>
					<CardHeader>
						<CardTitle className="text-base">Workspace Identity</CardTitle>
						<CardDescription>
							Basic details about this workspace, saved on your computer.
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						<div>
							<Label htmlFor="ws-name">Workspace Name *</Label>
							<Input
								id="ws-name"
								required
								value={name}
								onChange={(e) => setName(e.target.value)}
								className="mt-1"
							/>
						</div>

						<div>
							<Label htmlFor="ws-desc">Description</Label>
							<Textarea
								id="ws-desc"
								value={description}
								onChange={(e) => setDescription(e.target.value)}
								placeholder="Optional description..."
								rows={3}
								className="mt-1"
							/>
						</div>

						<div>
							<Label>Local Path (OS File System)</Label>
							<div className="mt-1 flex items-center gap-2">
								<Input
									readOnly
									value={workspace?.path || ""}
									className="font-mono text-xs bg-muted/40 text-muted-foreground"
								/>
							</div>
							<p className="mt-1 text-xs text-muted-foreground">
								Your files are saved in this folder on your computer.
							</p>
						</div>
					</CardContent>
				</Card>

				{/* Synchronization & Behavior */}
				<Card>
					<CardHeader>
						<CardTitle className="text-base">
							Sharing & Preferences
						</CardTitle>
						<CardDescription>
							Control autosave and how this workspace is shared.
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-5">
						<div className="flex items-center justify-between">
							<div className="space-y-0.5">
								<Label className="text-sm font-semibold">
									Autosave Files
								</Label>
								<p className="text-xs text-muted-foreground">
									Save your changes to files automatically.
								</p>
							</div>
							<input
								type="checkbox"
								checked={autosave}
								onChange={(e) => setAutosave(e.target.checked)}
								className="size-4 rounded-none accent-primary cursor-pointer"
							/>
						</div>

						<div className="flex items-center justify-between">
							<div className="space-y-0.5">
								<Label className="text-sm font-semibold">
									Share changes live
								</Label>
								<p className="text-xs text-muted-foreground">
									Let collaborators connect and see each other's changes as they happen.
								</p>
							</div>
							<input
								type="checkbox"
								checked={sync}
								onChange={(e) => setSync(e.target.checked)}
								className="size-4 rounded-none accent-primary cursor-pointer"
							/>
						</div>

						<div className="flex items-center justify-between">
							<div className="space-y-0.5">
								<Label className="text-sm font-semibold">
									Workspace Theme
								</Label>
								<p className="text-xs text-muted-foreground">
									Color scheme preference for this workspace.
								</p>
							</div>
							<select
								value={theme}
								onChange={(e) => setTheme(e.target.value)}
								className="flex h-9 rounded-none border border-input bg-background px-3 py-1 text-xs text-foreground ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring"
							>
								<option value="dark">Dark</option>
								<option value="light">Light</option>
							</select>
						</div>
					</CardContent>
				</Card>

				{/* Save Button */}
				<div className="flex items-center gap-3">
					<Button
						type="submit"
						isDisabled={saving || isJoinedCopy}
						className="gap-2"
					>
						<Save className="size-4" />
						{saving ? "Saving…" : "Save Settings"}
					</Button>
					{savedSuccess && (
						<span className="flex items-center gap-1.5 text-xs text-emerald-400">
							<Check className="size-4" />
							Settings saved successfully
						</span>
					)}
					{isJoinedCopy && (
						<span className="text-xs text-muted-foreground">
							You joined this workspace, so its host manages these settings.
						</span>
					)}
				</div>
			</form>

			{workspace && <RulesCard workspacePath={workspace.path} />}

			{/* Export */}
			<Card>
				<CardHeader>
					<CardTitle className="text-base">Export</CardTitle>
					<CardDescription>
						Save a copy of the workspace files as one zip: notes, files, assets and code, in their folders. Tasks and the
						Kanban board are not part of the zip.
					</CardDescription>
				</CardHeader>
				<CardContent className="flex flex-wrap items-center gap-3">
					<Button
						variant="outline"
						isDisabled={exporting || !workspace}
						onPress={async () => {
							if (!workspace) return;
							setExporting(true);
							setExportResult(null);
							try {
								const result = await exportFolders(workspace.path, ["notes", "files", "assets", "editor"], workspace.name);
								if (result) setExportResult({ ok: true, text: `Saved ${result.count} ${result.count === 1 ? "file" : "files"} to ${result.dest}` });
							} catch (err) {
								setExportResult({ ok: false, text: errorText(err, "Could not export the workspace.") });
							} finally {
								setExporting(false);
							}
						}}
					>
						{exporting ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
						Export workspace as zip
					</Button>
					{exportResult && (
						<span role={exportResult.ok ? "status" : "alert"} className={`text-xs ${exportResult.ok ? "text-emerald-400" : "text-destructive"}`}>
							{exportResult.text}
						</span>
					)}
				</CardContent>
			</Card>

			{/* Danger Zone */}
			<Card className="border-destructive/30 bg-destructive/5">
				<CardHeader>
					<CardTitle className="text-base text-destructive flex items-center gap-2">
						<AlertTriangle className="size-4" />
						Danger Zone
					</CardTitle>
					<CardDescription>
						Leave, remove or delete this workspace.
					</CardDescription>
				</CardHeader>
				<CardContent className="flex items-center justify-between">
					<div>
						<p className="text-sm font-medium">Remove from Recent Workspaces</p>
						<p className="text-xs text-muted-foreground">
							This will remove the workspace from your quick access list. Your
							files on disk will not be deleted.
						</p>
					</div>
					<Button
						variant="destructive"
						size="sm"
						onPress={() => setIsRemoveConfirmOpen(true)}
						className="gap-1.5"
					>
						<Trash2 className="size-3.5" />
						Remove Workspace
					</Button>
				</CardContent>
				{isJoinedCopy ? (
					<CardContent className="flex items-center justify-between border-t pt-4">
						<div>
							<p className="text-sm font-medium">Leave Workspace</p>
							<p className="text-xs text-muted-foreground">
								Disconnect from the host and remove this workspace from the app. You can keep your
								copy of the files or move it to the recycle bin.
							</p>
						</div>
						<Button variant="destructive" size="sm" onPress={() => setIsLeaveOpen(true)} className="gap-1.5">
							<Trash2 className="size-3.5" />
							Leave
						</Button>
					</CardContent>
				) : (
					<CardContent className="flex items-center justify-between border-t pt-4">
						<div>
							<p className="text-sm font-medium">Delete Workspace</p>
							<p className="text-xs text-muted-foreground">
								Move this workspace to the recycle bin. Collaborators keep their own copies.
							</p>
						</div>
						<Button variant="destructive" size="sm" onPress={() => setIsDeleteOpen(true)} className="gap-1.5">
							<Trash2 className="size-3.5" />
							Delete Workspace
						</Button>
					</CardContent>
				)}
			</Card>

			{/* Remove Workspace Modal */}
			{isRemoveConfirmOpen && (
				<Dialog
					isOpen={isRemoveConfirmOpen}
					onOpenChange={setIsRemoveConfirmOpen}
				>
					<div className="space-y-4">
						<DialogHeader>
							<DialogTitle>Remove Workspace</DialogTitle>
							<DialogDescription>
								Are you sure you want to remove{" "}
								<span className="font-semibold text-foreground">
									{workspace?.name}
								</span>{" "}
								from your recent workspaces? Your files and data on your disk will remain intact.
							</DialogDescription>
						</DialogHeader>

						<DialogFooter>
							<Button
								variant="outline"
								onPress={() => setIsRemoveConfirmOpen(false)}
							>
								Cancel
							</Button>
							<Button variant="destructive" onPress={handleRemoveWorkspace}>
								Remove
							</Button>
						</DialogFooter>
					</div>
				</Dialog>
			)}

			{/* Leave Workspace (guests) */}
			{isLeaveOpen && (
				<Dialog className="sm:max-w-xl" isOpen={isLeaveOpen} onOpenChange={(o) => !busy && setIsLeaveOpen(o)}>
					<div className="space-y-4">
						<DialogHeader>
							<DialogTitle>Leave Workspace</DialogTitle>
							<DialogDescription>
								You will disconnect from the host and this workspace will disappear from the app.
								Choose what happens to your copy of the files.
							</DialogDescription>
						</DialogHeader>
						{actionError && <p className="text-xs text-destructive">{actionError}</p>}
						<DialogFooter>
							<Button variant="outline" isDisabled={busy} onPress={() => setIsLeaveOpen(false)}>
								Cancel
							</Button>
							<Button variant="outline" isDisabled={busy} onPress={() => runAction(false)}>
								Leave, Keep Files
							</Button>
							<Button variant="destructive" isDisabled={busy} onPress={() => runAction(true)}>
								Leave and Recycle Copy
							</Button>
						</DialogFooter>
					</div>
				</Dialog>
			)}

			{/* Delete Workspace (owner) */}
			{isDeleteOpen && (
				<Dialog isOpen={isDeleteOpen} onOpenChange={(o) => !busy && setIsDeleteOpen(o)}>
					<div className="space-y-4">
						<DialogHeader>
							<DialogTitle>Delete Workspace</DialogTitle>
							<DialogDescription>
								<span className="font-semibold text-foreground">{workspace?.name}</span> will be moved to
								the recycle bin, so you can still restore it from there.
								{guestCount > 0 &&
									` ${guestCount} connected collaborator${guestCount > 1 ? "s" : ""} will be told it was deleted; their copies stay on their devices.`}
								{" "}Other files in the same folder are never touched.
							</DialogDescription>
						</DialogHeader>
						<div className="space-y-1.5">
							<Label htmlFor="confirm-name" className="text-xs">
								Type the workspace name to confirm
							</Label>
							<Input
								id="confirm-name"
								value={confirmName}
								onChange={(e) => setConfirmName(e.target.value)}
								placeholder={workspace?.name}
								autoFocus
							/>
						</div>
						{actionError && <p className="text-xs text-destructive">{actionError}</p>}
						<DialogFooter>
							<Button variant="outline" isDisabled={busy} onPress={() => setIsDeleteOpen(false)}>
								Cancel
							</Button>
							<Button
								variant="destructive"
								isDisabled={busy || confirmName.trim() !== workspace?.name}
								onPress={() => runAction(true, true)}
							>
								{busy ? "Deleting…" : "Delete Workspace"}
							</Button>
						</DialogFooter>
					</div>
				</Dialog>
			)}
		</div>
	);
}
