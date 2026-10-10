import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, Download, FolderOpen, Loader2, Moon, Save, SlidersHorizontal, Radio, ShieldCheck, Sun, Trash2, Undo2, User, X } from "lucide-react";

import { Button } from "@/components/ui/button";
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
import Avatar from "@/components/elements/Avatar";
import { Row, SectionCard, SectionNav, Segmented } from "@/components/elements/SettingsParts";
import RulesCard from "@/components/elements/RulesCard";
import HostRequiredCard from "@/components/elements/HostRequiredCard";

import { useErrorLog } from "@/hooks/useErrorLog";
import { useLeaveWorkspace } from "@/hooks/useLeaveWorkspace";
import { exportFolders } from "@/lib/export";
import { errorText } from "@/lib/utils";
import { removeRecentWorkspace, writeWorkspaceMetadata } from "@/lib/tauri";
import { useWorkspace } from "@/store/workspace/WorkspaceContext";
import { useP2P } from "@/store/p2p/P2PContext";

const SECTIONS = [
	{ id: "you", label: "You", icon: <User className="size-4 shrink-0" /> },
	{ id: "workspace", label: "Workspace", icon: <FolderOpen className="size-4 shrink-0" /> },
	{ id: "preferences", label: "Preferences", icon: <SlidersHorizontal className="size-4 shrink-0" /> },
	{ id: "rules", label: "Rules", icon: <ShieldCheck className="size-4 shrink-0" /> },
	{ id: "collaboration", label: "Collaboration", icon: <Radio className="size-4 shrink-0" /> },
	{ id: "export", label: "Export", icon: <Download className="size-4 shrink-0" /> },
	{ id: "danger", label: "Danger zone", icon: <AlertTriangle className="size-4 shrink-0" /> },
];

