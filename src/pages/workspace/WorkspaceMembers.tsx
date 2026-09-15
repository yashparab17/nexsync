import { useState } from "react";
import {
	Check,
	Copy,
	Crown,
	KeyRound,
	Pencil,
	Shield,
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
import { useWorkspace } from "@/store/workspace/WorkspaceContext";
import type { Member } from "@/types/workspace";

const ROLE_CONFIG: Record<
	string,
	{ label: string; icon: typeof Shield; color: string; bg: string }
> = {
	Owner: {
		label: "Owner",
		icon: Crown,
		color: "text-amber-400",
		bg: "bg-amber-500/10 border-amber-500/20",
	},
	Editor: {
		label: "Editor",
		icon: Shield,
		color: "text-sky-400",
		bg: "bg-sky-500/10 border-sky-500/20",
	},
	Viewer: {
		label: "Viewer",
		icon: UserCheck,
		color: "text-emerald-400",
		bg: "bg-emerald-500/10 border-emerald-500/20",
	},
};

export default function WorkspaceMembers() {
	const { workspace, metadata, refreshMetadata } = useWorkspace();
	const logError = useErrorLog();

	const [isInviteOpen, setIsInviteOpen] = useState(false);
	const [isAddMemberOpen, setIsAddMemberOpen] = useState(false);
	const [newMemberName, setNewMemberName] = useState("");
	const [newMemberRole, setNewMemberRole] = useState("Editor");

	const [editingMember, setEditingMember] = useState<Member | null>(null);
	const [editRole, setEditRole] = useState("Editor");

	const [deletingMember, setDeletingMember] = useState<Member | null>(null);
	const [copiedInvite, setCopiedInvite] = useState(false);
	const [submitting, setSubmitting] = useState(false);

	const members = metadata?.members.members ?? [];

	// Generate a simulated cryptographic invite code
	const inviteCode = `nx-${workspace?.id?.slice(0, 8) || "invite"}-${Date.now().toString(36)}`;

	const handleCopyInvite = () => {
		navigator.clipboard.writeText(inviteCode);
		setCopiedInvite(true);
		setTimeout(() => setCopiedInvite(false), 2000);
	};

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
		if (!workspace?.path || !metadata || !editingMember) return;

		try {
			setSubmitting(true);
			const updatedMembers = members.map((m) =>
				m.id === editingMember.id ? { ...m, role: editRole } : m,
			);
			const updatedMetadata = {
				...metadata,
				members: { members: updatedMembers },
			};

			await writeWorkspaceMetadata({
				path: workspace.path,
				metadata: updatedMetadata,
			});
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
						<KeyRound className="size-4" />
						Invite Code
					</Button>
					<Button
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
								Users who currently have access to this workspace database and
								files.
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-3">
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

									return (
										<div
											key={member.id}
											className="flex items-center justify-between rounded-lg border bg-muted/20 p-3.5 transition-colors hover:bg-muted/30"
										>
											<div className="flex items-center gap-3">
												<div className="flex size-10 items-center justify-center rounded-full bg-primary/10 font-bold text-primary">
													{member.name.slice(0, 2).toUpperCase()}
												</div>
												<div>
													<div className="flex items-center gap-2">
														<span className="font-semibold text-sm">
															{member.name}
														</span>
														{isOwner && (
															<span className="text-[10px] text-muted-foreground">
																(You)
															</span>
														)}
													</div>
													<div className="flex items-center gap-2 mt-0.5">
														<span
															className={cn(
																"inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
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

											{!isOwner && (
												<div className="flex items-center gap-1">
													<Button
														variant="ghost"
														size="icon-xs"
														onPress={() => {
															setEditingMember(member);
															setEditRole(member.role);
														}}
														aria-label="Change Role"
													>
														<Pencil className="size-3.5 text-muted-foreground hover:text-foreground" />
													</Button>
													<Button
														variant="ghost"
														size="icon-xs"
														onPress={() => setDeletingMember(member)}
														aria-label="Remove Member"
													>
														<Trash2 className="size-3.5 text-muted-foreground hover:text-destructive" />
													</Button>
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
							<div className="rounded-lg border p-3 bg-muted/10">
								<div className="flex items-center gap-1.5 font-semibold text-amber-400">
									<Crown className="size-3.5" />
									Owner
								</div>
								<p className="mt-1 text-muted-foreground">
									Full access to file system, SQLite database, member
									management, P2P sync, and workspace settings.
								</p>
							</div>

							<div className="rounded-lg border p-3 bg-muted/10">
								<div className="flex items-center gap-1.5 font-semibold text-sky-400">
									<Shield className="size-3.5" />
									Editor
								</div>
								<p className="mt-1 text-muted-foreground">
									Can read/write files, edit Kanban cards, manage Tasks, and
									sync real-time edits over CRDT.
								</p>
							</div>

							<div className="rounded-lg border p-3 bg-muted/10">
								<div className="flex items-center gap-1.5 font-semibold text-emerald-400">
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

			{/* Invite Code Dialog */}
			{isInviteOpen && (
				<Dialog
					isOpen={isInviteOpen}
					onOpenChange={setIsInviteOpen}
					className="max-w-md"
				>
					<div className="space-y-4">
						<DialogHeader>
							<DialogTitle>Collaborator Invite Code</DialogTitle>
							<DialogDescription>
								Share this code with peer collaborators to let them join this
								workspace via P2P.
							</DialogDescription>
						</DialogHeader>

						<div className="space-y-2">
							<Label>Invite Token</Label>
							<div className="flex items-center gap-2">
								<Input
									readOnly
									value={inviteCode}
									className="font-mono text-xs bg-muted/50"
								/>
								<Button
									variant="outline"
									size="icon"
									onPress={handleCopyInvite}
								>
									{copiedInvite ? (
										<Check className="size-4 text-emerald-400" />
									) : (
										<Copy className="size-4" />
									)}
								</Button>
							</div>
							{copiedInvite && (
								<p className="text-xs text-emerald-400">
									Copied to clipboard!
								</p>
							)}
						</div>

						<DialogFooter>
							<Button variant="outline" onPress={() => setIsInviteOpen(false)}>
								Close
							</Button>
						</DialogFooter>
					</div>
				</Dialog>
			)}

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
								Register a collaborator in the workspace SQLite database.
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
									<option value="Editor">Editor</option>
									<option value="Viewer">Viewer</option>
									<option value="Owner">Owner</option>
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
							<DialogTitle>Change Role</DialogTitle>
							<DialogDescription>
								Update permissions for{" "}
								<span className="font-semibold text-foreground">
									{editingMember.name}
								</span>
								.
							</DialogDescription>
						</DialogHeader>

						<div>
							<Label htmlFor="edit-role-select">Role</Label>
							<select
								id="edit-role-select"
								value={editRole}
								onChange={(e) => setEditRole(e.target.value)}
								className="mt-1 flex h-10 w-full rounded-none border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring"
							>
								<option value="Editor">Editor</option>
								<option value="Viewer">Viewer</option>
								<option value="Owner">Owner</option>
							</select>
						</div>

						<DialogFooter>
							<Button
								type="button"
								variant="outline"
								onPress={() => setEditingMember(null)}
								isDisabled={submitting}
							>
								Cancel
							</Button>
							<Button type="submit" isDisabled={submitting}>
								{submitting ? "Saving…" : "Save Changes"}
							</Button>
						</DialogFooter>
					</form>
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
								from this workspace?
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
