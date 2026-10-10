import { useEffect } from "react";
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
		return <StickyNote className="size-4 shrink-0 text-muted-foreground" />;
	}
	if (type === "asset" || act.includes("asset")) {
		return <Upload className="size-4 shrink-0 text-muted-foreground" />;
	}
	if (type === "task" || act.includes("task")) {
		return <ListTodo className="size-4 shrink-0 text-muted-foreground" />;
	}
	if (type === "kanban" || act.includes("card") || act.includes("list") || act.includes("column")) {
		return <ListTodo className="size-4 shrink-0 text-muted-foreground" />;
	}
	if (type === "folder") {
		return <FolderOpen className="size-4 shrink-0 text-muted-foreground" />;
	}
	if (type === "member" || act.includes("member")) {
		return <UsersRound className="size-4 shrink-0 text-muted-foreground" />;
	}
	return <FilePlus className="size-4 shrink-0 text-muted-foreground" />;
}

// ────────────────────────────
// Main component
// ────────────────────────────

// Workspace overview dashboard showing quick actions, stats, and activity
export default function WorkspaceDashboard() {
	const { workspace, metadata, stats, refreshMetadata, refreshStats } =
		useWorkspace();
	const navigate = useNavigate();

	useEffect(() => {
		void refreshMetadata();
		void refreshStats();
	}, [refreshMetadata, refreshStats]);

	const activity = metadata?.activity.events ?? [];

	const counts: [string, number, string][] = [
		["files", stats?.files ?? 0, "/workspace/files"],
		["assets", stats?.assets ?? 0, "/workspace/assets"],
		["tasks", stats?.tasks ?? 0, "/workspace/tasks"],
		["members", stats?.members ?? 0, "/workspace/members"],
	];

	// Quick action shortcuts
	const quickActions = [
		{
			label: "Open notes",
			icon: StickyNote,
			onClick: () => navigate("/workspace/notes"),
		},
		{
			label: "Open files",
			icon: FilePlus,
			onClick: () => navigate("/workspace/files"),
		},
		{
			label: "Open tasks",
			icon: ListTodo,
			onClick: () => navigate("/workspace/tasks"),
		},
		{
			label: "Open assets",
			icon: Upload,
			onClick: () => navigate("/workspace/assets"),
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
					. Here is what changed lately.
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

			{/* What is in the workspace, each count opens its page */}
			<dl className="flex flex-wrap gap-x-8 gap-y-2 border-y py-3">
				{counts.map(([label, value, path]) => (
					<button key={label} type="button" onClick={() => navigate(path)} className="flex items-baseline gap-2 hover:text-primary">
						<dd className="text-2xl font-bold tabular-nums">{value}</dd>
						<dt className="text-sm text-muted-foreground">{label}</dt>
					</button>
				))}
			</dl>

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
								Nothing has changed yet. Create a note, file or task to get started.
							</p>
						) : (
							<ul className="divide-y divide-border/50">
								{activity.slice(0, 7).map((event) => (
									<li
										key={event.id}
										className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0 text-sm"
									>
										<div className="flex items-start gap-3 min-w-0">
											<div className="p-2 rounded-none bg-muted/60 mt-0.5">
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
										<span className="shrink-0 text-xs tabular-nums text-muted-foreground">
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