export default function WorkspaceSettings({ onClose }: { onClose?: () => void } = {}) {
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
	const [leaving, setLeaving] = useState(false);
	const [busy, setBusy] = useState(false);
	const [actionError, setActionError] = useState<string | null>(null);
	const guestCount = peers.filter((p) => !p.isHost).length;

	// Who this is: the name the host knows this device by, or the owner when this is the host's own copy
	const myName = selfName ?? metadata?.members.members.find((m) => m.role === "Owner")?.name ?? "You";
	const myRole = metadata?.members.members.find((m) => m.name === myName)?.role;

	const dirty =
		!isJoinedCopy &&
		(name !== (workspace?.name || "") ||
			description !== (workspace?.description || "") ||
			autosave !== (metadata?.settings.autosave ?? true) ||
			sync !== (metadata?.settings.sync ?? true) ||
			theme !== (metadata?.settings.theme ?? "dark"));
	const discard = () => {
		setName(workspace?.name || "");
		setDescription(workspace?.description || "");
		setAutosave(metadata?.settings.autosave ?? true);
		setSync(metadata?.settings.sync ?? true);
		setTheme(metadata?.settings.theme ?? "dark");
	};

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

	const handleSaveSettings = async () => {
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
		<div className={onClose ? "flex h-[85vh] gap-8 overflow-y-auto p-6" : "mx-auto flex max-w-5xl gap-8"}>
			{/* Section list */}
			<aside className="hidden w-44 shrink-0 md:block">
				<SectionNav label="Workspace settings sections" sections={SECTIONS} />
			</aside>

			<div className="min-w-0 flex-1 space-y-6">
				{/* Header */}
				<div className="flex items-start justify-between gap-3">
					<div>
					<h1 className="text-3xl font-bold tracking-tight">Settings</h1>
					<p className="text-sm text-muted-foreground">Preferences, identity and sharing for {workspace?.name ?? "this workspace"}.</p>
					</div>
					{onClose && (
						<Button variant="ghost" size="icon" aria-label="Close" onPress={() => (dirty ? setLeaving(true) : onClose())}>
							<X className="size-5" />
						</Button>
					)}
				</div>

				{isJoinedCopy && (
					<p className="border p-3 text-xs text-muted-foreground">You joined this workspace, so its host manages these settings.</p>
				)}

				<SectionCard id="you" title="You" description="How collaborators see you in this workspace." icon={<User className="size-4 text-primary" />}>
					<div className="flex items-center gap-4">
						<Avatar name={myName} className="size-12 text-lg" />
						<div className="min-w-0 flex-1">
							<p className="truncate text-base font-semibold">{myName}</p>
							<p className="text-xs text-muted-foreground">
								{myRole ? `${myRole}. ` : ""}Your name and picture are the same everywhere in the app. Change your name in Members.
							</p>
						</div>
					</div>
				</SectionCard>

				<SectionCard id="workspace" title="Workspace" description="Basic details about this workspace, saved on your computer." icon={<FolderOpen className="size-4 text-primary" />}>
					<div>
						<Label htmlFor="ws-name">Workspace name</Label>
						<Input id="ws-name" required value={name} disabled={isJoinedCopy} onChange={(e) => setName(e.target.value)} className="mt-1" />
					</div>
					<div>
						<Label htmlFor="ws-desc">Description</Label>
						<Textarea id="ws-desc" value={description} disabled={isJoinedCopy} onChange={(e) => setDescription(e.target.value)} placeholder="Optional description..." rows={3} className="mt-1" />
					</div>
					<div>
						<Label>Local path</Label>
						<Input readOnly value={workspace?.path || ""} className="mt-1 bg-muted/40 font-mono text-xs text-muted-foreground" />
						<p className="mt-1 text-xs text-muted-foreground">Your files are saved in this folder on your computer.</p>
					</div>
				</SectionCard>

				<SectionCard id="preferences" title="Preferences" description="Autosave, live sharing and the color scheme of this workspace." icon={<SlidersHorizontal className="size-4 text-primary" />}>
					<Row title="Autosave files" hint="Save your changes to files automatically.">
						<input type="checkbox" aria-label="Autosave files" checked={autosave} disabled={isJoinedCopy} onChange={(e) => setAutosave(e.target.checked)} className="size-4 cursor-pointer rounded-none accent-primary" />
					</Row>
					<Row title="Share changes live" hint="Let collaborators connect and see each other's changes as they happen.">
						<input type="checkbox" aria-label="Share changes live" checked={sync} disabled={isJoinedCopy} onChange={(e) => setSync(e.target.checked)} className="size-4 cursor-pointer rounded-none accent-primary" />
					</Row>
					<Row title="Workspace theme" hint="Color scheme preference for this workspace.">
						<Segmented
							label="Workspace theme"
							value={theme}
							onChange={(value) => !isJoinedCopy && setTheme(value)}
							options={[
								{ value: "dark", label: "Dark", icon: <Moon className="size-3.5" /> },
								{ value: "light", label: "Light", icon: <Sun className="size-3.5" /> },
							]}
						/>
					</Row>
				</SectionCard>

				{workspace && (
					<div id="rules" className="scroll-mt-8">
						<RulesCard workspacePath={workspace.path} />
					</div>
				)}

				<div id="collaboration" className="scroll-mt-8">
					<HostRequiredCard />
				</div>

				<SectionCard
					id="export"
					title="Export"
					description="Save a copy of the workspace files as one zip: notes, files, assets and code, in their folders. Tasks and the Kanban board are not part of the zip."
					icon={<Download className="size-4 text-primary" />}
				>
					<div className="flex flex-wrap items-center gap-3">
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
							<span role={exportResult.ok ? "status" : "alert"} className={`text-xs ${exportResult.ok ? "text-success" : "text-destructive"}`}>
								{exportResult.text}
							</span>
						)}
					</div>
				</SectionCard>

				<SectionCard
					id="danger"
					title="Danger zone"
					description="Leave, remove or delete this workspace."
					icon={<AlertTriangle className="size-4" />}
					className="border-destructive/30"
					titleClassName="text-destructive"
				>
					<Row title="Remove from recent workspaces" hint="Takes the workspace off your quick access list. Your files on disk are not deleted.">
						<Button variant="destructive" size="sm" onPress={() => setIsRemoveConfirmOpen(true)}>
							<Trash2 className="size-3.5" />
							Remove
						</Button>
					</Row>
					<div className="border-t pt-4">
						{isJoinedCopy ? (
							<Row title="Leave workspace" hint="Disconnect from the host and remove this workspace from the app. You can keep your copy of the files or move it to the recycle bin.">
								<Button variant="destructive" size="sm" onPress={() => setIsLeaveOpen(true)}>
									<Trash2 className="size-3.5" />
									Leave
								</Button>
							</Row>
						) : (
							<Row title="Delete workspace" hint="Move this workspace to the recycle bin. Collaborators keep their own copies.">
								<Button variant="destructive" size="sm" onPress={() => setIsDeleteOpen(true)}>
									<Trash2 className="size-3.5" />
									Delete
								</Button>
							</Row>
						)}
					</div>
				</SectionCard>

				{/* Appears while there is something to save */}
				{(dirty || saving || savedSuccess) && !isJoinedCopy && (
					<div role="region" aria-label="Unsaved changes" className="sticky bottom-0 -mx-1 border-t bg-background/95 backdrop-blur">
						<div className="flex flex-wrap items-center gap-3 px-1 py-3">
							<p role="status" className={`min-w-0 flex-1 text-xs ${savedSuccess && !dirty ? "text-success" : "text-muted-foreground"}`}>
								{saving ? "Saving…" : savedSuccess && !dirty ? "Settings saved" : "You have unsaved changes."}
							</p>
							<Button variant="outline" size="sm" isDisabled={saving || !dirty} onPress={discard}>
								<Undo2 className="size-4" />
								Discard
							</Button>
							<Button size="sm" isDisabled={saving || !dirty || !name.trim()} onPress={() => void handleSaveSettings()}>
								{saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
								{saving ? "Saving…" : "Save changes"}
							</Button>
						</div>
					</div>
				)}
			{leaving && (
				<Dialog isOpen onOpenChange={(open) => !open && setLeaving(false)}>
					<div className="space-y-4">
						<DialogHeader>
							<DialogTitle>Leave without saving?</DialogTitle>
							<DialogDescription>Your changes to these settings will be lost.</DialogDescription>
						</DialogHeader>
						<DialogFooter>
							<Button variant="outline" onPress={() => setLeaving(false)}>Keep editing</Button>
							<Button variant="destructive" onPress={() => onClose?.()}>Discard and leave</Button>
						</DialogFooter>
					</div>
				</Dialog>
			)}

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
		</div>
	);
}
