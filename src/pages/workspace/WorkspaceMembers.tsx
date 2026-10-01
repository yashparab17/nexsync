import { useState } from "react";
import {
	Crown,
	KeyRound,
	Pencil,
	Shield,
	ShieldCheck,
	Trash2,
	UserCheck,
	UserPlus,
} from "lucide-react";

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


import { useErrorLog } from "@/hooks/useErrorLog";
import { writeWorkspaceMetadata } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { ASSIGNABLE_ROLES, canChangeRole } from "@/lib/roles";
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
		color: "text-ctp-yellow",
		bg: "bg-ctp-yellow/10 border-ctp-yellow/20",
	},
	Admin: {
		label: "Admin",
		icon: ShieldCheck,
		color: "text-ctp-mauve",
		bg: "bg-ctp-mauve/10 border-ctp-mauve/20",
	},
	Editor: {
		label: "Editor",
		icon: Shield,
		color: "text-ctp-sky",
		bg: "bg-ctp-sky/10 border-ctp-sky/20",
	},
	Viewer: {
		label: "Viewer",
		icon: UserCheck,
		color: "text-ctp-green",
		bg: "bg-ctp-green/10 border-ctp-green/20",
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

	const { peers, selfName, selfId, requestRoleChange, disconnectPeer, blockDevice, transferHost } = useP2P();
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


	// Add Member directly
	const handleAddMemberSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!workspace?.path || !metadata || !newMemberName.trim()) return;

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

	return (
		<div className="space-y-6">
			{/* Header */}
			<div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
				<div>
					<h1 className="text-2xl font-bold tracking-tight">Members & Roles</h1>
					<p className="mt-1 text-sm text-muted-foreground">
						Manage collaborators and role-based permissions in this workspace.
					</p>
				</div>
				<div className="flex items-center gap-2">
					<Button
						variant="outline"
						onPress={() => setIsInviteOpen(true)}
						className="gap-1.5"
					>
						<KeyRound className="size-4 text-ctp-sky" />
						Sharing & Invites
						{peers.length > 0 && (
							<span className="flex h-2 w-2 rounded-none bg-ctp-green animate-ping ml-1" />
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
				</div>
			</div>

			{/* Members Grid & Roles Overview */}
			<div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
				{/* Left 2 Cols: Member Directory */}
				<div className="space-y-3 lg:col-span-2">
					<Card>
						<CardHeader>
							<CardTitle className="text-base">Workspace Collaborators</CardTitle>
							<CardDescription>
								People who currently have access to this workspace and files.
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
								members.map((member) => {
									const roleConf =
										ROLE_CONFIG[member.role] || ROLE_CONFIG.Viewer;
									const RoleIcon = roleConf.icon;
									const isOwner = member.role.toLowerCase() === "owner";
									const isYou = isJoinedCopy
										? selfId ? member.deviceId === selfId : member.name === selfName
										: isOwner;
									const isOnline =
										!isYou &&
										(member.deviceId ? onlineIds.has(member.deviceId) : onlineNames.has(member.name.toLowerCase()));
									const canEdit = !isJoinedCopy || (!!member.deviceId && rolesFor(member).length > 0);

									return (
										<div
											key={member.id}
											className="flex items-center justify-between rounded-none border bg-muted/20 p-3.5 transition-colors hover:bg-muted/30"
										>
											<div className="flex items-center gap-3">
												<div className="flex size-10 items-center justify-center rounded-none bg-primary/10 font-bold text-primary">
													{member.name.slice(0, 2).toUpperCase()}
												</div>
												<div>
													<div className="flex items-center gap-2">
														<span className="font-semibold text-sm">
															{member.name}
														</span>
														{isYou && (
															<span className="text-[10px] text-muted-foreground">
																(You)
															</span>
														)}
														{isOnline && (
															<span className="inline-flex items-center gap-1 text-[10px] text-ctp-green">
																<span className="size-1.5 rounded-none bg-ctp-green" />
																Online
															</span>
														)}
													</div>
													<div className="flex items-center gap-2 mt-0.5">
														<span
															className={cn(
																"inline-flex items-center gap-1 rounded-none border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
																roleConf.color,
																roleConf.bg,
															)}
														>
															<RoleIcon className="size-3" />
															{roleConf.label}
														</span>
													</div>
												</div>
											</div>

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
		<Crown className="size-3.5 text-muted-foreground hover:text-ctp-yellow" />
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
								})
							)}
						</CardContent>
					</Card>
				</div>

				{/* Right 1 Col: Permissions Summary */}
				<div>
					<Card className="bg-card/50">
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
							<div className="rounded-none border p-3 bg-muted/10">
								<div className="flex items-center gap-1.5 font-semibold text-ctp-yellow">
									<Crown className="size-3.5" />
									Owner
								</div>
								<p className="mt-1 text-muted-foreground">
									Full access to files, tasks, members, sharing and workspace settings.
								</p>
							</div>

							<div className="rounded-none border p-3 bg-muted/10">
								<div className="flex items-center gap-1.5 font-semibold text-ctp-mauve">
									<ShieldCheck className="size-3.5" />
									Admin
								</div>
								<p className="mt-1 text-muted-foreground">
									Everything an Editor can do, plus changing Editors and Viewers to
									one another. Only the Owner can make or change Admins.
								</p>
							</div>

							<div className="rounded-none border p-3 bg-muted/10">
								<div className="flex items-center gap-1.5 font-semibold text-ctp-sky">
									<Shield className="size-3.5" />
									Editor
								</div>
								<p className="mt-1 text-muted-foreground">
									Can edit files, notes, Kanban cards and tasks, and work on notes together in real time.
								</p>
							</div>

							<div className="rounded-none border p-3 bg-muted/10">
								<div className="flex items-center gap-1.5 font-semibold text-ctp-green">
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
								<p className="mt-1 text-[11px] text-muted-foreground">
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
