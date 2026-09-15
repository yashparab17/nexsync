import { useCallback, useEffect, useMemo, useState } from "react";
import {
	AlertCircle,
	Calendar,
	CheckCircle2,
	Clock,
	Filter,
	ListTodo,
	Pencil,
	Plus,
	Search,
	Sparkles,
	Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { createTask, deleteTask, getTasks, updateTask } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/store/workspace/WorkspaceContext";
import type { Task, TaskPriority, TaskStatus } from "@/types/workspace";

// ────────────────────────────
// Priority & Status Styling Helpers
// ────────────────────────────

const PRIORITY_CONFIG: Record<
	TaskPriority,
	{ label: string; color: string; bg: string; border: string }
> = {
	low: {
		label: "Low",
		color: "text-blue-400",
		bg: "bg-blue-500/10",
		border: "border-blue-500/20",
	},
	medium: {
		label: "Medium",
		color: "text-amber-400",
		bg: "bg-amber-500/10",
		border: "border-amber-500/20",
	},
	high: {
		label: "High",
		color: "text-rose-400",
		bg: "bg-rose-500/10",
		border: "border-rose-500/20",
	},
};

const STATUS_CONFIG: Record<
	TaskStatus,
	{ label: string; icon: typeof Clock; color: string; border: string }
> = {
	todo: {
		label: "To Do",
		icon: Clock,
		color: "text-muted-foreground",
		border: "border-border",
	},
	in_progress: {
		label: "In Progress",
		icon: AlertCircle,
		color: "text-amber-400",
		border: "border-amber-500/30",
	},
	done: {
		label: "Done",
		icon: CheckCircle2,
		color: "text-emerald-400",
		border: "border-emerald-500/30",
	},
};

export default function WorkspaceTasks() {
	const { workspace, refreshMetadata } = useWorkspace();
	const logError = useErrorLog();

	const [tasks, setTasks] = useState<Task[]>([]);
	const [loading, setLoading] = useState(true);
	const [searchQuery, setSearchQuery] = useState("");
	const [statusFilter, setStatusFilter] = useState<TaskStatus | "all">("all");
	const [priorityFilter, setPriorityFilter] = useState<TaskPriority | "all">(
		"all",
	);

	// Dialog States
	const [isCreateOpen, setIsCreateOpen] = useState(false);
	const [editingTask, setEditingTask] = useState<Task | null>(null);
	const [deletingTaskId, setDeletingTaskId] = useState<string | null>(null);

	// Form State for Create/Edit
	const [formTitle, setFormTitle] = useState("");
	const [formDescription, setFormDescription] = useState("");
	const [formStatus, setFormStatus] = useState<TaskStatus>("todo");
	const [formPriority, setFormPriority] = useState<TaskPriority>("medium");
	const [formDueDate, setFormDueDate] = useState("");
	const [formSubmitting, setFormSubmitting] = useState(false);

	// Fetch Tasks from SQLite backend
	const loadTasks = useCallback(async () => {
		if (!workspace?.path) return;
		try {
			setLoading(true);
			const data = await getTasks(workspace.path);
			setTasks(data);
		} catch (err) {
			console.error("Failed to load tasks:", err);
			logError(err, { source: "tasks" });
		} finally {
			setLoading(false);
		}
	}, [workspace?.path, logError]);

	useEffect(() => {
		loadTasks();
	}, [loadTasks]);

	// Open Create Modal
	const handleOpenCreate = () => {
		setFormTitle("");
		setFormDescription("");
		setFormStatus("todo");
		setFormPriority("medium");
		setFormDueDate("");
		setIsCreateOpen(true);
	};

	// Open Edit Modal
	const handleOpenEdit = (task: Task) => {
		setEditingTask(task);
		setFormTitle(task.title);
		setFormDescription(task.description || "");
		setFormStatus(task.status);
		setFormPriority(task.priority);
		setFormDueDate(task.due_date ? task.due_date.slice(0, 10) : "");
	};

	// Submit Create Task
	const handleCreateSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!workspace?.path || !formTitle.trim()) return;

		try {
			setFormSubmitting(true);
			const now = new Date().toISOString();
			const newTask: Task = {
				id: crypto.randomUUID(),
				title: formTitle.trim(),
				description: formDescription.trim(),
				status: formStatus,
				priority: formPriority,
				due_date: formDueDate ? new Date(formDueDate).toISOString() : undefined,
				created_at: now,
				updated_at: now,
			};

			await createTask({ path: workspace.path, task: newTask });
			setIsCreateOpen(false);
			await loadTasks();
			await refreshMetadata();
		} catch (err) {
			console.error("Failed to create task:", err);
			logError(err, { source: "tasks" });
		} finally {
			setFormSubmitting(false);
		}
	};

	// Submit Edit Task
	const handleEditSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!workspace?.path || !editingTask || !formTitle.trim()) return;

		try {
			setFormSubmitting(true);
			const updated: Task = {
				...editingTask,
				title: formTitle.trim(),
				description: formDescription.trim(),
				status: formStatus,
				priority: formPriority,
				due_date: formDueDate ? new Date(formDueDate).toISOString() : undefined,
				updated_at: new Date().toISOString(),
			};

			await updateTask({ path: workspace.path, task: updated });
			setEditingTask(null);
			await loadTasks();
			await refreshMetadata();
		} catch (err) {
			console.error("Failed to update task:", err);
			logError(err, { source: "tasks" });
		} finally {
			setFormSubmitting(false);
		}
	};

	// Toggle Quick Status (Cycle: todo -> in_progress -> done -> todo)
	const handleToggleStatus = async (task: Task) => {
		if (!workspace?.path) return;
		const nextStatus: Record<TaskStatus, TaskStatus> = {
			todo: "in_progress",
			in_progress: "done",
			done: "todo",
		};
		const updated: Task = {
			...task,
			status: nextStatus[task.status],
			updated_at: new Date().toISOString(),
		};
		try {
			await updateTask({ path: workspace.path, task: updated });
			await loadTasks();
			await refreshMetadata();
		} catch (err) {
			console.error("Failed to toggle task status:", err);
			logError(err, { source: "tasks" });
		}
	};

	// Delete Task
	const handleDeleteTask = async () => {
		if (!workspace?.path || !deletingTaskId) return;
		try {
			await deleteTask({ path: workspace.path, id: deletingTaskId });
			setDeletingTaskId(null);
			await loadTasks();
			await refreshMetadata();
		} catch (err) {
			console.error("Failed to delete task:", err);
			logError(err, { source: "tasks" });
		}
	};

	// Filtered Tasks
	const filteredTasks = useMemo(() => {
		return tasks.filter((t) => {
			const matchesSearch =
				t.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
				t.description.toLowerCase().includes(searchQuery.toLowerCase());
			const matchesStatus =
				statusFilter === "all" || t.status === statusFilter;
			const matchesPriority =
				priorityFilter === "all" || t.priority === priorityFilter;
			return matchesSearch && matchesStatus && matchesPriority;
		});
	}, [tasks, searchQuery, statusFilter, priorityFilter]);

	// Stats Computations
	const stats = useMemo(() => {
		const total = tasks.length;
		const todo = tasks.filter((t) => t.status === "todo").length;
		const inProgress = tasks.filter((t) => t.status === "in_progress").length;
		const done = tasks.filter((t) => t.status === "done").length;
		return { total, todo, inProgress, done };
	}, [tasks]);

	return (
		<div className="space-y-6">
			{/* Header & Controls */}
			<div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
				<div>
					<h1 className="text-2xl font-bold tracking-tight">Tasks</h1>
					<p className="mt-1 text-sm text-muted-foreground">
						Organize, track, and manage your workspace priorities.
					</p>
				</div>
				<Button
					onPress={handleOpenCreate}
					className="w-fit gap-2 shadow-sm transition-transform active:scale-95"
				>
					<Plus className="size-4" />
					New Task
				</Button>
			</div>

			{/* Metric Stat Cards */}
			<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
				<Card className="border-border/60 bg-card/40 backdrop-blur-xs">
					<CardContent className="flex items-center justify-between p-4">
						<div>
							<p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
								Total Tasks
							</p>
							<p className="mt-1 text-2xl font-bold">{stats.total}</p>
						</div>
						<ListTodo className="size-6 text-muted-foreground/60" />
					</CardContent>
				</Card>

				<Card className="border-border/60 bg-card/40 backdrop-blur-xs">
					<CardContent className="flex items-center justify-between p-4">
						<div>
							<p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
								To Do
							</p>
							<p className="mt-1 text-2xl font-bold text-sky-400">
								{stats.todo}
							</p>
						</div>
						<Clock className="size-6 text-sky-400/60" />
					</CardContent>
				</Card>

				<Card className="border-border/60 bg-card/40 backdrop-blur-xs">
					<CardContent className="flex items-center justify-between p-4">
						<div>
							<p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
								In Progress
							</p>
							<p className="mt-1 text-2xl font-bold text-amber-400">
								{stats.inProgress}
							</p>
						</div>
						<AlertCircle className="size-6 text-amber-400/60" />
					</CardContent>
				</Card>

				<Card className="border-border/60 bg-card/40 backdrop-blur-xs">
					<CardContent className="flex items-center justify-between p-4">
						<div>
							<p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
								Completed
							</p>
							<p className="mt-1 text-2xl font-bold text-emerald-400">
								{stats.done}
							</p>
						</div>
						<CheckCircle2 className="size-6 text-emerald-400/60" />
					</CardContent>
				</Card>
			</div>

			{/* Search and Filters Bar */}
			<div className="flex flex-col gap-3 rounded-lg border bg-muted/20 p-3 sm:flex-row sm:items-center">
				<div className="relative flex-1">
					<Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
					<Input
						value={searchQuery}
						onChange={(e) => setSearchQuery(e.target.value)}
						placeholder="Search tasks..."
						className="pl-9 bg-background/60"
					/>
				</div>

				<div className="flex flex-wrap items-center gap-2">
					<div className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
						<Filter className="size-3.5" />
						Status:
					</div>
					{(["all", "todo", "in_progress", "done"] as const).map((s) => (
						<button
							key={s}
							type="button"
							onClick={() => setStatusFilter(s)}
							className={cn(
								"rounded-md px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer",
								statusFilter === s
									? "bg-primary text-primary-foreground font-semibold"
									: "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground",
							)}
						>
							{s === "all" ? "All" : STATUS_CONFIG[s].label}
						</button>
					))}

					<div className="ml-2 flex items-center gap-1 text-xs font-medium text-muted-foreground">
						Priority:
					</div>
					{(["all", "high", "medium", "low"] as const).map((p) => (
						<button
							key={p}
							type="button"
							onClick={() => setPriorityFilter(p)}
							className={cn(
								"rounded-md px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer",
								priorityFilter === p
									? "bg-primary text-primary-foreground font-semibold"
									: "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground",
							)}
						>
							{p === "all" ? "All" : PRIORITY_CONFIG[p].label}
						</button>
					))}
				</div>
			</div>

			{/* Tasks List */}
			{loading ? (
				<div className="flex h-48 items-center justify-center">
					<p className="text-xs uppercase tracking-widest text-muted-foreground animate-pulse">
						Loading tasks from SQLite…
					</p>
				</div>
			) : filteredTasks.length === 0 ? (
				<div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border/80 p-12 text-center bg-card/10">
					<div className="flex size-12 items-center justify-center rounded-full bg-muted/60">
						<Sparkles className="size-6 text-muted-foreground" />
					</div>
					<h3 className="mt-4 text-base font-semibold">No tasks found</h3>
					<p className="mt-1 text-sm text-muted-foreground max-w-sm">
						{searchQuery || statusFilter !== "all" || priorityFilter !== "all"
							? "No tasks match your current search or active filters."
							: "You have no tasks created yet. Create one to begin tracking."}
					</p>
					{searchQuery || statusFilter !== "all" || priorityFilter !== "all" ? (
						<Button
							variant="outline"
							size="sm"
							className="mt-4"
							onPress={() => {
								setSearchQuery("");
								setStatusFilter("all");
								setPriorityFilter("all");
							}}
						>
							Clear Filters
						</Button>
					) : (
						<Button
							size="sm"
							className="mt-4 gap-1.5"
							onPress={handleOpenCreate}
						>
							<Plus className="size-4" />
							Create Task
						</Button>
					)}
				</div>
			) : (
				<div className="grid gap-2">
					{filteredTasks.map((task) => {
						const statusConf = STATUS_CONFIG[task.status];
						const priorityConf = PRIORITY_CONFIG[task.priority];
						const StatusIcon = statusConf.icon;

						return (
							<div
								key={task.id}
								className={cn(
									"group flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg border bg-card p-4 transition-all hover:border-primary/50 hover:shadow-xs",
									task.status === "done" && "opacity-75 bg-muted/10",
								)}
							>
								{/* Left: Checkmark & Title/Description */}
								<div className="flex items-start gap-3 min-w-0">
									<button
										type="button"
										onClick={() => handleToggleStatus(task)}
										title="Click to cycle status (To Do -> In Progress -> Done)"
										className={cn(
											"mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors cursor-pointer",
											task.status === "done"
												? "border-emerald-500 bg-emerald-500/20 text-emerald-400"
												: task.status === "in_progress"
													? "border-amber-500 bg-amber-500/20 text-amber-400"
													: "border-muted-foreground/40 hover:border-primary",
										)}
									>
										<StatusIcon className="size-3.5" />
									</button>

									<div className="min-w-0 flex-1">
										<div className="flex items-center gap-2 flex-wrap">
											<h4
												className={cn(
													"font-medium text-sm text-foreground",
													task.status === "done" &&
														"line-through text-muted-foreground",
												)}
											>
												{task.title}
											</h4>
											<span
												className={cn(
													"inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
													priorityConf.color,
													priorityConf.bg,
													priorityConf.border,
												)}
											>
												{priorityConf.label}
											</span>
											<span
												className={cn(
													"inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground bg-muted/30",
													statusConf.border,
												)}
											>
												{statusConf.label}
											</span>
										</div>

										{task.description && (
											<p className="mt-1 text-xs text-muted-foreground line-clamp-2">
												{task.description}
											</p>
										)}

										{task.due_date && (
											<div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
												<Calendar className="size-3 text-muted-foreground/70" />
												<span>
													Due {new Date(task.due_date).toLocaleDateString()}
												</span>
											</div>
										)}
									</div>
								</div>

								{/* Right: Actions */}
								<div className="flex items-center gap-1 sm:self-center self-end">
									<Button
										variant="ghost"
										size="icon-xs"
										onPress={() => handleOpenEdit(task)}
										aria-label="Edit Task"
									>
										<Pencil className="size-3.5 text-muted-foreground hover:text-foreground" />
									</Button>
									<Button
										variant="ghost"
										size="icon-xs"
										onPress={() => setDeletingTaskId(task.id)}
										aria-label="Delete Task"
									>
										<Trash2 className="size-3.5 text-muted-foreground hover:text-destructive" />
									</Button>
								</div>
							</div>
						);
					})}
				</div>
			)}

			{/* Create Task Modal */}
			{isCreateOpen && (
				<Dialog
					isOpen={isCreateOpen}
					onOpenChange={setIsCreateOpen}
					className="max-w-lg"
				>
					<form onSubmit={handleCreateSubmit} className="space-y-4">
						<DialogHeader>
							<DialogTitle>Create New Task</DialogTitle>
							<DialogDescription>
								Add a structured task stored directly in the workspace SQLite
								database.
							</DialogDescription>
						</DialogHeader>

						<div className="space-y-3">
							<div>
								<Label htmlFor="create-title">Title *</Label>
								<Input
									id="create-title"
									required
									value={formTitle}
									onChange={(e) => setFormTitle(e.target.value)}
									placeholder="e.g. Implement WebRTC signaling protocol"
									className="mt-1"
									autoFocus
								/>
							</div>

							<div>
								<Label htmlFor="create-desc">Description</Label>
								<Textarea
									id="create-desc"
									value={formDescription}
									onChange={(e) => setFormDescription(e.target.value)}
									placeholder="Provide extra details, acceptance criteria, or context..."
									rows={3}
									className="mt-1"
								/>
							</div>

							<div className="grid grid-cols-2 gap-3">
								<div>
									<Label htmlFor="create-status">Status</Label>
									<select
										id="create-status"
										value={formStatus}
										onChange={(e) =>
											setFormStatus(e.target.value as TaskStatus)
										}
										className="mt-1 flex h-10 w-full rounded-none border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring"
									>
										<option value="todo">To Do</option>
										<option value="in_progress">In Progress</option>
										<option value="done">Done</option>
									</select>
								</div>

								<div>
									<Label htmlFor="create-priority">Priority</Label>
									<select
										id="create-priority"
										value={formPriority}
										onChange={(e) =>
											setFormPriority(e.target.value as TaskPriority)
										}
										className="mt-1 flex h-10 w-full rounded-none border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring"
									>
										<option value="low">Low</option>
										<option value="medium">Medium</option>
										<option value="high">High</option>
									</select>
								</div>
							</div>

							<div>
								<Label htmlFor="create-due">Due Date</Label>
								<Input
									id="create-due"
									type="date"
									value={formDueDate}
									onChange={(e) => setFormDueDate(e.target.value)}
									className="mt-1"
								/>
							</div>
						</div>

						<DialogFooter>
							<Button
								type="button"
								variant="outline"
								onPress={() => setIsCreateOpen(false)}
								isDisabled={formSubmitting}
							>
								Cancel
							</Button>
							<Button
								type="submit"
								isDisabled={formSubmitting || !formTitle.trim()}
							>
								{formSubmitting ? "Creating…" : "Create Task"}
							</Button>
						</DialogFooter>
					</form>
				</Dialog>
			)}

			{/* Edit Task Modal */}
			{editingTask && (
				<Dialog
					isOpen={!!editingTask}
					onOpenChange={(open) => !open && setEditingTask(null)}
					className="max-w-lg"
				>
					<form onSubmit={handleEditSubmit} className="space-y-4">
						<DialogHeader>
							<DialogTitle>Edit Task</DialogTitle>
							<DialogDescription>
								Update task details in the workspace SQLite database.
							</DialogDescription>
						</DialogHeader>

						<div className="space-y-3">
							<div>
								<Label htmlFor="edit-title">Title *</Label>
								<Input
									id="edit-title"
									required
									value={formTitle}
									onChange={(e) => setFormTitle(e.target.value)}
									className="mt-1"
									autoFocus
								/>
							</div>

							<div>
								<Label htmlFor="edit-desc">Description</Label>
								<Textarea
									id="edit-desc"
									value={formDescription}
									onChange={(e) => setFormDescription(e.target.value)}
									rows={3}
									className="mt-1"
								/>
							</div>

							<div className="grid grid-cols-2 gap-3">
								<div>
									<Label htmlFor="edit-status">Status</Label>
									<select
										id="edit-status"
										value={formStatus}
										onChange={(e) =>
											setFormStatus(e.target.value as TaskStatus)
										}
										className="mt-1 flex h-10 w-full rounded-none border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring"
									>
										<option value="todo">To Do</option>
										<option value="in_progress">In Progress</option>
										<option value="done">Done</option>
									</select>
								</div>

								<div>
									<Label htmlFor="edit-priority">Priority</Label>
									<select
										id="edit-priority"
										value={formPriority}
										onChange={(e) =>
											setFormPriority(e.target.value as TaskPriority)
										}
										className="mt-1 flex h-10 w-full rounded-none border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring"
									>
										<option value="low">Low</option>
										<option value="medium">Medium</option>
										<option value="high">High</option>
									</select>
								</div>
							</div>

							<div>
								<Label htmlFor="edit-due">Due Date</Label>
								<Input
									id="edit-due"
									type="date"
									value={formDueDate}
									onChange={(e) => setFormDueDate(e.target.value)}
									className="mt-1"
								/>
							</div>
						</div>

						<DialogFooter>
							<Button
								type="button"
								variant="outline"
								onPress={() => setEditingTask(null)}
								isDisabled={formSubmitting}
							>
								Cancel
							</Button>
							<Button
								type="submit"
								isDisabled={formSubmitting || !formTitle.trim()}
							>
								{formSubmitting ? "Saving…" : "Save Changes"}
							</Button>
						</DialogFooter>
					</form>
				</Dialog>
			)}

			{/* Delete Confirmation Modal */}
			{deletingTaskId && (
				<Dialog
					isOpen={!!deletingTaskId}
					onOpenChange={(open) => !open && setDeletingTaskId(null)}
				>
					<div className="space-y-4">
						<DialogHeader>
							<DialogTitle>Delete Task</DialogTitle>
							<DialogDescription>
								Are you sure you want to delete this task? This action cannot be
								undone.
							</DialogDescription>
						</DialogHeader>

						<DialogFooter>
							<Button
								variant="outline"
								onPress={() => setDeletingTaskId(null)}
							>
								Cancel
							</Button>
							<Button variant="destructive" onPress={handleDeleteTask}>
								Delete Task
							</Button>
						</DialogFooter>
					</div>
				</Dialog>
			)}
		</div>
	);
}
