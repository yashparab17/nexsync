// Drafts of one task or card: change a private copy, review what merging it would do (including the fields somebody else
// changed too), then merge it. Merging is the same field-by-field merge a collaborator's copy gets, so what only one
// side changed is kept, and what both changed is kept as a conflict for a person to choose.

import { useCallback, useEffect, useState } from "react";
import { FilePen, GitMerge, Trash2 } from "lucide-react";

import { fieldName } from "@/components/elements/ConflictPanel";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DateField } from "@/components/ui/date-field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { discardDraft, getDraft, listDrafts, mergeDraft, previewDraft, saveDraft, startDraft } from "@/lib/tauri";
import { errorText } from "@/lib/utils";
import { useNotifications } from "@/store/notifications/NotificationContext";
import { useP2P } from "@/store/p2p/P2PContext";
import type { Draft, DraftPreview, KanbanCard, Member, Task, TaskPriority, TaskStatus } from "@/types/workspace";

type Entity = "task" | "card";
type Row = Task | KanbanCard;

interface DraftsButtonProps {
	workspacePath: string;
	entity: Entity;
	record: { id: string; title: string };
	members: Member[];
	// Called after a draft was merged, so the editor showing the old values can close
	onMerged: () => void;
}

const SELECT =
	"mt-1 flex h-10 w-full rounded-none border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring";

export default function DraftsButton({ workspacePath, entity, record, members, onMerged }: DraftsButtonProps) {
	const [open, setOpen] = useState(false);
	return (
		<>
			<Button type="button" variant="outline" size="sm" onPress={() => setOpen(true)} className="gap-1.5">
				<FilePen className="size-3.5" />
				Drafts
			</Button>
			{open && <DraftsDialog workspacePath={workspacePath} entity={entity} record={record} members={members} onMerged={onMerged} onClose={() => setOpen(false)} />}
		</>
	);
}

