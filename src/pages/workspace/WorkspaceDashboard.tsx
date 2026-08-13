import { type ReactNode } from "react";
import { useNavigate } from "react-router-dom";

// Icons
import { FilePlus, ListTodo, Upload, UsersRound } from "lucide-react";

// Components
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";

// Context
import { useWorkspace } from "@/store/workspace/WorkspaceContext";

// ─── helpers ─────────────────────────────────────────────

/**
 * Converts an ISO-8601 timestamp into a compact, human-friendly relative
 * time (e.g. "5m ago"). Falls back to an absolute locale date for anything
 * older than a week.
 */
function formatRelative(iso: string): string {
	if (!iso) return "—";
	const then = new Date(iso).getTime();
	const now = Date.now();
	const diff = Math.max(0, now - then);
	const mins = Math.floor(diff / 60_000);
	if (mins < 1) return "just now";
	if (mins < 60) return `${mins}m ago`;
	const hours = Math.floor(mins / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	if (days < 7) return `${days}d ago`;
	return new Date(iso).toLocaleDateString();
}

interface StatCardProps {
	label: string;
	value: number;
	to: string;
	icon: ReactNode;
}

/**
 * A clickable stat card that deep-links into the corresponding workspace
 * section (Files, Assets, Tasks, Members) so counts become shortcuts.
 */
function StatCard({ label, value, to, icon }: StatCardProps) {
	const navigate = useNavigate();

	return (
		<Card
			className="cursor-pointer transition-all duration-200 hover:-translate-y-0.5 hover:border-primary"
			onClick={() => navigate(to)}
		>
			<CardContent className="flex items-center justify-between py-5">
				<div>
					<p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
						{label}
					</p>
					<p className="mt-1 text-3xl font-bold">{value}</p>
				</div>
				{icon}
			</CardContent>
		</Card>
	);
}

// ─── main component ──────────────────────────────────────

export default function WorkspaceDashboard() {
	const { workspace, metadata, stats } = useWorkspace();
	const navigate = useNavigate();

	const activity = metadata?.activity.events ?? [];
	const recentFiles = metadata?.history.recent_files ?? [];

	const quickActions = [
		{
			label: "New File",
			icon: FilePlus,
			onClick: () => navigate("/workspace/files"),
		},
		{
			label: "New Task",
			icon: ListTodo,
			onClick: () => navigate("/workspace/tasks"),
		},
		{
			label: "Upload Asset",
			icon: Upload,
			onClick: () => navigate("/workspace/assets"),
		},
		{
			label: "Members",
			icon: UsersRound,
			onClick: () => navigate("/workspace/members"),
		},
	];

	return (
		<div className="space-y-6">
			{/* Header */}
			<div>
				<h1 className="text-2xl font-semibold">Dashboard</h1>
				<p className="mt-1 text-sm text-muted-foreground">
					Welcome back to{" "}
					<span className="font-semibold text-foreground">
						{workspace?.name}
					</span>
					. Here's what's happening in your workspace.
				</p>
			</div>

			{/* Quick Actions */}
			<div className="flex flex-wrap gap-2">
				{quickActions.map((action) => {
					const Icon = action.icon;
					return (
						<Button
							key={action.label}
							variant="outline"
							onPress={action.onClick}
						>
							<Icon data-icon="inline-start" className="size-4" />
							{action.label}
						</Button>
					);
				})}
			</div>

			{/* Stats */}
			<div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
				<StatCard
					label="Files"
					value={stats?.files ?? 0}
					to="/workspace/files"
					icon={<FilePlus className="size-8 text-primary/60" />}
				/>
				<StatCard
					label="Assets"
					value={stats?.assets ?? 0}
					to="/workspace/assets"
					icon={<Upload className="size-8 text-primary/60" />}
				/>
				<StatCard
					label="Tasks"
					value={stats?.tasks ?? 0}
					to="/workspace/tasks"
					icon={<ListTodo className="size-8 text-primary/60" />}
				/>
				<StatCard
					label="Members"
					value={stats?.members ?? 0}
					to="/workspace/members"
					icon={<UsersRound className="size-8 text-primary/60" />}
				/>
			</div>

			<div className="grid gap-6 lg:grid-cols-2">
				{/* Recent Activity */}
				<Card>
					<CardHeader>
						<CardTitle>Recent Activity</CardTitle>
						<CardDescription>
							Latest events in this workspace.
						</CardDescription>
					</CardHeader>
					<CardContent>
						{activity.length === 0 ?
							<p className="text-sm text-muted-foreground">
								No activity yet. Start by creating a file or
								task.
							</p>
						:	<ul className="space-y-3">
								{activity.slice(0, 6).map((event) => (
									<li
										key={event.id}
										className="flex items-start justify-between gap-3 text-sm"
									>
										<div className="min-w-0">
											<p className="truncate font-medium">
												{event.action}
											</p>
											<p className="truncate text-muted-foreground">
												{event.detail}
											</p>
										</div>
										<span className="shrink-0 text-xs text-muted-foreground">
											{formatRelative(event.timestamp)}
										</span>
									</li>
								))}
							</ul>
						}
					</CardContent>
				</Card>

				{/* Recent Files */}
				<Card>
					<CardHeader>
						<CardTitle>Recent Files</CardTitle>
						<CardDescription>
							Files you've opened recently.
						</CardDescription>
					</CardHeader>
					<CardContent>
						{recentFiles.length === 0 ?
							<p className="text-sm text-muted-foreground">
								No recent files. Open something from the Files
								page.
							</p>
						:	<ul className="space-y-3">
								{recentFiles.slice(0, 6).map((file) => (
									<li
										key={file}
										className="flex items-center gap-3 text-sm"
									>
										<FilePlus className="size-4 shrink-0 text-primary/60" />
										<span className="truncate font-medium">
											{file.split("/").pop()}
										</span>
									</li>
								))}
							</ul>
						}
					</CardContent>
				</Card>
			</div>
		</div>
	);
}
