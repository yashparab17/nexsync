import { useState } from "react";
import { Activity, Trash2, Crown, KeyRound, Pencil, Shield, ShieldCheck, UserCheck, UserPlus } from "@/components/animate-icons";

import PageHeader from "@/components/layout/PageHeader";
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
import Avatar from "@/components/elements/Avatar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";


import { useErrorLog } from "@/hooks/useErrorLog";
import { writeWorkspaceMetadata } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { ASSIGNABLE_ROLES, canChangeRole } from "@/lib/roles";
import { lastSeenText, placeLabel, probeText, skewText } from "@/lib/p2p/presence";
import { probeMember, type ProbeResult } from "@/lib/p2p/transport";
import { cleanName, nameProblem } from "@/lib/memberNames";
import { useWorkspace } from "@/store/workspace/WorkspaceContext";
import { useP2P, useSelfRole } from "@/store/p2p/P2PContext";
import P2PConnectDialog from "@/components/dialogs/workspace/P2PConnectDialog";
import type { Member } from "@/types/workspace";

const ROLE_CONFIG: Record<
	string,
	{ label: string; icon: typeof Shield; color: string; bg: string }
> = {
	Owner: {
		label: "Owner",
		icon: Crown,
		color: "text-warning",
		bg: "bg-warning/10 border-warning/20",
	},
	Admin: {
		label: "Admin",
		icon: ShieldCheck,
		color: "text-info",
		bg: "bg-info/10 border-info/20",
	},
	Editor: {
		label: "Editor",
		icon: Shield,
		color: "text-info",
		bg: "bg-info/10 border-info/20",
	},
	Viewer: {
		label: "Viewer",
		icon: UserCheck,
		color: "text-success",
		bg: "bg-success/10 border-success/20",
	},
};

