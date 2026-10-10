import { useCallback, useEffect, useMemo, useState } from "react";
import {
	AlertCircle,
	AlertTriangle,
	CalendarDays,
	CheckCircle2,
	Clock,
	Filter,
	List,
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
import { DateField } from "@/components/ui/date-field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DueBadge, TagChip, TagInput } from "@/components/elements/PlanningFields";
import TaskCalendar from "@/components/elements/TaskCalendar";
import { collectTags } from "@/lib/planning";

import { useErrorLog } from "@/hooks/useErrorLog";
import { useOpenParam } from "@/hooks/useOpenParam";
import { createTask, deleteTask, eraseRecordForGood, getTasks, resolveTaskConflict, updateTask } from "@/lib/tauri";
import EraseOption from "@/components/elements/EraseOption";
import ConflictPanel from "@/components/elements/ConflictPanel";
import RuleFlag from "@/components/elements/RuleFlag";
import DraftsButton from "@/components/dialogs/workspace/DraftsDialog";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/store/workspace/WorkspaceContext";
import { useP2P, useIsViewer } from "@/store/p2p/P2PContext";
import { useReportItem } from "@/hooks/usePresence";
import PresenceDots from "@/components/elements/PresenceDots";import type { Task, TaskPriority, TaskStatus } from "@/types/workspace";
import Loading from "@/components/Loading";
import { itemTarget } from "@/lib/insights";
import Comments from "@/components/elements/Comments";
import NoteLinks from "@/components/elements/NoteLinks";
import { myName } from "@/lib/p2p/selfName";
import type { Comment } from "@/types/workspace";

// ────────────────────────────
// Priority & Status Styling Helpers
// ────────────────────────────

const PRIORITY_CONFIG: Record<
	TaskPriority,
	{ label: string; color: string; bg: string; border: string }
> = {
	low: {
		label: "Low",
		color: "text-info",
		bg: "bg-info/10",
		border: "border-info/20",
	},
	medium: {
		label: "Medium",
		color: "text-warning",
		bg: "bg-warning/10",
		border: "border-warning/20",
	},
	high: {
		label: "High",
		color: "text-destructive",
		bg: "bg-destructive/10",
		border: "border-destructive/20",
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
		color: "text-warning",
		border: "border-warning/30",
	},
	done: {
		label: "Done",
		icon: CheckCircle2,
		color: "text-success",
		border: "border-success/30",
	},
};

export default function WorkspaceTasks() {
	const { workspace, metadata, refreshMetadata, addActivityEvent } = useWorkspace();
	const members = metadata?.members.members ?? [];
	const memberName = (id: string) => members.find((m) => m.id === id)?.name ?? "a removed member";
	const { dataVersion, publishDataChange, viewersAt } = useP2P();
	const isViewer = useIsViewer();
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
	useReportItem(editingTask?.id ?? null);
	const [deletingTaskId, setDeletingTaskId] = useState<string | null>(null);
	const [eraseTask, setEraseTask] = useState(false);

	// Form State for Create/Edit
	const [formTitle, setFormTitle] = useState("");
	const [formDescription, setFormDescription] = useState("");
	const [formStatus, setFormStatus] = useState<TaskStatus>("todo");
	const [formPriority, setFormPriority] = useState<TaskPriority>("medium");
	const [formDueDate, setFormDueDate] = useState("");
	const [formTags, setFormTags] = useState<string[]>([]);
	const [formAssignee, setFormAssignee] = useState("");
	const [tagFilter, setTagFilter] = useState<string | null>(null);
	const [view, setView] = useState<"list" | "calendar">("list");
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

	// Reload silently when a collaborator adds, edits or removes a task
	useEffect(() => {
		if (!dataVersion || !workspace?.path) return;
		getTasks(workspace.path).then(setTasks).catch(console.error);
	}, [dataVersion, workspace?.path]);

	// Open Create Modal
	const handleOpenCreate = () => {
		setFormTitle("");
		setFormDescription("");
		setFormStatus("todo");
		setFormPriority("medium");
		setFormDueDate("");
		setFormTags([]);
		setFormAssignee("");
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
		setFormTags(task.tags ?? []);
		setFormAssignee(task.assignee_id ?? "");
	};

	// Deep link from workspace search
	useOpenParam((id) => {
		const task = tasks.find((t) => t.id === id);
		if (task) handleOpenEdit(task);
	}, !loading);

	// Submit Create Task
	const handleCreateSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (isViewer || !workspace?.path || !formTitle.trim()) return;

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
				assignee_id: formAssignee || undefined,
				tags: formTags,
				created_at: now,
				updated_at: now,
			};

			await createTask({ path: workspace.path, task: newTask });
			publishDataChange({ entity: "task", op: "upsert", task: newTask });
			await addActivityEvent(
				"Created task",
				`Created task: ${newTask.title}`,
				itemTarget("task", newTask.id),
				"task",
			);
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
		if (isViewer || !workspace?.path || !editingTask || !formTitle.trim()) return;

		try {
			setFormSubmitting(true);
			const updated: Task = {
				...editingTask,
				title: formTitle.trim(),
				description: formDescription.trim(),
				status: formStatus,
				priority: formPriority,
				due_date: formDueDate ? new Date(formDueDate).toISOString() : undefined,
				assignee_id: formAssignee || undefined,
				tags: formTags,
				updated_at: new Date().toISOString(),
			};

			await updateTask({ path: workspace.path, task: updated, base: editingTask });
			publishDataChange({ entity: "task", op: "upsert", task: updated });
			await addActivityEvent(
				"Updated task",
				`Updated task: ${updated.title}`,
				itemTarget("task", updated.id),
				"task",
			);
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
		if (isViewer || !workspace?.path) return;
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
			publishDataChange({ entity: "task", op: "upsert", task: updated });
			await addActivityEvent(
				"Updated task status",
				`Changed "${task.title}" to ${updated.status}`,
				itemTarget("task", updated.id),
				"task",
			);
			await loadTasks();
			await refreshMetadata();
		} catch (err) {
			console.error("Failed to toggle task status:", err);
			logError(err, { source: "tasks" });
		}
	};

	const me = myName(workspace?.id, members.find((m) => m.role === "Owner")?.name);

	// What a stored value looks like on screen
	const showValue = (field: string, value: unknown): string => {
		if (value === null || value === undefined) return "";
		if (field === "assignee_id") return memberName(String(value));
		if (field === "due_date") return String(value).slice(0, 10);
		if (field === "status") return STATUS_CONFIG[value as TaskStatus]?.label ?? String(value);
		if (field === "priority") return PRIORITY_CONFIG[value as TaskPriority]?.label ?? String(value);
		return String(value);
	};

	// Two people changed the same field while apart: keep the chosen value, for everyone
	const resolveConflict = async (field: string, value: unknown) => {
		if (isViewer || !workspace?.path || !editingTask) return;
		try {
			const record = await resolveTaskConflict(workspace.path, editingTask.id, field, value);
			if (!record) return;
			publishDataChange({ entity: "task", op: "upsert", task: record });
			const fresh = await getTasks(workspace.path);
			setTasks(fresh);
			const now = fresh.find((x) => x.id === editingTask.id);
			if (!now) return;
			setEditingTask(now);
			if (field === "title") setFormTitle(now.title);
			if (field === "description") setFormDescription(now.description || "");
			if (field === "status") setFormStatus(now.status);
			if (field === "priority") setFormPriority(now.priority);
			if (field === "due_date") setFormDueDate(now.due_date ? now.due_date.slice(0, 10) : "");
			if (field === "assignee_id") setFormAssignee(now.assignee_id ?? "");
		} catch (err) {
			logError(err, { source: "tasks" });
		}
	};

	// Comments are saved and shared as soon as they are added, without waiting for Save Changes
	const saveComments = async (comments: Comment[]) => {
		if (isViewer || !workspace?.path || !editingTask) return;
		const updated: Task = { ...editingTask, comments, updated_at: new Date().toISOString() };
		try {
			await updateTask({ path: workspace.path, task: updated, base: editingTask });
			publishDataChange({ entity: "task", op: "upsert", task: updated });
			setEditingTask(updated);
			setTasks((all) => all.map((x) => (x.id === updated.id ? updated : x)));
		} catch (err) {
			logError(err, { source: "tasks" });
		}
	};

	// Delete Task
	const handleDeleteTask = async () => {
		if (isViewer || !workspace?.path || !deletingTaskId) return;
		try {
			const deleted = tasks.find((t) => t.id === deletingTaskId);
			if (eraseTask) {
				// No activity entry: it would put the title back into the history that is being erased
				await eraseRecordForGood(workspace.path, "task", deletingTaskId);
				publishDataChange({ entity: "task", op: "delete", id: deletingTaskId, erase: true });
			} else {
				await deleteTask({ path: workspace.path, id: deletingTaskId });
				publishDataChange({ entity: "task", op: "delete", id: deletingTaskId });
				await addActivityEvent(
					"Deleted task",
					`Deleted task: ${deleted?.title || "Task"}`,
					itemTarget("task", deletingTaskId),
					"task",
				);
			}
			setEraseTask(false);
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
			const matchesTag = !tagFilter || (t.tags ?? []).includes(tagFilter);
			return matchesSearch && matchesStatus && matchesPriority && matchesTag;
		});
	}, [tasks, searchQuery, statusFilter, priorityFilter, tagFilter]);

	const allTags = useMemo(() => collectTags(tasks), [tasks]);

	// Stats Computations
	const stats = useMemo(() => {
		const total = tasks.length;
		const todo = tasks.filter((t) => t.status === "todo").length;
		const inProgress = tasks.filter((t) => t.status === "in_progress").length;
		const done = tasks.filter((t) => t.status === "done").length;
		return { total, todo, inProgress, done };
	}, [tasks]);

	// Assignee and tags, shared by the create and edit dialogs
	const renderExtras = (prefix: string) => (
		<>
			<div>
				<Label htmlFor={`${prefix}-assignee`}>Assignee</Label>
				<select
					id={`${prefix}-assignee`}
					value={formAssignee}
					onChange={(e) => setFormAssignee(e.target.value)}
					className="mt-1 flex h-10 w-full rounded-none border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring"
				>
					<option value="">Unassigned</option>
					{members.map((m) => (
						<option key={m.id} value={m.id}>
							{m.name}
						</option>
					))}
				</select>
			</div>
			<div>
				<Label htmlFor={`${prefix}-tags`}>Tags</Label>
				<TagInput id={`${prefix}-tags`} value={formTags} onChange={setFormTags} suggestions={allTags} />
			</div>
		</>
	);

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
				{!isViewer && (
					<Button
						onPress={handleOpenCreate}
						className="w-fit gap-2 shadow-sm transition-transform active:scale-95"
					>
						<Plus className="size-4" />
						New Task
					</Button>
				)}
			</div>

			{/* Metric Stat Cards */}
			<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
				<Card className="border-border/60 bg-card/40 backdrop-blur-xs">
					<CardContent className="flex items-center justify-between p-4">
						<div>
							<p className="text-xs font-semibold text-muted-foreground">
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
							<p className="text-xs font-semibold text-muted-foreground">
								To Do
							</p>
							<p className="mt-1 text-2xl font-bold text-info">
								{stats.todo}
							</p>
						</div>
						<Clock className="size-6 text-info/60" />
					</CardContent>
				</Card>

				<Card className="border-border/60 bg-card/40 backdrop-blur-xs">
					<CardContent className="flex items-center justify-between p-4">
						<div>
							<p className="text-xs font-semibold text-muted-foreground">
								In Progress
							</p>
							<p className="mt-1 text-2xl font-bold text-warning">
								{stats.inProgress}
							</p>
						</div>
						<AlertCircle className="size-6 text-warning/60" />
					</CardContent>
				</Card>

				<Card className="border-border/60 bg-card/40 backdrop-blur-xs">
					<CardContent className="flex items-center justify-between p-4">
						<div>
							<p className="text-xs font-semibold text-muted-foreground">
								Completed
							</p>
							<p className="mt-1 text-2xl font-bold text-success">
								{stats.done}
							</p>
						</div>
						<CheckCircle2 className="size-6 text-success/60" />
					</CardContent>
				</Card>
			</div>

			{/* Search and Filters Bar */}
			<div className="flex flex-col gap-3 rounded-none border bg-muted/20 p-3 sm:flex-row sm:items-center">
				<div className="relative flex-1">
					<Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
					<Input
						value={searchQuery}
						onChange={(e) => setSearchQuery(e.target.value)}
						placeholder="Search tasks..."
						className="pl-9 bg-background/60"
					/>
				</div>

				<div className="flex items-center border" role="group" aria-label="View">
					{(["list", "calendar"] as const).map((v) => (
						<button
							key={v}
							type="button"
							aria-pressed={view === v}
							onClick={() => setView(v)}
							className={cn(
								"flex cursor-pointer items-center gap-1 px-2.5 py-1 text-xs font-medium transition-colors",
								view === v
									? "bg-primary text-primary-foreground"
									: "bg-muted text-muted-foreground hover:text-foreground",
							)}
						>
							{v === "list" ? <List className="size-3.5" /> : <CalendarDays className="size-3.5" />}
							{v === "list" ? "List" : "Calendar"}
						</button>
					))}
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
								"rounded-none px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer",
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
								"rounded-none px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer",
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

			{allTags.length > 0 && (
				<div className="flex flex-wrap items-center gap-1.5">
					<span className="text-xs font-medium text-muted-foreground">Tags:</span>
					{allTags.map((tag) => (
						<TagChip
							key={tag}
							tag={tag}
							active={tagFilter === tag}
							onClick={() => setTagFilter(tagFilter === tag ? null : tag)}
						/>
					))}
				</div>
			)}

			{/* Tasks List */}
			{loading ? (
				<Loading className="h-48" />
			) : view === "calendar" ? (
				<TaskCalendar tasks={filteredTasks} onOpen={handleOpenEdit} />
			) : filteredTasks.length === 0 ? (
				<div className="flex flex-col items-center justify-center rounded-none border border-dashed border-border/80 p-12 text-center bg-card/10">
					<div className="flex size-12 items-center justify-center rounded-none bg-muted/60">
						<Sparkles className="size-6 text-muted-foreground" />
					</div>
					<h3 className="mt-4 text-base font-semibold">No tasks found</h3>
					<p className="mt-1 text-sm text-muted-foreground max-w-sm">
						{searchQuery || statusFilter !== "all" || priorityFilter !== "all" || tagFilter
							? "No tasks match your current search or active filters."
							: "You have no tasks created yet. Create one to begin tracking."}
					</p>
					{searchQuery || statusFilter !== "all" || priorityFilter !== "all" || tagFilter ? (
						<Button
							variant="outline"
							size="sm"
							className="mt-4"
							onPress={() => {
								setSearchQuery("");
								setStatusFilter("all");
								setPriorityFilter("all");
								setTagFilter(null);
							}}
						>
							Clear Filters
						</Button>
					) : (
						!isViewer && (
							<Button
								size="sm"
								className="mt-4 gap-1.5"
								onPress={handleOpenCreate}
							>
								<Plus className="size-4" />
								Create Task
							</Button>
						)
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
									"group flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-none border bg-card p-4 transition-all hover:border-primary/50 hover:shadow-xs",
									task.status === "done" && "opacity-75 bg-muted/10",
								)}
							>
								{/* Left: Checkmark & Title/Description */}
								<div className="flex items-start gap-3 min-w-0">
									<button
										type="button"
										onClick={() => handleToggleStatus(task)}
										disabled={isViewer}
										title={
											isViewer
												? undefined
												: "Click to cycle status (To Do -> In Progress -> Done)"
										}
										className={cn(
											"mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-none border transition-colors",
											isViewer ? "cursor-default" : "cursor-pointer",
											task.status === "done"
												? "border-success bg-success/20 text-success"
												: task.status === "in_progress"
													? "border-warning bg-warning/20 text-warning"
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
											<PresenceDots names={viewersAt("tasks", task.id)} doing="editing this task" />
											{(task.conflicts?.length ?? 0) > 0 && (
												<span title="Two people changed this at the same time" className="text-warning">
													<AlertTriangle className="size-3.5" aria-label="Has a change to sort out" />
												</span>
											)}
											<span
												className={cn(
													"inline-flex items-center rounded-none border px-2 py-0.5 text-xs font-semibold ",
													priorityConf.color,
													priorityConf.bg,
													priorityConf.border,
												)}
											>
												{priorityConf.label}
											</span>
											<span
												className={cn(
													"inline-flex items-center rounded-none border px-2 py-0.5 text-xs font-semibold text-muted-foreground bg-muted/30",
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

										{(task.due_date || task.assignee_id || (task.tags ?? []).length > 0 || (task.violations ?? []).length > 0) && (
											<div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
												<RuleFlag violations={task.violations} />
												<DueBadge due={task.due_date} done={task.status === "done"} />
												{task.assignee_id && <span>Assigned to {memberName(task.assignee_id)}</span>}
												{(task.tags ?? []).map((tag) => (
													<TagChip
														key={tag}
														tag={tag}
														active={tagFilter === tag}
														onClick={() => setTagFilter(tagFilter === tag ? null : tag)}
													/>
												))}
											</div>
										)}
									</div>
								</div>

								{/* Right: Actions */}
								{!isViewer && (
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
								)}
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
								Add a task to this workspace.
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
									placeholder="e.g. Prepare the project proposal"
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
								<DateField id="create-due" value={formDueDate} onChange={setFormDueDate} className="mt-1" />
							</div>
							{renderExtras("create")}
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
								Update this task's details.
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
								<NoteLinks text={formDescription} />
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
								<DateField id="edit-due" value={formDueDate} onChange={setFormDueDate} className="mt-1" />
							</div>
							{renderExtras("edit")}
						</div>

						<ConflictPanel conflicts={editingTask.conflicts ?? []} violations={editingTask.violations} show={showValue} canChoose={!isViewer} onChoose={resolveConflict} />
						{!isViewer && workspace && <DraftsButton workspacePath={workspace.path} entity="task" record={editingTask} members={members} onMerged={() => setEditingTask(null)} />}

						<Comments
							comments={editingTask.comments ?? []}
							me={me}
							memberNames={members.map((m) => m.name)}
							canComment={!isViewer}
							onChange={saveComments}
						/>

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
					onOpenChange={(open) => {
						if (!open) {
							setDeletingTaskId(null);
							setEraseTask(false);
						}
					}}
				>
					<div className="space-y-4">
						<DialogHeader>
							<DialogTitle>Delete Task</DialogTitle>
							<DialogDescription>
								Are you sure you want to delete this task? This action cannot be
								undone.
							</DialogDescription>
						</DialogHeader>
						<EraseOption checked={eraseTask} onChange={setEraseTask} what="the task" />

						<DialogFooter>
							<Button
								variant="outline"
								onPress={() => {
									setDeletingTaskId(null);
									setEraseTask(false);
								}}
							>
								Cancel
							</Button>
							<Button variant="destructive" onPress={handleDeleteTask}>
								{eraseTask ? "Erase Task" : "Delete Task"}
							</Button>
						</DialogFooter>
					</div>
				</Dialog>
			)}
		</div>
	);
}
