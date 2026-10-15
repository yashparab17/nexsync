import { MAX_TITLE } from "@/lib/validation";
import { useCallback, useEffect, useMemo, useState, type ElementType } from "react";
import { Plus, Trash2, AlertCircle, AlertTriangle, CalendarDays, CircleCheck as CheckCircle2, Clock, List, Pencil, } from "@/components/animate-icons";

import { EmptyState } from "@/components/layout/Page";
import Toolbar, { ToolbarTitle, ToolbarSearch, ToolbarSwitch, ToolbarTabs } from "@/components/layout/Toolbar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter, DialogHeading } from "@/components/ui/dialog";
import { DateField } from "@/components/ui/date-field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DueBadge, TagChip, TagInput } from "@/components/elements/PlanningFields";
import TaskCalendar from "@/components/elements/TaskCalendar";
import { collectTags } from "@/lib/planning";

import { useListKeys } from "@/hooks/useListKeys";
import { useErrorLog } from "@/hooks/useErrorLog";
import { useOpenParam } from "@/hooks/useOpenParam";
import { createTask, deleteTask, eraseRecordForGood, getTasks, resolveTaskConflict, updateTask } from "@/lib/tauri";
import EraseOption from "@/components/elements/EraseOption";
import CommentCount, { useThreadCounts } from "@/components/elements/CommentCount";
import ConflictPanel from "@/components/elements/ConflictPanel";
import RecordTimeline from "@/components/elements/RecordTimeline";
import FieldDiscussion from "@/components/elements/FieldDiscussion";
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
	{ label: string; icon: ElementType; color: string; border: string }
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
	const threadCounts = useThreadCounts();
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
	useListKeys(isViewer ? undefined : handleOpenCreate);

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

	// Submit Create task
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

	// Submit Edit task
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
		// Shown at once; the file write follows, and the list is read back if it fails
		setTasks((prev) => prev.map((t) => (t.id === task.id ? updated : t)));
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
			await loadTasks();
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

	// Delete task
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
					className="mt-1 flex h-10 w-full rounded-md border border-input bg-input px-3 py-2 text-sm text-foreground ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring"
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

	const filtering = searchQuery || statusFilter !== "all" || priorityFilter !== "all" || tagFilter;
	const clearFilters = () => {
		setSearchQuery("");
		setStatusFilter("all");
		setPriorityFilter("all");
		setTagFilter(null);
	};

	return (
		<div className="flex h-full min-h-0 flex-col bg-background">
			<Toolbar>
				<ToolbarTitle name="Tasks" meta={stats.total - stats.done ? `${stats.total - stats.done} open` : undefined} />
				<ToolbarTabs
					label="Status"
					value={statusFilter}
					onChange={setStatusFilter}
					tabs={[
						{ key: "all", label: "All", count: stats.total },
						{ key: "todo", label: "To do", count: stats.todo },
						{ key: "in_progress", label: "In progress", count: stats.inProgress },
						{ key: "done", label: "Done", count: stats.done },
					]}
				/>
				<span className="flex-1" />
				<ToolbarSearch label="Search tasks" placeholder="Search tasks" value={searchQuery} onChange={setSearchQuery} />
				<ToolbarSwitch
					label="Priority"
					value={priorityFilter}
					onChange={setPriorityFilter}
					options={[
						{ value: "all", label: "Any", title: "Any priority" },
						{ value: "high", label: "High", title: "High priority" },
						{ value: "medium", label: "Med", title: "Medium priority" },
						{ value: "low", label: "Low", title: "Low priority" },
					]}
				/>
				<ToolbarSwitch
					label="View"
					value={view}
					onChange={setView}
					options={[
						{ value: "list", label: <List className="size-4" />, title: "List" },
						{ value: "calendar", label: <CalendarDays className="size-4" />, title: "Calendar" },
					]}
				/>
				{!isViewer && (
					<Button size="sm" onPress={handleOpenCreate}>
						<Plus className="size-4" />
						New Task
					</Button>
				)}
			</Toolbar>

			{allTags.length > 0 && (
				<Toolbar variant="sub" className="gap-2 overflow-x-auto">
					<span className="font-mono text-[13px] text-muted-foreground">tags</span>
					{allTags.map((tag) => (
						<TagChip key={tag} tag={tag} active={tagFilter === tag} onClick={() => setTagFilter(tagFilter === tag ? null : tag)} />
					))}
				</Toolbar>
			)}

			<div className="min-h-0 flex-1 overflow-auto">
				{loading ? (
					<Loading className="h-48" />
				) : view === "calendar" ? (
					<div className="p-3">
						<TaskCalendar tasks={filteredTasks} onOpen={handleOpenEdit} />
					</div>
				) : filteredTasks.length === 0 ? (
					<EmptyState
						art={filtering ? "search" : "tasks"}
						title={filtering ? "No Matching Tasks" : "No Tasks Yet"}
						action={
							filtering ? (
								<Button variant="outline" size="sm" onPress={clearFilters}>
									Clear Filters
								</Button>
							) : (
								!isViewer && (
									<Button size="sm" onPress={handleOpenCreate}>
										<Plus className="size-4" />
										Create Task
									</Button>
								)
							)
						}
					>
						{filtering ? "Nothing matches the search or filters." : "Create one to start tracking what needs doing."}
					</EmptyState>
				) : (
					<ul className="divide-y">
						{filteredTasks.map((task) => {
							const statusConf = STATUS_CONFIG[task.status];
							const priorityConf = PRIORITY_CONFIG[task.priority];
							const StatusIcon = statusConf.icon;
							return (
								<li
									key={task.id}
									className={cn(
										"group flex items-start gap-3 border-l-2 px-3 py-3 transition-colors hover:bg-muted/40",
										task.priority === "high" ? "border-l-destructive" : task.priority === "medium" ? "border-l-warning" : "border-l-transparent",
										task.status === "done" && "opacity-60",
									)}
								>
									<button
										type="button"
										onClick={() => handleToggleStatus(task)}
										disabled={isViewer}
										aria-label={`${task.title}: ${statusConf.label}. ${isViewer ? "" : "Press to move it along."}`}
										title={isViewer ? undefined : "Move along: To do, In progress, Done"}
										className={cn(
											"mt-0.5 flex size-5 shrink-0 items-center justify-center border transition-colors",
											isViewer ? "cursor-default" : "cursor-pointer",
											task.status === "done" ? "border-success bg-success/20 text-success" : task.status === "in_progress" ? "border-warning bg-warning/20 text-warning" : "border-muted-foreground/40 hover:border-primary",
										)}
									>
										<StatusIcon className="size-3.5" />
									</button>

									<button type="button" data-nav onClick={() => handleOpenEdit(task)} className="min-w-0 flex-1 cursor-pointer text-left outline-none focus-visible:bg-muted">
										<span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
											<span className={cn("text-sm font-medium [overflow-wrap:anywhere]", task.status === "done" && "text-muted-foreground line-through")}>{task.title}</span>
											<PresenceDots names={viewersAt("tasks", task.id)} doing="editing this task" />
											<CommentCount entity="task" id={task.id} legacy={task.comments?.length ?? 0} counts={threadCounts} />
											{(task.conflicts?.length ?? 0) > 0 && (
												<span title="Two people changed this at the same time" className="text-warning">
													<AlertTriangle className="size-3.5" aria-label="Has a change to sort out" />
												</span>
											)}
										</span>
										{task.description && <span className="mt-0.5 line-clamp-2 block text-sm text-muted-foreground">{task.description}</span>}
									</button>

									<div className="flex shrink-0 flex-wrap items-center justify-end gap-x-3 gap-y-1 text-sm text-muted-foreground">
										<RuleFlag violations={task.violations} />
										{task.assignee_id && <span className="max-w-32 truncate">{memberName(task.assignee_id)}</span>}
										{(task.tags ?? []).map((tag) => (
											<TagChip key={tag} tag={tag} active={tagFilter === tag} onClick={() => setTagFilter(tagFilter === tag ? null : tag)} />
										))}
										<DueBadge due={task.due_date} done={task.status === "done"} />
										<span className={cn("font-mono text-[13px]", priorityConf.color)}>{priorityConf.label.toLowerCase()}</span>
										{!isViewer && (
											<span className="flex opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
												<Button variant="ghost" size="icon-xs" onPress={() => handleOpenEdit(task)} aria-label="Edit task">
													<Pencil className="size-3.5" />
												</Button>
												<Button variant="ghost" size="icon-xs" onPress={() => setDeletingTaskId(task.id)} aria-label="Delete task">
													<Trash2 className="size-3.5 text-destructive" />
												</Button>
											</span>
										)}
									</div>
								</li>
							);
						})}
					</ul>
				)}
			</div>

			{/* Create task Modal */}
			{isCreateOpen && (
				<Dialog
					isOpen={isCreateOpen}
					onOpenChange={setIsCreateOpen}
					className="max-w-lg"
				>
					<form onSubmit={handleCreateSubmit} className="space-y-4">
						<DialogHeading icon={<Plus className="size-6" />} title="New Task" />

						<div className="space-y-3">
							<div>
								<Label htmlFor="create-title">Title *</Label>
								<Input
									id="create-title"
									maxLength={MAX_TITLE}
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
									placeholder="Provide extra details, acceptance criteria, or context…"
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
										className="mt-1 flex h-10 w-full rounded-md border border-input bg-input px-3 py-2 text-sm text-foreground ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring"
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
										className="mt-1 flex h-10 w-full rounded-md border border-input bg-input px-3 py-2 text-sm text-foreground ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring"
									>
										<option value="low">Low</option>
										<option value="medium">Medium</option>
										<option value="high">High</option>
									</select>
								</div>
							</div>

							<div>
								<Label htmlFor="create-due">Due Date</Label>
								<DateField id="create-due" noPast value={formDueDate} onChange={setFormDueDate} className="mt-1" />
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

			{/* Edit task Modal */}
			{editingTask && (
				<Dialog
					isOpen={!!editingTask}
					onOpenChange={(open) => !open && setEditingTask(null)}
					className="max-w-lg"
				>
					<form onSubmit={handleEditSubmit} className="space-y-4">
						<DialogHeading icon={<Pencil className="size-6" />} title="Edit task" description={<>Update this task's details.</>} />

						<div className="space-y-3">
							<div>
								<Label htmlFor="edit-title">Title *</Label>
								<Input
									id="edit-title"
									maxLength={MAX_TITLE}
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
										className="mt-1 flex h-10 w-full rounded-md border border-input bg-input px-3 py-2 text-sm text-foreground ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring"
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
										className="mt-1 flex h-10 w-full rounded-md border border-input bg-input px-3 py-2 text-sm text-foreground ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring"
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

						<ConflictPanel conflicts={editingTask.conflicts ?? []} violations={editingTask.violations} show={showValue} canChoose={!isViewer} onChoose={resolveConflict} record={{ entity: "task", id: editingTask.id }} />
						{workspace && <RecordTimeline workspacePath={workspace.path} entity="task" id={editingTask.id} title={editingTask.title} show={showValue} />}
						{!isViewer && workspace && <DraftsButton workspacePath={workspace.path} entity="task" record={editingTask} members={members} onMerged={() => setEditingTask(null)} />}

						<Comments
							comments={editingTask.comments ?? []}
							me={me}
							memberNames={members.map((m) => m.name)}
							canComment={!isViewer}
							onChange={saveComments}
						/>
						<section aria-label="Discussion" className="space-y-1">
							<h3 className="text-sm font-semibold">Discussion</h3>
							<FieldDiscussion channel={`task:${editingTask.id}`} field="" canComment={!isViewer} placeholder="Say something about this task" label="Discuss this task" />
						</section>

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
						<DialogHeading icon={<Trash2 className="size-6" />} tone="danger" title="Delete Task" description={<>Are you sure you want to delete this task? This action cannot be
								undone.</>} />
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