export default function WorkspaceMembers() {
	const { workspace, metadata, refreshMetadata, addActivityEvent } =
		useWorkspace();
	const logError = useErrorLog();

	const [isInviteOpen, setIsInviteOpen] = useState(false);
	const [isAddMemberOpen, setIsAddMemberOpen] = useState(false);
	const [newMemberName, setNewMemberName] = useState("");
	const [newMemberRole, setNewMemberRole] = useState("Editor");

	const [editingMember, setEditingMember] = useState<Member | null>(null);
	const [editRole, setEditRole] = useState("Editor");
	const [editName, setEditName] = useState("");

	const [deletingMember, setDeletingMember] = useState<Member | null>(null);
	const [submitting, setSubmitting] = useState(false);
	// A guest changing the name they go by in this workspace; the host applies it
	const [renameOpen, setRenameOpen] = useState(false);
	const [renameValue, setRenameValue] = useState("");
	const [renameError, setRenameError] = useState<string | null>(null);
	// What dialing each member by device key found, by member id; "running" while it is being tried
	const [probes, setProbes] = useState<Record<string, ProbeResult | "running">>({});
	const runProbe = async (member: Member) => {
		if (!member.deviceId) return;
		setProbes((p) => ({ ...p, [member.id]: "running" }));
		try {
			const result = await probeMember(member.deviceId);
			setProbes((p) => ({ ...p, [member.id]: result }));
		} catch (err) {
			setProbes((p) => ({ ...p, [member.id]: { reachable: false, connectMs: 0, path: "none", directAfterMs: null, rttMs: 0, error: err instanceof Error ? err.message : String(err) } }));
		}
	};

	const { peers, presence, requestName, selfName, selfId, requestRoleChange, disconnectPeer, blockDevice, transferHost } = useP2P();
	const [hostTarget, setHostTarget] = useState<Member | null>(null);
	const [handoffBusy, setHandoffBusy] = useState(false);
	const [handoffError, setHandoffError] = useState<string | null>(null);

	// Owner only: hands ownership and hosting to a connected member, then this device becomes a guest
	const handleTransferHost = async () => {
		if (!hostTarget?.deviceId) return;
		try {
			setHandoffBusy(true);
			setHandoffError(null);
			await transferHost(hostTarget.deviceId);
			setHostTarget(null);
		} catch (err) {
			setHandoffError(err instanceof Error ? err.message : "Could not transfer hosting.");
		} finally {
			setHandoffBusy(false);
		}
	};
	const selfRole = useSelfRole();
	const members = metadata?.members.members ?? [];
	// In a copy joined from someone else, the host manages the member list
	const isJoinedCopy = selfName !== null;
	const onlineIds = new Set(peers.map((p) => p.id));
	const onlineNames = new Set(peers.map((p) => p.name.toLowerCase()));
	// Roles a member may be moved to by this device: anything for the host, Editor or Viewer for an Admin guest
	const rolesFor = (member: Member) => ASSIGNABLE_ROLES.filter((r) => canChangeRole(selfRole, member.role, r));
	// Where a member is, by device key; on a joined copy the owner has no key in the list, and is the host we are connected to
	const hostPeer = peers.find((p) => p.isHost);
	const presenceOf = (m: Member) => (m.deviceId ? presence[m.deviceId] : isJoinedCopy && m.role === "Owner" && hostPeer ? presence[hostPeer.id] : undefined);


	// Add Member directly
	const handleAddMemberSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!workspace?.path || !metadata || !newMemberName.trim()) return;
		const problem = nameProblem(members, newMemberName);
		if (problem) return logError(new Error(problem), { source: "members" });

		try {
			setSubmitting(true);
			const newMember: Member = {
				id: crypto.randomUUID(),
				name: newMemberName.trim(),
				role: newMemberRole,
			};

			const updatedMembers = [...members, newMember];
			const updatedMetadata = {
				...metadata,
				members: { members: updatedMembers },
			};

			await writeWorkspaceMetadata({
				path: workspace.path,
				metadata: updatedMetadata,
			});
			await addActivityEvent(
				"Added member",
				`Added member ${newMember.name} (${newMember.role})`,
				undefined,
				"member",
			);
			setIsAddMemberOpen(false);
			setNewMemberName("");
			await refreshMetadata();
		} catch (err) {
			console.error("Failed to add member:", err);
			logError(err, { source: "members" });
		} finally {
			setSubmitting(false);
		}
	};

	// Save Role Edit
	const handleEditRoleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		// An Admin guest only asks; the host applies the change and the new list comes back to us
		if (isJoinedCopy) {
			if (editingMember?.deviceId) requestRoleChange(editingMember.deviceId, editRole);
			setEditingMember(null);
			return;
		}
		const name = editName.trim();
		if (!workspace?.path || !metadata || !editingMember || !name) return;
		if (members.some((m) => m.id !== editingMember.id && m.name.toLowerCase() === name.toLowerCase())) {
			logError(new Error(`A member named "${name}" already exists.`), { source: "members" });
			return;
		}

		try {
			setSubmitting(true);
			const isOwner = editingMember.role.toLowerCase() === "owner";
			const updatedMembers = members.map((m) =>
				m.id === editingMember.id ? { ...m, name, role: isOwner ? m.role : editRole } : m,
			);
			const updatedMetadata = {
				...metadata,
				members: { members: updatedMembers },
			};

			await writeWorkspaceMetadata({
				path: workspace.path,
				metadata: updatedMetadata,
			});
			await addActivityEvent(
				"Updated member",
				`Updated ${name} (${editingMember.role.toLowerCase() === "owner" ? "Owner" : editRole})`,
				undefined,
				"member",
			);
			setEditingMember(null);
			await refreshMetadata();
		} catch (err) {
			console.error("Failed to update role:", err);
			logError(err, { source: "members" });
		} finally {
			setSubmitting(false);
		}
	};

	// Remove Member
	const handleDeleteMember = async () => {
		if (!workspace?.path || !metadata || !deletingMember) return;

		try {
			setSubmitting(true);
			const updatedMembers = members.filter((m) => m.id !== deletingMember.id);
			const updatedMetadata = {
				...metadata,
				members: { members: updatedMembers },
			};

			await writeWorkspaceMetadata({
				path: workspace.path,
				metadata: updatedMetadata,
			});
			await addActivityEvent(
				"Removed member",
				`Removed ${deletingMember.name} from workspace`,
				undefined,
				"member",
			);
			// Removing someone also drops their connection, so they can't keep editing
			if (deletingMember.deviceId) await blockDevice(deletingMember.deviceId).catch(() => disconnectPeer(deletingMember.deviceId!).catch(() => {}));
			setDeletingMember(null);
			await refreshMetadata();
		} catch (err) {
			console.error("Failed to delete member:", err);
			logError(err, { source: "members" });
		} finally {
			setSubmitting(false);
		}
	};

	// Discord-style: people grouped under their role, highest first; a role the app does not know counts as Viewer
	const roleGroups = ["Owner", "Admin", "Editor", "Viewer"]
		.map((role) => ({ role, list: members.filter((m) => (ROLE_CONFIG[m.role] ? m.role : "Viewer") === role) }))
		.filter((g) => g.list.length > 0);

	return (
		<div className="flex flex-col">
			<PageHeader
				title="Members"
				description="Who is in this workspace, who is online, and what each role can do."
				actions={
					<>
					<Button
						variant="outline"
						onPress={() => setIsInviteOpen(true)}
						className="gap-1.5"
					>
						<KeyRound className="size-4 text-info" />
						Sharing & Invites
						{peers.length > 0 && (
							<span className="flex h-2 w-2 rounded-none bg-success animate-ping ml-1" />
						)}
					</Button>
					<Button
						isDisabled={isJoinedCopy}
						onPress={() => {
							setNewMemberName("");
							setNewMemberRole("Editor");
							setIsAddMemberOpen(true);
						}}
						className="gap-1.5"
					>
						<UserPlus className="size-4" />
						Add Member
					</Button>
					</>
				}
			/>

			{/* Members Grid & Roles Overview */}
			<div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
				{/* Left 2 Cols: Member Directory */}
				<div className="space-y-3 lg:col-span-2">
					<Card>
						<CardHeader>
							<CardTitle className="text-base">People</CardTitle>
							<CardDescription>
								Grouped by role. Offline people are dimmed.
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-3">
							{isJoinedCopy && (
								<p className="text-xs text-muted-foreground">
									{selfRole === "Admin"
										? "You are an Admin here, so you can ask the host to change Editors and Viewers."
										: "You joined this workspace, so its host manages the member list."}
								</p>
							)}
							{members.length === 0 ? (
								<p className="text-sm text-muted-foreground">
									No members registered.
								</p>
							) : (
								roleGroups.map(({ role, list }) => (
									<div key={role} className="flex flex-col gap-1">
										<h3 className="px-3 pb-1 font-mono text-xs text-muted-foreground">{role.toLowerCase()} / {list.length}</h3>
										{list.map((member) => {
									const isOwner = member.role.toLowerCase() === "owner";
									const isYou = isJoinedCopy
										? selfId ? member.deviceId === selfId : member.name === selfName
										: isOwner;
									const isOnline =
										!isYou &&
										(member.deviceId ? onlineIds.has(member.deviceId) : onlineNames.has(member.name.toLowerCase()));
									const canEdit = !isJoinedCopy || (!!member.deviceId && rolesFor(member).length > 0);
									const here = presenceOf(member);
									const peer = member.deviceId ? peers.find((p) => p.id === member.deviceId) : undefined;

									return (
										<div
											key={member.id}
											className="flex items-center justify-between gap-3 px-3 py-2.5 transition-colors hover:bg-muted"
										>
											<div className="flex items-center gap-3">
												<span className="relative">
													<Avatar name={member.name} className={cn("size-10", !isOnline && !isYou && "opacity-50")} />
													<span className={cn("absolute -right-0.5 -bottom-0.5 size-3 ring-2 ring-background", isOnline || isYou ? (here?.away ? "bg-warning" : "bg-success") : "bg-muted-foreground/50")} />
												</span>
												<div>
													<div className="flex items-center gap-2">
														<span className="font-semibold text-sm">
															{member.name}
														</span>
														{isYou && (
															<span className="text-xs text-muted-foreground">
																(You)
															</span>
														)}
														{isOnline && (
															<span className={cn("inline-flex items-center gap-1 text-xs", here?.away ? "text-warning" : "text-success")}>
																<span className={cn("size-1.5 rounded-none", here?.away ? "bg-warning" : "bg-success")} />
																{here?.away ? "Away" : "Online"}
																{here && !here.away && ` · ${placeLabel(here)}`}
															</span>
														)}
														{isOnline && peer?.appVersion && (
															<span className="text-xs text-muted-foreground">v{peer.appVersion}</span>
														)}
														{isOnline && peer?.clockSkewMs != null && Math.abs(peer.clockSkewMs) >= 120_000 && (
															<span className="text-xs text-warning">Their clock is {skewText(peer.clockSkewMs)}; Nexsync adjusts for it</span>
														)}
														{isOnline && peer?.needsUpdate && (
															<span className="text-xs text-warning">Runs a newer Nexsync: update to keep syncing</span>
														)}
														{!isOnline && !isYou && member.lastSeen && (
															<span className="text-xs text-muted-foreground">Last seen {lastSeenText(member.lastSeen)}</span>
														)}
													</div>
													{probes[member.id] && (
															<p className="mt-0.5 text-xs text-muted-foreground">
																{probes[member.id] === "running" ? "Looking for them by device key…" : probeText(probes[member.id] as ProbeResult)}
															</p>
														)}
												</div>
											</div>

											{member.deviceId && !isYou && (
												<span title="Check whether this member can be reached from here without the host">
													<Button
														variant="ghost"
														size="icon-xs"
														onPress={() => void runProbe(member)}
														isDisabled={probes[member.id] === "running"}
														aria-label={`Check whether ${member.name} can be reached directly`}
													>
														<Activity className="size-3.5 text-muted-foreground hover:text-foreground" />
													</Button>
												</span>
											)}
											{isJoinedCopy && isYou && (
												<Button
													variant="ghost"
													size="icon-xs"
													onPress={() => {
														setRenameValue(member.name);
														setRenameError(null);
														setRenameOpen(true);
													}}
													aria-label="Change my name in this workspace"
												>
													<Pencil className="size-3.5 text-muted-foreground hover:text-foreground" />
												</Button>
											)}
											{canEdit && (
												<div className="flex items-center gap-1">
													<Button
														variant="ghost"
														size="icon-xs"
														onPress={() => {
															setEditingMember(member);
															setEditName(member.name);
															setEditRole(member.role);
														}}
														aria-label="Edit Member"
													>
														<Pencil className="size-3.5 text-muted-foreground hover:text-foreground" />
													</Button>
													{!isOwner && !isJoinedCopy && isOnline && member.deviceId && (
	<Button
		variant="ghost"
		size="icon-xs"
		onPress={() => {
			setHandoffError(null);
			setHostTarget(member);
		}}
		aria-label="Make Host"
	>
		<Crown className="size-3.5 text-muted-foreground hover:text-warning" />
	</Button>
)}
{!isOwner && !isJoinedCopy && (
														<Button
															variant="ghost"
															size="icon-xs"
															onPress={() => setDeletingMember(member)}
															aria-label="Remove Member"
														>
															<Trash2 className="size-3.5 text-muted-foreground hover:text-destructive" />
														</Button>
													)}
												</div>
											)}
										</div>
									);
								})}
									</div>
								))
							)}
						</CardContent>
					</Card>
				</div>

				{/* Right 1 Col: Permissions Summary */}
				<div>
					<Card>
						<CardHeader>
							<CardTitle className="text-base flex items-center gap-2">
								<Shield className="size-4 text-primary" />
								Role Permissions
							</CardTitle>
							<CardDescription>
								Access levels configured for this workspace.
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-4 text-xs">
							<div className="border-l-2 border-border py-1 pl-4">
								<div className="flex items-center gap-1.5 font-semibold text-warning">
									<Crown className="size-3.5" />
									Owner
								</div>
								<p className="mt-1 text-muted-foreground">
									Full access to files, tasks, members, sharing and workspace settings.
								</p>
							</div>

							<div className="border-l-2 border-border py-1 pl-4">
								<div className="flex items-center gap-1.5 font-semibold text-info">
									<ShieldCheck className="size-3.5" />
									Admin
								</div>
								<p className="mt-1 text-muted-foreground">
									Everything an Editor can do, plus changing Editors and Viewers to
									one another. Only the Owner can make or change Admins.
								</p>
							</div>

							<div className="border-l-2 border-border py-1 pl-4">
								<div className="flex items-center gap-1.5 font-semibold text-info">
									<Shield className="size-3.5" />
									Editor
								</div>
								<p className="mt-1 text-muted-foreground">
									Can edit files, notes, Kanban cards and tasks, and work on notes together in real time.
								</p>
							</div>

							<div className="border-l-2 border-border py-1 pl-4">
								<div className="flex items-center gap-1.5 font-semibold text-success">
									<UserCheck className="size-3.5" />
									Viewer
								</div>
								<p className="mt-1 text-muted-foreground">
									Read-only access to files, assets, tasks, and kanban boards.
								</p>
							</div>
						</CardContent>
					</Card>
				</div>
			</div>

			{/* Real P2P WebRTC Connection & E2EE Handshake Dialog */}
			<P2PConnectDialog
				open={isInviteOpen}
				onOpenChange={setIsInviteOpen}
			/>

			{/* Add Member Dialog */}
			{isAddMemberOpen && (
				<Dialog
					isOpen={isAddMemberOpen}
					onOpenChange={setIsAddMemberOpen}
					className="max-w-md"
				>
					<form onSubmit={handleAddMemberSubmit} className="space-y-4">
						<DialogHeader>
							<DialogTitle>Add Member</DialogTitle>
							<DialogDescription>
								Add a collaborator to this workspace.
							</DialogDescription>
						</DialogHeader>

						<div className="space-y-3">
							<div>
								<Label htmlFor="mem-name">Member Name *</Label>
								<Input
									id="mem-name"
									required
									value={newMemberName}
									onChange={(e) => setNewMemberName(e.target.value)}
									placeholder="e.g. Alice, Bob"
									className="mt-1"
									autoFocus
								/>
							</div>

							<div>
								<Label htmlFor="mem-role">Assigned Role</Label>
								<select
									id="mem-role"
									value={newMemberRole}
									onChange={(e) => setNewMemberRole(e.target.value)}
									className="mt-1 flex h-10 w-full rounded-none border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring"
								>
									{ASSIGNABLE_ROLES.map((r) => (
										<option key={r} value={r}>{r}</option>
									))}
								</select>
							</div>
						</div>

						<DialogFooter>
							<Button
								type="button"
								variant="outline"
								onPress={() => setIsAddMemberOpen(false)}
								isDisabled={submitting}
							>
								Cancel
							</Button>
							<Button
								type="submit"
								isDisabled={submitting || !newMemberName.trim()}
							>
								{submitting ? "Adding…" : "Add Member"}
							</Button>
						</DialogFooter>
					</form>
				</Dialog>
			)}

			{/* Edit Role Dialog */}
			{editingMember && (
				<Dialog
					isOpen={!!editingMember}
					onOpenChange={(open) => !open && setEditingMember(null)}
					className="max-w-md"
				>
					<form onSubmit={handleEditRoleSubmit} className="space-y-4">
						<DialogHeader>
							<DialogTitle>Edit Member</DialogTitle>
							<DialogDescription>
								Update the name and permissions for{" "}
								<span className="font-semibold text-foreground">
									{editingMember.name}
								</span>
								.
							</DialogDescription>
						</DialogHeader>

						{!isJoinedCopy && (
						<div>
							<Label htmlFor="edit-member-name">Name</Label>
							<Input
								id="edit-member-name"
								required
								value={editName}
								onChange={(e) => setEditName(e.target.value)}
								className="mt-1"
							/>
							{editingMember.role.toLowerCase() === "owner" && (
								<p className="mt-1 text-xs text-muted-foreground">
									Collaborators see this name when you invite them.
								</p>
							)}
						</div>
						)}

						{editingMember.role.toLowerCase() !== "owner" && (
							<div>
								<Label htmlFor="edit-role-select">Role</Label>
								<select
								id="edit-role-select"
								value={editRole}
								onChange={(e) => setEditRole(e.target.value)}
								className="mt-1 flex h-10 w-full rounded-none border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring"
							>
								{rolesFor(editingMember).map((r) => (
									<option key={r} value={r}>{r}</option>
								))}
							</select>
							</div>
						)}

						<DialogFooter>
							<Button
								type="button"
								variant="outline"
								onPress={() => setEditingMember(null)}
								isDisabled={submitting}
							>
								Cancel
							</Button>
							<Button type="submit" isDisabled={submitting || (!isJoinedCopy && !editName.trim())}>
								{submitting ? "Saving…" : "Save Changes"}
							</Button>
						</DialogFooter>
					</form>
				</Dialog>
			)}

			{/* Change My Name Dialog (guests) */}
			{renameOpen && (
				<Dialog isOpen onOpenChange={(open) => !open && setRenameOpen(false)} className="max-w-md">
					<form
						onSubmit={(e) => {
							e.preventDefault();
							const problem = nameProblem(members, renameValue, members.find((m) => m.deviceId === selfId)?.id);
							if (problem) return setRenameError(problem);
							requestName(cleanName(renameValue));
							setRenameOpen(false);
						}}
						className="space-y-4"
					>
						<DialogHeader>
							<DialogTitle>Change my name here</DialogTitle>
							<DialogDescription>
								This is the name others see in this workspace. It does not change the name you use elsewhere, and nobody else here can have the same one.
							</DialogDescription>
						</DialogHeader>
						<div>
							<Label htmlFor="my-workspace-name">Name in this workspace</Label>
							<Input
								id="my-workspace-name"
								value={renameValue}
								onChange={(e) => {
									setRenameValue(e.target.value);
									setRenameError(null);
								}}
								className="mt-1"
								autoFocus
							/>
							{renameError && <p className="mt-1 text-xs text-destructive">{renameError}</p>}
						</div>
						<DialogFooter>
							<Button type="button" variant="outline" onPress={() => setRenameOpen(false)}>
								Cancel
							</Button>
							<Button type="submit" isDisabled={!renameValue.trim()}>
								Save
							</Button>
						</DialogFooter>
					</form>
				</Dialog>
			)}

			{/* Transfer Host Dialog */}
{hostTarget && (
	<Dialog isOpen onOpenChange={(open) => !open && !handoffBusy && setHostTarget(null)}>
		<div className="space-y-4">
			<DialogHeader>
				<DialogTitle>Make {hostTarget.name} the Host</DialogTitle>
				<DialogDescription>
					{hostTarget.name} becomes the Owner and hosts this workspace from their device. You stay as an
					Admin, and everyone reconnects to them automatically. They have to accept first.
				</DialogDescription>
			</DialogHeader>
			{handoffError && <p className="text-xs text-destructive">{handoffError}</p>}
			<DialogFooter>
				<Button variant="outline" isDisabled={handoffBusy} onPress={() => setHostTarget(null)}>
					Cancel
				</Button>
				<Button isDisabled={handoffBusy} onPress={handleTransferHost}>
					{handoffBusy ? "Waiting for them…" : "Transfer Host"}
				</Button>
			</DialogFooter>
		</div>
	</Dialog>
)}

{/* Remove Member Confirmation Dialog */}
			{deletingMember && (
				<Dialog
					isOpen={!!deletingMember}
					onOpenChange={(open) => !open && setDeletingMember(null)}
				>
					<div className="space-y-4">
						<DialogHeader>
							<DialogTitle>Remove Collaborator</DialogTitle>
							<DialogDescription>
								Are you sure you want to remove{" "}
								<span className="font-semibold text-foreground">
									{deletingMember.name}
								</span>{" "}
								from this workspace? They will be disconnected and cannot rejoin with an earlier invite or code.
							</DialogDescription>
						</DialogHeader>

						<DialogFooter>
							<Button
								variant="outline"
								onPress={() => setDeletingMember(null)}
							>
								Cancel
							</Button>
							<Button variant="destructive" onPress={handleDeleteMember}>
								Remove
							</Button>
						</DialogFooter>
					</div>
				</Dialog>
			)}
		</div>
	);
}
