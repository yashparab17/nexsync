import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, Check, Save, Trash2 } from "lucide-react";

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

import { useErrorLog } from "@/hooks/useErrorLog";
import { removeRecentWorkspace, writeWorkspaceMetadata } from "@/lib/tauri";
import { useWorkspace } from "@/store/workspace/WorkspaceContext";

export default function WorkspaceSettings() {
	const { workspace, metadata, refreshMetadata, clearWorkspace } =
		useWorkspace();
	const logError = useErrorLog();
	const navigate = useNavigate();

	const [name, setName] = useState(workspace?.name || "");
	const [description, setDescription] = useState(
		workspace?.description || "",
	);
	const [autosave, setAutosave] = useState(
		metadata?.settings.autosave ?? true,
	);
	const [sync, setSync] = useState(metadata?.settings.sync ?? true);
	const [theme, setTheme] = useState(metadata?.settings.theme ?? "dark");

	const [saving, setSaving] = useState(false);
	const [savedSuccess, setSavedSuccess] = useState(false);
	const [isRemoveConfirmOpen, setIsRemoveConfirmOpen] = useState(false);

	const handleSaveSettings = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!workspace?.path || !metadata) return;

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
		try {
			await removeRecentWorkspace(workspace.id);
			await clearWorkspace();
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
					Configure preferences, identity, and synchronization for this
					workspace.
				</p>
			</div>

			<form onSubmit={handleSaveSettings} className="space-y-6">
				{/* General Settings */}
				<Card>
					<CardHeader>
						<CardTitle className="text-base">Workspace Identity</CardTitle>
						<CardDescription>
							Basic identity details stored in your local workspace SQLite
							database.
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
								Physical files live directly in this OS folder.
							</p>
						</div>
					</CardContent>
				</Card>

				{/* Synchronization & Behavior */}
				<Card>
					<CardHeader>
						<CardTitle className="text-base">
							Synchronization & Preferences
						</CardTitle>
						<CardDescription>
							Control local-first caching, autosave, and P2P behavior.
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-5">
						<div className="flex items-center justify-between">
							<div className="space-y-0.5">
								<Label className="text-sm font-semibold">
									Autosave Files
								</Label>
								<p className="text-xs text-muted-foreground">
									Automatically persist file modifications to the OS filesystem.
								</p>
							</div>
							<input
								type="checkbox"
								checked={autosave}
								onChange={(e) => setAutosave(e.target.checked)}
								className="size-4 rounded accent-primary cursor-pointer"
							/>
						</div>

						<div className="flex items-center justify-between">
							<div className="space-y-0.5">
								<Label className="text-sm font-semibold">
									Real-time P2P Synchronization
								</Label>
								<p className="text-xs text-muted-foreground">
									Allow WebRTC DataChannels and Yjs CRDT peer exchange.
								</p>
							</div>
							<input
								type="checkbox"
								checked={sync}
								onChange={(e) => setSync(e.target.checked)}
								className="size-4 rounded accent-primary cursor-pointer"
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
					<Button type="submit" isDisabled={saving} className="gap-2">
						<Save className="size-4" />
						{saving ? "Saving…" : "Save Settings"}
					</Button>
					{savedSuccess && (
						<span className="flex items-center gap-1.5 text-xs text-emerald-400">
							<Check className="size-4" />
							Settings saved successfully
						</span>
					)}
				</div>
			</form>

			{/* Danger Zone */}
			<Card className="border-destructive/30 bg-destructive/5">
				<CardHeader>
					<CardTitle className="text-base text-destructive flex items-center gap-2">
						<AlertTriangle className="size-4" />
						Danger Zone
					</CardTitle>
					<CardDescription>
						Remove this workspace from your app registry.
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
								from your recent workspaces? Your physical files and database on
								disk will remain intact.
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
		</div>
	);
}
