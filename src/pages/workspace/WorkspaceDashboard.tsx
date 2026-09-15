import { type ReactNode } from "react";
import { useNavigate } from "react-router-dom";

// Icons
import {
	Activity,
	FilePlus,
	FolderOpen,
	ListTodo,
	StickyNote,
	Upload,
	UsersRound,
} from "lucide-react";

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

// Assets
import logo from "@/assets/logos/logo.svg";

// ────────────────────────────
// Helpers
// ────────────────────────────

// Converts ISO-8601 timestamp to a relative time string (e.g. "5m ago")
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

// Converts raw action identifiers into human-friendly capitalized titles
function formatAction(action: string): string {
	const clean = action.replace(/_/g, " ").trim();
	return clean.replace(/\b\w/g, (c) => c.toUpperCase());
}

// Returns a contextual icon matching the entity type of the event
function getActivityIcon(targetType?: string, action?: string) {
	const act = (action || "").toLowerCase();
	const type = (targetType || "").toLowerCase();

	if (type === "note" || act.includes("note")) {
		return <StickyNote className="size-4 text-sky-400 shrink-0" />;
	}
	if (type === "asset" || act.includes("asset")) {
		return <Upload className="size-4 text-emerald-400 shrink-0" />;
	}
	if (type === "task" || act.includes("task")) {
		return <ListTodo className="size-4 text-purple-400 shrink-0" />;
	}
	if (type === "folder") {
		return <FolderOpen className="size-4 text-primary shrink-0" />;
	}
	if (type === "member" || act.includes("member")) {
		return <UsersRound className="size-4 text-primary shrink-0" />;
	}
	return <FilePlus className="size-4 text-amber-400 shrink-0" />;
}

interface StatCardProps {
	label: string;
	value: number;
	to: string;
	icon: ReactNode;
	onNavigate?: (to: string) => void;
}

// Clickable metric card linking to its respective workspace section
function StatCard({ label, value, icon, to, onNavigate }: StatCardProps) {
	return (
		<Card
			className="cursor-pointer transition-all duration-200 hover:-translate-y-0.5 hover:border-primary hover:shadow-md"
			onClick={() => onNavigate?.(to)}
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

// ────────────────────────────
// Main component
// ────────────────────────────

// Workspace overview dashboard showing quick actions, stats, and activity
export default function WorkspaceDashboard() {
	const { workspace, metadata, stats } = useWorkspace();
	const navigate = useNavigate();

	const activity = metadata?.activity.events ?? [];

	// Quick action shortcuts
	const quickActions = [
		{
			label: "New Note",
			icon: StickyNote,
			onClick: () => navigate("/workspace/notes"),
		},
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
	];

	return (
		<div className="space-y-6">
			{/* Watermark logo */}
			<div className="pointer-events-none absolute inset-0 flex items-center justify-center z-[-1]">
				<img src={logo} className="h-150 w-150 opacity-10" alt="" />
			</div>

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

			{/* Stats Grid */}
			<div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
				<StatCard
					label="Files"
					value={stats?.files ?? 0}
					to="/workspace/files"
					onNavigate={navigate}
					icon={<FilePlus className="size-8 text-primary/60" />}
				/>
				<StatCard
					label="Assets"
					value={stats?.assets ?? 0}
					to="/workspace/assets"
					onNavigate={navigate}
					icon={<Upload className="size-8 text-primary/60" />}
				/>
				<StatCard
					label="Tasks"
					value={stats?.tasks ?? 0}
					to="/workspace/tasks"
					onNavigate={navigate}
					icon={<ListTodo className="size-8 text-primary/60" />}
				/>
				<StatCard
					label="Members"
					value={stats?.members ?? 0}
					to="/workspace/members"
					onNavigate={navigate}
					icon={<UsersRound className="size-8 text-primary/60" />}
				/>
			</div>

			{/* Recent Activity */}
			<div>
				<Card>
					<CardHeader>
						<CardTitle className="flex items-center gap-2">
							<Activity className="size-5 text-primary" />
							Recent Activity
						</CardTitle>
						<CardDescription>
							Latest events and changes in this workspace.
						</CardDescription>
					</CardHeader>
					<CardContent>
						{activity.length === 0 ? (
							<p className="text-sm text-muted-foreground">
								No activity yet. Start by creating a note, file, or task.
							</p>
						) : (
							<ul className="divide-y divide-border/50">
								{activity.slice(0, 7).map((event) => (
									<li
										key={event.id}
										className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0 text-sm"
									>
										<div className="flex items-start gap-3 min-w-0">
											<div className="p-2 rounded-lg bg-muted/60 mt-0.5">
												{getActivityIcon(event.target_type, event.action)}
											</div>
											<div className="min-w-0">
												<p className="font-semibold text-xs text-foreground">
													{formatAction(event.action)}
												</p>
												<p className="text-xs text-muted-foreground truncate mt-0.5">
													{event.detail}
												</p>
											</div>
										</div>
										<span className="shrink-0 text-[11px] font-mono text-muted-foreground">
											{formatRelative(event.timestamp)}
										</span>
									</li>
								))}
							</ul>
						)}
					</CardContent>
				</Card>
			</div>
		</div>
	);
}