function DraftsDialog({ workspacePath, entity, record, members, onMerged, onClose }: DraftsButtonProps & { onClose: () => void }) {
	const { publishDataChange, refreshData } = useP2P();
	const { notify } = useNotifications();
	const [drafts, setDrafts] = useState<Draft[]>([]);
	const [name, setName] = useState("");
	const [active, setActive] = useState<Draft | null>(null);
	const [form, setForm] = useState<Row | null>(null);
	const [preview, setPreview] = useState<DraftPreview | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const memberName = (id: string) => members.find((m) => m.id === id)?.name ?? "a removed member";

	const refresh = useCallback(async () => {
		try {
			setDrafts(await listDrafts(workspacePath, entity, record.id));
		} catch (err) {
			setError(errorText(err, "Could not load the drafts."));
		}
	}, [workspacePath, entity, record.id]);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	const run = async (work: () => Promise<void>) => {
		setBusy(true);
		setError(null);
		try {
			await work();
		} catch (err) {
			setError(errorText(err, "Something went wrong."));
		} finally {
			setBusy(false);
		}
	};

	const openDraft = (d: Draft) =>
		run(async () => {
			setForm(await getDraft<Row>(workspacePath, d.id));
			setActive(d);
			setPreview(null);
		});

	const create = () =>
		run(async () => {
			const d = await startDraft(workspacePath, entity, record.id, name);
			setName("");
			setForm(await getDraft<Row>(workspacePath, d.id));
			setActive(d);
			setPreview(null);
			await refresh();
		});

	const save = () =>
		run(async () => {
			if (active && form) setForm(await saveDraft(workspacePath, active.id, form));
		});

	const review = () =>
		run(async () => {
			if (!active || !form) return;
			setForm(await saveDraft(workspacePath, active.id, form));
			setPreview(await previewDraft(workspacePath, active.id));
		});

	const merge = () =>
		run(async () => {
			if (!active) return;
			const merged = await mergeDraft<Row>(workspacePath, active.id);
			if (entity === "task") publishDataChange({ entity: "task", op: "upsert", task: merged as Task });
			else publishDataChange({ entity: "card", op: "upsert", card: merged as KanbanCard });
			refreshData();
			const clashes = preview?.collisions.length ?? 0;
			notify(`Merged the draft "${active.name}" into "${record.title}".${clashes > 0 ? ` ${clashes === 1 ? "One field needs" : `${clashes} fields need`} a choice.` : ""}`);
			onMerged();
			onClose();
		});

	const discard = (d: Draft) =>
		run(async () => {
			await discardDraft(workspacePath, d.id);
			if (active?.id === d.id) {
				setActive(null);
				setForm(null);
				setPreview(null);
			}
			await refresh();
		});

	const patch = (changes: Partial<Task & KanbanCard>) => setForm((prev) => (prev ? ({ ...prev, ...changes } as Row) : prev));

	const show = (path: string, value: unknown) => {
		if (value === undefined || value === null || value === "") return "nothing";
		if (path === "assignee_id") return memberName(String(value));
		return typeof value === "string" ? value : JSON.stringify(value);
	};
	const label = (path: string) => (path.startsWith("tags/") ? `Tag "${path.slice(5)}"` : path.startsWith("comments/") ? "A comment" : path.startsWith("checklist/") ? "A checklist item" : fieldName(path));

	return (
		<Dialog isOpen onOpenChange={(isOpen) => !isOpen && onClose()} className="sm:max-w-2xl">
			<div className="flex max-h-[75vh] min-h-0 flex-col gap-4 overflow-y-auto">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<FilePen className="size-4" />
						Drafts of "{record.title}"
					</DialogTitle>
					<DialogDescription>
						A draft is a private copy to change without touching the real {entity}. When it is ready, review what merging it would do, then merge it. Anything somebody else changed in the meantime is kept,
						and a field you both changed is left for you to choose.
					</DialogDescription>
				</DialogHeader>

				{error && (
					<p role="alert" className="border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
						{error}
					</p>
				)}

				{!active || !form ? (
					<>
						<form
							className="flex gap-2"
							onSubmit={(e) => {
								e.preventDefault();
								void create();
							}}
						>
							<Input aria-label="Draft name" placeholder="Name the draft, for example Reword for the client" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
							<Button type="submit" isDisabled={busy || !name.trim()}>
								Start a draft
							</Button>
						</form>
						{drafts.length === 0 ? (
							<p className="text-sm text-muted-foreground">No drafts yet.</p>
						) : (
							<ul className="divide-y divide-border/60 border">
								{drafts.map((d) => (
									<li key={d.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
										<div className="min-w-0">
											<p className="truncate font-medium">{d.name}</p>
											<p className="text-xs text-muted-foreground">Started {new Date(d.created_at).toLocaleString()}</p>
										</div>
										<div className="flex gap-2">
											<Button size="sm" variant="outline" isDisabled={busy} onPress={() => void openDraft(d)}>
												Open
											</Button>
											<Button size="sm" variant="ghost" isDisabled={busy} onPress={() => void discard(d)} aria-label={`Discard ${d.name}`}>
												<Trash2 className="size-3.5" />
											</Button>
										</div>
									</li>
								))}
							</ul>
						)}
					</>
				) : preview ? (
					<div className="space-y-3">
						<p className="text-sm font-semibold">Merging "{active.name}" would change:</p>
						{preview.deleted ? (
							<p className="text-sm text-muted-foreground">The {entity} was deleted, so there is nothing to merge into.</p>
						) : (
							<>
								{preview.changes.length === 0 && <p className="text-sm text-muted-foreground">Nothing. The draft matches the {entity} as it is now.</p>}
								<ul className="space-y-1.5">
									{preview.changes.map((c) => (
										<li key={c.path} className="border px-3 py-2 text-sm">
											<span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label(c.path)}</span>
											<p className="break-words">
												<span className="text-muted-foreground line-through">{show(c.path, c.live)}</span> → {show(c.path, c.draft)}
											</p>
										</li>
									))}
								</ul>
								{preview.collisions.length > 0 && (
									<div className="space-y-2 border border-amber-500/40 bg-amber-500/10 p-3">
										<p className="text-sm font-semibold text-amber-500">Somebody else changed these too</p>
										<ul className="space-y-1 text-sm">
											{preview.collisions.map((c) => (
												<li key={c.field}>
													<span className="font-medium">{fieldName(c.field)}</span>: {c.options.map((o) => `${show(c.field, o.value)}${o.who ? ` (${o.who})` : ""}`).join(" or ")}
												</li>
											))}
										</ul>
										<p className="text-xs text-muted-foreground">Both are kept. After merging you will be asked which one to use.</p>
									</div>
								)}
							</>
						)}
						<div className="flex flex-wrap justify-between gap-2">
							<Button variant="ghost" isDisabled={busy} onPress={() => setPreview(null)}>
								Back to editing
							</Button>
							{!preview.deleted && (
								<Button isDisabled={busy} onPress={() => void merge()} className="gap-1.5">
									<GitMerge className="size-3.5" />
									Merge into the {entity}
								</Button>
							)}
						</div>
					</div>
				) : (
					<form
						className="space-y-3"
						onSubmit={(e) => {
							e.preventDefault();
							void review();
						}}
					>
						<p className="text-sm font-semibold">Draft: {active.name}</p>
						<div>
							<Label htmlFor="draft-title">Title</Label>
							<Input id="draft-title" value={form.title} maxLength={200} onChange={(e) => patch({ title: e.target.value })} />
						</div>
						<div>
							<Label htmlFor="draft-description">Description</Label>
							<Textarea id="draft-description" value={form.description} onChange={(e) => patch({ description: e.target.value })} />
						</div>
						{entity === "task" && (
							<div className="grid gap-3 sm:grid-cols-2">
								<div>
									<Label htmlFor="draft-status">Status</Label>
									<select id="draft-status" value={(form as Task).status} onChange={(e) => patch({ status: e.target.value as TaskStatus })} className={SELECT}>
										<option value="todo">To Do</option>
										<option value="in_progress">In Progress</option>
										<option value="done">Done</option>
									</select>
								</div>
								<div>
									<Label htmlFor="draft-priority">Priority</Label>
									<select id="draft-priority" value={(form as Task).priority} onChange={(e) => patch({ priority: e.target.value as TaskPriority })} className={SELECT}>
										<option value="low">Low</option>
										<option value="medium">Medium</option>
										<option value="high">High</option>
									</select>
								</div>
							</div>
						)}
						<div className="grid gap-3 sm:grid-cols-2">
							<div>
								<Label htmlFor="draft-due">Due date</Label>
								<DateField id="draft-due" value={form.due_date ?? ""} onChange={(v) => patch({ due_date: v || undefined })} />
							</div>
							<div>
								<Label htmlFor="draft-assignee">Assignee</Label>
								<select id="draft-assignee" value={form.assignee_id ?? ""} onChange={(e) => patch({ assignee_id: e.target.value || undefined })} className={SELECT}>
									<option value="">Unassigned</option>
									{members.map((m) => (
										<option key={m.id} value={m.id}>
											{m.name}
										</option>
									))}
								</select>
							</div>
						</div>
						<div className="flex flex-wrap justify-between gap-2">
							<Button
								type="button"
								variant="ghost"
								isDisabled={busy}
								onPress={() => {
									setActive(null);
									setForm(null);
								}}
							>
								All drafts
							</Button>
							<div className="flex gap-2">
								<Button type="button" variant="outline" isDisabled={busy} onPress={() => void save()}>
									Save draft
								</Button>
								<Button type="submit" isDisabled={busy || !form.title.trim()}>
									Review and merge
								</Button>
							</div>
						</div>
					</form>
				)}
			</div>
		</Dialog>
	);
}
