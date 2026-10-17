import { MAX_TITLE } from "@/lib/validation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Plus, Trash2, AlertTriangle, ArrowRight, CheckSquare, Pencil } from "@/components/animate-icons";

import { EmptyState } from "@/components/layout/Page";
import Toolbar, { ToolbarTitle } from "@/components/layout/Toolbar";
import { Button } from "@/components/ui/button";
import EraseOption from "@/components/elements/EraseOption";
import { Dialog, DialogFooter, DialogHeading } from "@/components/ui/dialog";
import { DateField } from "@/components/ui/date-field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ChecklistEditor, DueBadge, TagChip, TagInput } from "@/components/elements/PlanningFields";
import { collectTags, endPosition, planMove } from "@/lib/planning";
import { cn } from "@/lib/utils";

import { useListKeys } from "@/hooks/useListKeys";
import { useErrorLog } from "@/hooks/useErrorLog";
import { useOpenParam } from "@/hooks/useOpenParam";
import {
	createKanbanCard,
	createKanbanColumn,
	deleteKanbanCard,
	eraseRecordForGood,
	deleteKanbanColumn,
	getBoardDraft,
	getKanban,
	moveInBoardDraft,
	moveKanbanCard,
	resolveCardConflict,
	updateKanbanCard,
} from "@/lib/tauri";
import BoardDraftBar from "@/components/dialogs/workspace/BoardDraftBar";
import CommentCount, { useThreadCounts } from "@/components/elements/CommentCount";
import ConflictPanel from "@/components/elements/ConflictPanel";
import ExpiryBadge, { ExpiryControl, useExpiries } from "@/components/elements/ExpiryBadge";
import RecordTimeline from "@/components/elements/RecordTimeline";
import FieldDiscussion from "@/components/elements/FieldDiscussion";
import RuleFlag from "@/components/elements/RuleFlag";
import DraftsButton from "@/components/dialogs/workspace/DraftsDialog";
import { useWorkspace } from "@/store/workspace/WorkspaceContext";
import { useP2P, useIsViewer } from "@/store/p2p/P2PContext";
import { useReportItem } from "@/hooks/usePresence";
import PresenceDots from "@/components/elements/PresenceDots";import type { BoardDraft, ChecklistItem, KanbanCard, KanbanColumn } from "@/types/workspace";
import Loading from "@/components/Loading";
import { itemTarget } from "@/lib/insights";
import Comments from "@/components/elements/Comments";
import NoteLinks from "@/components/elements/NoteLinks";
import { myName } from "@/lib/p2p/selfName";
import type { Comment } from "@/types/workspace";

export default function KanbanPage() {
	const { workspace, metadata, refreshMetadata, addActivityEvent } = useWorkspace();
	const members = metadata?.members.members ?? [];
	const memberName = (id: string) => members.find((m) => m.id === id)?.name ?? "a removed member";
	const { dataVersion, publishDataChange, viewersAt } = useP2P();
	const threadCounts = useThreadCounts();
	const expiries = useExpiries();
	const isViewer = useIsViewer();
	const logError = useErrorLog();

	const [columns, setColumns] = useState<KanbanColumn[]>([]);
	const [loading, setLoading] = useState(true);
	// A reorganisation being tried out: the board shows the draft, and cards can be moved but nothing else changed
	const [board, setBoard] = useState<BoardDraft | null>(null);
	const canChange = !isViewer && !board;

	// Modals & Dialog States
	const [isCreateColOpen, setIsCreateColOpen] = useState(false);
	const [newColTitle, setNewColTitle] = useState("");

	const [activeColIdForNewCard, setActiveColIdForNewCard] = useState<
		string | null
	>(null);
	const [cardTitle, setCardTitle] = useState("");
	const [cardDesc, setCardDesc] = useState("");

	const [editingCard, setEditingCard] = useState<KanbanCard | null>(null);
	useReportItem(editingCard?.id ?? null);
	const [deletingCardId, setDeletingCardId] = useState<string | null>(null);
	const [eraseCard, setEraseCard] = useState(false);
	const [deletingColId, setDeletingColId] = useState<string | null>(null);

	const [submitting, setSubmitting] = useState(false);

	// Details edited in the card dialogs
	const [cardTags, setCardTags] = useState<string[]>([]);
	const [cardDue, setCardDue] = useState("");
	const [cardAssignee, setCardAssignee] = useState("");
	const [cardChecklist, setCardChecklist] = useState<ChecklistItem[]>([]);
	const [tagFilter, setTagFilter] = useState<string | null>(null);

	// Drag and drop: the card being dragged and the slot it would land in
	const [dragId, setDragId] = useState<string | null>(null);
	const [drop, setDrop] = useState<{ colId: string; index: number } | null>(null);

	const allTags = useMemo(() => collectTags(columns.flatMap((c) => c.cards)), [columns]);
	const matchesTag = (card: KanbanCard) => !tagFilter || (card.tags ?? []).includes(tagFilter);

	const openNewCard = (colId: string) => {
		setCardTags([]);
		setCardDue("");
		setCardAssignee("");
		setCardChecklist([]);
		setActiveColIdForNewCard(colId);
	};
	useListKeys(canChange && columns[0] ? () => openNewCard(columns[0].id) : undefined);

	// Fetch Kanban board data
	const loadKanban = useCallback(async () => {
		if (!workspace?.path) return;
		try {
			setLoading(true);
			const data = board ? await getBoardDraft(workspace.path, board.id) : await getKanban(workspace.path);
			setColumns(data);
		} catch (err) {
			console.error("Failed to load kanban:", err);
			logError(err, { source: "kanban" });
		} finally {
			setLoading(false);
		}
	}, [workspace?.path, board, logError]);

	useEffect(() => {
		loadKanban();
	}, [loadKanban]);

	// Reload silently when a collaborator changes the board
	useEffect(() => {
		if (!dataVersion || !workspace?.path) return;
		(board ? getBoardDraft(workspace.path, board.id) : getKanban(workspace.path)).then(setColumns).catch(console.error);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [dataVersion, workspace?.path]);

	// Create Column Submit
	const handleCreateColumnSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (isViewer || !workspace?.path || !newColTitle.trim()) return;

		try {
			setSubmitting(true);
			const newCol: KanbanColumn = {
				id: crypto.randomUUID(),
				title: newColTitle.trim(),
				position: columns.length,
				cards: [],
			};
			await createKanbanColumn({ path: workspace.path, column: newCol });
			publishDataChange({ entity: "column", op: "upsert", column: newCol });
			await addActivityEvent(
				"Created list",
				`Created list "${newCol.title}"`,
				undefined,
				"kanban",
			);
			setIsCreateColOpen(false);
			setNewColTitle("");
			await loadKanban();
			await refreshMetadata();
		} catch (err) {
			console.error("Failed to create column:", err);
			logError(err, { source: "kanban" });
		} finally {
			setSubmitting(false);
		}
	};

	// Delete column
	const handleDeleteColumn = async () => {
		if (isViewer || !workspace?.path || !deletingColId) return;
		try {
			const deletedCol = columns.find((c) => c.id === deletingColId);
			await deleteKanbanColumn({ path: workspace.path, id: deletingColId });
			publishDataChange({ entity: "column", op: "delete", id: deletingColId });
			await addActivityEvent(
				"Deleted list",
				`Deleted list "${deletedCol?.title || "List"}"`,
				undefined,
				"kanban",
			);
			setDeletingColId(null);
			await loadKanban();
			await refreshMetadata();
		} catch (err) {
			console.error("Failed to delete column:", err);
			logError(err, { source: "kanban" });
		}
	};

	// Create Card Submit
	const handleCreateCardSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (isViewer || !workspace?.path || !activeColIdForNewCard || !cardTitle.trim()) return;

		try {
			setSubmitting(true);
			const col = columns.find((c) => c.id === activeColIdForNewCard);
			const nextPos = endPosition(col?.cards ?? []);
			const now = new Date().toISOString();

			const newCard: KanbanCard = {
				id: crypto.randomUUID(),
				column_id: activeColIdForNewCard,
				title: cardTitle.trim(),
				description: cardDesc.trim(),
				position: nextPos,
				tags: cardTags,
				due_date: cardDue || undefined,
				assignee_id: cardAssignee || undefined,
				checklist: cardChecklist,
				created_at: now,
				updated_at: now,
			};

			await createKanbanCard({ path: workspace.path, card: newCard });
			publishDataChange({ entity: "card", op: "upsert", card: newCard });
			await addActivityEvent(
				"Created card",
				`Created card "${newCard.title}"`,
				itemTarget("card", newCard.id),
				"kanban",
			);
			setActiveColIdForNewCard(null);
			setCardTitle("");
			setCardDesc("");
			await loadKanban();
			await refreshMetadata();
		} catch (err) {
			console.error("Failed to create card:", err);
			logError(err, { source: "kanban" });
		} finally {
			setSubmitting(false);
		}
	};

	// Open Edit Card Modal
	const handleOpenEditCard = (card: KanbanCard) => {
		setEditingCard(card);
		setCardTitle(card.title);
		setCardDesc(card.description || "");
		setCardTags(card.tags ?? []);
		setCardDue(card.due_date ?? "");
		setCardAssignee(card.assignee_id ?? "");
		setCardChecklist(card.checklist ?? []);
	};

	// Deep link from workspace search
	useOpenParam((id) => {
		const card = columns.flatMap((c) => c.cards).find((k) => k.id === id);
		if (card) handleOpenEditCard(card);
	}, !loading);

	// Edit Card Submit
	const me = myName(workspace?.id, members.find((m) => m.role === "Owner")?.name);

	// What a stored value looks like on screen
	const showValue = (field: string, value: unknown): string => {
		if (value === null || value === undefined) return "";
		if (field === "assignee_id") return memberName(String(value));
		if (field === "column_id") return columns.find((c) => c.id === value)?.title ?? String(value);
		return String(value);
	};

	// Two people changed the same field while apart: keep the chosen value, for everyone
	const resolveConflict = async (field: string, value: unknown) => {
		if (isViewer || !workspace?.path || !editingCard) return;
		try {
			const record = await resolveCardConflict(workspace.path, editingCard.id, field, value);
			if (!record) return;
			publishDataChange({ entity: "card", op: "upsert", card: record });
			const fresh = await getKanban(workspace.path);
			setColumns(fresh);
			const now = fresh.flatMap((c) => c.cards).find((k) => k.id === editingCard.id);
			if (!now) return;
			setEditingCard(now);
			if (field === "title") setCardTitle(now.title);
			if (field === "description") setCardDesc(now.description || "");
			if (field === "due_date") setCardDue(now.due_date ?? "");
			if (field === "assignee_id") setCardAssignee(now.assignee_id ?? "");
		} catch (err) {
			logError(err, { source: "kanban" });
		}
	};

	// Comments are saved and shared as soon as they are added, without waiting for Save Changes
	const saveComments = async (comments: Comment[]) => {
		if (isViewer || !workspace?.path || !editingCard) return;
		const updated: KanbanCard = { ...editingCard, comments, updated_at: new Date().toISOString() };
		try {
			await updateKanbanCard({ path: workspace.path, card: updated, base: editingCard });
			publishDataChange({ entity: "card", op: "upsert", card: updated });
			setEditingCard(updated);
			setColumns((cols) => cols.map((c) => ({ ...c, cards: c.cards.map((k) => (k.id === updated.id ? updated : k)) })));
		} catch (err) {
			logError(err, { source: "kanban" });
		}
	};

	const handleEditCardSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (isViewer || !workspace?.path || !editingCard || !cardTitle.trim()) return;

		try {
			setSubmitting(true);
			const updated: KanbanCard = {
				...editingCard,
				title: cardTitle.trim(),
				description: cardDesc.trim(),
				tags: cardTags,
				due_date: cardDue || undefined,
				assignee_id: cardAssignee || undefined,
				checklist: cardChecklist,
				updated_at: new Date().toISOString(),
			};
			await updateKanbanCard({ path: workspace.path, card: updated, base: editingCard });
			publishDataChange({ entity: "card", op: "upsert", card: updated });
			await addActivityEvent(
				"Updated card",
				`Updated card "${updated.title}"`,
				itemTarget("card", updated.id),
				"kanban",
			);
			setEditingCard(null);
			await loadKanban();
			await refreshMetadata();
		} catch (err) {
			console.error("Failed to update card:", err);
			logError(err, { source: "kanban" });
		} finally {
			setSubmitting(false);
		}
	};

	// Move Card across columns
	const handleMoveCard = async (
		card: KanbanCard,
		targetColId: string,
		_direction: "left" | "right",
	) => {
		if (isViewer || !workspace?.path) return;
		try {
			const targetCol = columns.find((c) => c.id === targetColId);
			const newPos = endPosition(targetCol?.cards ?? []);

			// While trying out a reorganisation the move goes to the draft, and nobody else hears of it
			if (board) {
				await moveInBoardDraft(workspace.path, board.id, card.id, targetColId, newPos);
				setColumns(await getBoardDraft(workspace.path, board.id));
				return;
			}

			// Shown at once; the file write follows, and the board is read back if it fails
			setColumns((prev) =>
				prev.map((c) => ({
					...c,
					cards: c.id === targetColId ? [...c.cards.filter((x) => x.id !== card.id), { ...card, column_id: targetColId, position: newPos }] : c.cards.filter((x) => x.id !== card.id),
				})),
			);
			await moveKanbanCard({
				path: workspace.path,
				card_id: card.id,
				column_id: targetColId,
				position: newPos,
			});
			publishDataChange({
				entity: "card",
				op: "upsert",
				card: { ...card, column_id: targetColId, position: newPos, updated_at: new Date().toISOString() },
			});
			await addActivityEvent(
				"Moved card",
				`Moved card "${card.title}" to ${targetCol?.title || "list"}`,
				undefined,
				"kanban",
			);
			await loadKanban();
			await refreshMetadata();
		} catch (err) {
			console.error("Failed to move card:", err);
			logError(err, { source: "kanban" });
			await loadKanban();
		}
	};

	// Delete card
	const handleDeleteCard = async () => {
		if (isViewer || !workspace?.path || !deletingCardId) return;
		try {
			let deletedTitle = "Card";
			for (const col of columns) {
				const c = col.cards?.find((x) => x.id === deletingCardId);
				if (c) {
					deletedTitle = c.title;
					break;
				}
			}
			if (eraseCard) {
				// No activity entry: it would put the title back into the history that is being erased
				await eraseRecordForGood(workspace.path, "card", deletingCardId);
				publishDataChange({ entity: "card", op: "delete", id: deletingCardId, erase: true });
			} else {
				await deleteKanbanCard({ path: workspace.path, id: deletingCardId });
				publishDataChange({ entity: "card", op: "delete", id: deletingCardId });
				await addActivityEvent(
					"Deleted card",
					`Deleted card "${deletedTitle}"`,
					itemTarget("card", deletingCardId),
					"kanban",
				);
			}
			setEraseCard(false);
			setDeletingCardId(null);
			await loadKanban();
			await refreshMetadata();
		} catch (err) {
			console.error("Failed to delete card:", err);
			logError(err, { source: "delete_card" });
		}
	};

	// Drop the dragged card into the slot under the pointer; only the cards whose position changed are saved
	const handleDrop = async () => {
		const id = dragId;
		const target = drop;
		setDragId(null);
		setDrop(null);
		if (!id || !target || isViewer || !workspace?.path) return;
		const moves = planMove(columns, id, target.colId, target.index);
		if (moves.length === 0) return;
		try {
			if (board) {
				for (const move of moves) await moveInBoardDraft(workspace.path, board.id, move.id, move.column_id, move.position);
				setColumns(await getBoardDraft(workspace.path, board.id));
				return;
			}
			const cards = new Map(columns.flatMap((c) => c.cards).map((c) => [c.id, c]));
			const now = new Date().toISOString();
			for (const move of moves) {
				await moveKanbanCard({
					path: workspace.path,
					card_id: move.id,
					column_id: move.column_id,
					position: move.position,
				});
				const card = cards.get(move.id);
				if (card) {
					publishDataChange({
						entity: "card",
						op: "upsert",
						card: { ...card, column_id: move.column_id, position: move.position, updated_at: now },
					});
				}
			}
			const moved = cards.get(id);
			const to = columns.find((c) => c.id === target.colId);
			if (moved && to && moved.column_id !== to.id) {
				await addActivityEvent("Moved card", `Moved card "${moved.title}" to ${to.title}`, itemTarget("card", moved.id), "kanban");
				await refreshMetadata();
			}
			setColumns(await getKanban(workspace.path));
		} catch (err) {
			console.error("Failed to move card:", err);
			logError(err, { source: "kanban" });
		}
	};

	// Due date, assignee, tags and checklist, shared by the create and edit dialogs
	const renderCardExtras = (prefix: string) => (
		<>
			<div className="grid grid-cols-2 gap-3">
				<div>
					<Label htmlFor={`${prefix}-due`}>Due date</Label>
					<DateField noPast={prefix === "new-card"} id={`${prefix}-due`} value={cardDue} onChange={setCardDue} className="mt-1" />
				</div>
				<div>
					<Label htmlFor={`${prefix}-assignee`}>Assignee</Label>
					<select
						id={`${prefix}-assignee`}
						value={cardAssignee}
						onChange={(e) => setCardAssignee(e.target.value)}
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
			</div>
			<div>
				<Label htmlFor={`${prefix}-tags`}>Tags</Label>
				<TagInput id={`${prefix}-tags`} value={cardTags} onChange={setCardTags} suggestions={allTags} />
			</div>
			<div>
				<span className="text-sm font-medium">Checklist</span>
				<ChecklistEditor value={cardChecklist} onChange={setCardChecklist} />
			</div>
		</>
	);

	return (
		<div className="flex h-full min-h-0 flex-col bg-background">
			<Toolbar>
				<ToolbarTitle name="Kanban" meta={`${columns.reduce((n, c) => n + c.cards.length, 0)} cards · ${columns.length} ${columns.length === 1 ? "column" : "columns"}`} />
				<span className="flex-1" />
				{workspace?.path && <BoardDraftBar workspacePath={workspace.path} columns={columns} board={board} onBoard={setBoard} canDraft={!isViewer} />}
				{canChange && (
					<Button size="sm" onPress={() => setIsCreateColOpen(true)}>
						<Plus className="size-4" />
						New Column
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

			{/* Kanban Container */}
			{loading ? (
				<Loading fill className="flex-1" />
			) : columns.length === 0 ? (
				<EmptyState
					art="kanban"
					title="No Columns Yet"
					action={
						canChange && (
							<Button size="sm" onPress={() => setIsCreateColOpen(true)}>
								<Plus className="size-4" />
								New Column
							</Button>
						)
					}
				>
					Your board is empty. Add a column to get started.
				</EmptyState>
			) : (
				<div className="flex min-h-0 flex-1 gap-4 overflow-x-auto p-4">
					{columns.map((col, colIndex) => {
						const prevCol = colIndex > 0 ? columns[colIndex - 1] : null;
						const nextCol =
							colIndex < columns.length - 1 ? columns[colIndex + 1] : null;

						return (
							<div
								key={col.id}
								className="group/col frame flex min-h-0 min-w-72 flex-1 basis-72 flex-col bg-panel"
							>
								{/* Column Header */}
								<div className="flex h-12 shrink-0 items-center justify-between border-b pr-2 pl-3">
									<div className="flex items-center gap-2">
										<span className="font-mono text-[13px] text-primary" aria-hidden>{String(colIndex + 1).padStart(2, "0")}</span>
										<h3 className="truncate text-sm font-semibold text-foreground">
											{col.title}
										</h3>
										<span className="font-mono text-[13px] tabular-nums text-muted-foreground">
											{col.cards.length}
										</span>
									</div>

									{canChange && (
										<div className="flex items-center gap-1">
											<Button
												variant="ghost"
												size="icon-xs"
												onPress={() => setDeletingColId(col.id)}
												aria-label="Delete column"
												className="opacity-0 transition-opacity focus-visible:opacity-100 group-hover/col:opacity-100"
											>
												<Trash2 className="size-3.5 text-muted-foreground hover:text-destructive" />
											</Button>
											<Button
												variant="ghost"
												size="icon-xs"
												onPress={() => {
													setCardTitle("");
													setCardDesc("");
													openNewCard(col.id);
												}}
												aria-label="Add card"
											>
												<Plus className="size-3.5" />
											</Button>
										</div>
									)}
								</div>

								{/* Cards Column Body */}
								<div
								className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2"
								onDragOver={(e) => {
									if (!dragId) return;
									e.preventDefault();
									setDrop((d) =>
										d?.colId === col.id && d.index === col.cards.length
											? d
											: { colId: col.id, index: col.cards.length },
									);
								}}
								onDrop={(e) => {
									e.preventDefault();
									handleDrop();
								}}
							>
									{col.cards.length === 0 ? (
										<div className="flex flex-1 flex-col items-center justify-center border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
											No cards in this column.
										</div>
									) : (
										col.cards.filter(matchesTag).map((card) => (
											<div
												key={card.id}
												className={cn(
													"group frame relative border-l-2 border-l-transparent bg-card p-3 transition-colors hover:border-l-primary",
													dragId === card.id && "opacity-40",
													drop?.colId === col.id && drop.index === col.cards.indexOf(card) && "border-t-2 border-t-primary",
													drop?.colId === col.id &&
														drop.index === col.cards.length &&
														col.cards.indexOf(card) === col.cards.length - 1 &&
														"border-b-2 border-b-primary",
												)}
												draggable={!isViewer}
												onDragStart={(e) => {
													setDragId(card.id);
													e.dataTransfer.effectAllowed = "move";
													e.dataTransfer.setData("text/plain", card.id);
												}}
												onDragEnd={() => {
													setDragId(null);
													setDrop(null);
												}}
												onDragOver={(e) => {
													if (!dragId) return;
													e.preventDefault();
													e.stopPropagation();
													const box = e.currentTarget.getBoundingClientRect();
													const index = col.cards.indexOf(card) + (e.clientY > box.top + box.height / 2 ? 1 : 0);
													setDrop((d) => (d?.colId === col.id && d.index === index ? d : { colId: col.id, index }));
												}}
												onDrop={(e) => {
													e.preventDefault();
													e.stopPropagation();
													handleDrop();
												}}
											>
												<div className="flex items-start justify-between gap-2">
													<h4 className="text-sm font-medium leading-snug text-foreground">
														{card.title}
														<span className="ml-1 align-middle"><CommentCount entity="card" id={card.id} legacy={card.comments?.length ?? 0} counts={threadCounts} /></span>
														<span className="ml-1 align-middle"><ExpiryBadge entity="card" id={card.id} expiries={expiries} /></span>
														{(card.conflicts?.length ?? 0) > 0 && (
															<AlertTriangle className="ml-1 inline size-3.5 text-warning" aria-label="Has a change to sort out" />
														)}
													</h4>
													<PresenceDots names={viewersAt("kanban", card.id)} doing="editing this card" />
													{canChange && (
														<div className="flex items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100">
															<Button
																variant="ghost"
																size="icon-xs"
																onPress={() => handleOpenEditCard(card)}
																data-nav
																aria-label="Edit card"
															>
																<Pencil className="size-3" />
															</Button>
															<Button
																variant="ghost"
																size="icon-xs"
																onPress={() => setDeletingCardId(card.id)}
																aria-label="Delete card"
															>
																<Trash2 className="size-3 text-destructive" />
															</Button>
														</div>
													)}
												</div>

												{card.description && (
													<p className="mt-2 line-clamp-3 text-sm text-muted-foreground">
														{card.description}
													</p>
												)}

												{((card.tags ?? []).length > 0 ||
													card.due_date ||
													card.assignee_id ||
													(card.checklist ?? []).length > 0 ||
													(card.violations ?? []).length > 0) && (
													<div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
														<RuleFlag violations={card.violations} />
															<DueBadge due={card.due_date} done={colIndex === columns.length - 1} />
														{(card.checklist ?? []).length > 0 && (
															<span className="inline-flex items-center gap-1">
																<CheckSquare className="size-3" />
																{card.checklist.filter((i) => i.done).length}/{card.checklist.length}
															</span>
														)}
														{card.assignee_id && <span>{memberName(card.assignee_id)}</span>}
														{(card.tags ?? []).map((tag) => (
															<TagChip
																key={tag}
																tag={tag}
																active={tagFilter === tag}
																onClick={() => setTagFilter(tagFilter === tag ? null : tag)}
															/>
														))}
													</div>
												)}

												{/* Quick Move Across Columns */}
												{!isViewer && (
												<div className="mt-3 flex items-center justify-between border-t border-border/40 pt-2 text-sm text-muted-foreground">
													{prevCol ? (
														<button
															type="button"
															onClick={() =>
																handleMoveCard(card, prevCol.id, "left")
															}
															className="flex items-center gap-1 hover:text-foreground cursor-pointer transition-colors"
															title={`Move to ${prevCol.title}`}
														>
															<ArrowLeft className="size-3" />
															<span>{prevCol.title}</span>
														</button>
													) : (
														<span />
													)}

													{nextCol ? (
														<button
															type="button"
															onClick={() =>
																handleMoveCard(card, nextCol.id, "right")
															}
															className="flex items-center gap-1 hover:text-foreground cursor-pointer transition-colors ml-auto"
															title={`Move to ${nextCol.title}`}
														>
															<span>{nextCol.title}</span>
															<ArrowRight className="size-3" />
														</button>
													) : null}
												</div>
											)}
										</div>
									))
									)}
								</div>

								{/* Add Card Quick Button */}
								{canChange && (
									<Button
										variant="ghost"
										size="sm"
										className="m-2 mt-0 justify-start text-muted-foreground hover:text-foreground"
										onPress={() => {
											setCardTitle("");
											setCardDesc("");
											openNewCard(col.id);
										}}
									>
										<Plus className="size-3.5 mr-2" />
										Add a Card
									</Button>
								)}
							</div>
						);
					})}
				</div>
			)}

			{/* Create Column Modal */}
			{isCreateColOpen && (
				<Dialog
					isOpen={isCreateColOpen}
					onOpenChange={setIsCreateColOpen}
					className="max-w-md"
				>
					<form onSubmit={handleCreateColumnSubmit} className="space-y-4">
						<DialogHeading icon={<Plus className="size-6" />} title="Add a Column" />

						<div>
							<Label htmlFor="col-title">Column Title *</Label>
							<Input
								id="col-title"
								maxLength={MAX_TITLE}
								required
								value={newColTitle}
								onChange={(e) => setNewColTitle(e.target.value)}
								placeholder="e.g. Blocked, In Review, QA"
								className="mt-1"
								autoFocus
							/>
						</div>

						<DialogFooter>
							<Button
								type="button"
								variant="outline"
								onPress={() => setIsCreateColOpen(false)}
								isDisabled={submitting}
							>
								Cancel
							</Button>
							<Button
								type="submit"
								isDisabled={submitting || !newColTitle.trim()}
							>
								{submitting ? "Adding…" : "Add Column"}
							</Button>
						</DialogFooter>
					</form>
				</Dialog>
			)}

			{/* Create Card Modal */}
			{activeColIdForNewCard && (
				<Dialog
					isOpen={!!activeColIdForNewCard}
					onOpenChange={(open) => !open && setActiveColIdForNewCard(null)}
					className="max-h-[90vh] max-w-md overflow-y-auto"
				>
					<form onSubmit={handleCreateCardSubmit} className="space-y-4">
						<DialogHeading icon={<Plus className="size-6" />} title="Add a Card" />

						<div className="space-y-3">
							<div>
								<Label htmlFor="card-title">Title *</Label>
								<Input
									id="card-title"
									maxLength={MAX_TITLE}
									required
									value={cardTitle}
									onChange={(e) => setCardTitle(e.target.value)}
									placeholder="e.g. Design wireframes for assets lazy loading"
									className="mt-1"
									autoFocus
								/>
							</div>

							<div>
								<Label htmlFor="card-desc">Description</Label>
								<Textarea
									id="card-desc"
									value={cardDesc}
									onChange={(e) => setCardDesc(e.target.value)}
									placeholder="Add context or notes…"
									rows={3}
									className="mt-1"
								/>
							</div>
							{renderCardExtras("new-card")}
						</div>

						<DialogFooter>
							<Button
								type="button"
								variant="outline"
								onPress={() => setActiveColIdForNewCard(null)}
								isDisabled={submitting}
							>
								Cancel
							</Button>
							<Button type="submit" isDisabled={submitting || !cardTitle.trim()}>
								{submitting ? "Adding…" : "Add Card"}
							</Button>
						</DialogFooter>
					</form>
				</Dialog>
			)}

			{/* Edit Card Modal */}
			{editingCard && (
				<Dialog
					isOpen={!!editingCard}
					onOpenChange={(open) => !open && setEditingCard(null)}
					className="max-h-[90vh] max-w-md overflow-y-auto"
				>
					<form onSubmit={handleEditCardSubmit} className="space-y-4">
						<DialogHeading icon={<Pencil className="size-6" />} title="Edit card" description={<>Update this card's details.</>} />

						<div className="space-y-3">
							<div>
								<Label htmlFor="edit-card-title">Title *</Label>
								<Input
									id="edit-card-title"
									maxLength={MAX_TITLE}
									required
									value={cardTitle}
									onChange={(e) => setCardTitle(e.target.value)}
									className="mt-1"
									autoFocus
								/>
							</div>

							<div>
								<Label htmlFor="edit-card-desc">Description</Label>
								<Textarea
									id="edit-card-desc"
									value={cardDesc}
									onChange={(e) => setCardDesc(e.target.value)}
									rows={3}
									className="mt-1"
								/>
								<NoteLinks text={cardDesc} />
							</div>
							{renderCardExtras("edit-card")}
						</div>

						<ConflictPanel conflicts={editingCard.conflicts ?? []} violations={editingCard.violations} show={showValue} canChoose={!isViewer} onChoose={resolveConflict} record={{ entity: "card", id: editingCard.id }} />
						{workspace && <RecordTimeline workspacePath={workspace.path} entity="card" id={editingCard.id} title={editingCard.title} show={showValue} />}
						<ExpiryControl entity="card" id={editingCard.id} name={editingCard.title} />
						{!isViewer && workspace && <DraftsButton workspacePath={workspace.path} entity="card" record={editingCard} members={members} onMerged={() => setEditingCard(null)} />}

						<Comments
							comments={editingCard.comments ?? []}
							me={me}
							memberNames={members.map((m) => m.name)}
							canComment={!isViewer}
							onChange={saveComments}
						/>
						<section aria-label="Discussion" className="space-y-1">
							<h3 className="text-sm font-semibold">Discussion</h3>
							<FieldDiscussion channel={`card:${editingCard.id}`} field="" canComment={!isViewer} placeholder="Say something about this card" label="Discuss this card" />
						</section>

						<DialogFooter>
							<Button
								type="button"
								variant="outline"
								onPress={() => setEditingCard(null)}
								isDisabled={submitting}
							>
								Cancel
							</Button>
							<Button type="submit" isDisabled={submitting || !cardTitle.trim()}>
								{submitting ? "Saving…" : "Save Changes"}
							</Button>
						</DialogFooter>
					</form>
				</Dialog>
			)}

			{/* Delete column Confirmation Modal */}
			{deletingColId && (
				<Dialog
					isOpen={!!deletingColId}
					onOpenChange={(open) => !open && setDeletingColId(null)}
				>
					<div className="space-y-4">
						<DialogHeading icon={<Trash2 className="size-6" />} tone="danger" title="Delete Column" description={<>Are you sure you want to delete this column and all of its
								cards? This action cannot be undone.</>} />

						<DialogFooter>
							<Button variant="outline" onPress={() => setDeletingColId(null)}>
								Cancel
							</Button>
							<Button variant="destructive" onPress={handleDeleteColumn}>
								Delete Column
							</Button>
						</DialogFooter>
					</div>
				</Dialog>
			)}

			{/* Delete card Confirmation Modal */}
			{deletingCardId && (
				<Dialog
					isOpen={!!deletingCardId}
					onOpenChange={(open) => {
						if (!open) {
							setDeletingCardId(null);
							setEraseCard(false);
						}
					}}
				>
					<div className="space-y-4">
						<DialogHeading icon={<Trash2 className="size-6" />} tone="danger" title="Delete Card" description={<>Are you sure you want to delete this card?</>} />
						<EraseOption checked={eraseCard} onChange={setEraseCard} what="the card" />

						<DialogFooter>
							<Button
								variant="outline"
								onPress={() => {
									setDeletingCardId(null);
									setEraseCard(false);
								}}
							>
								Cancel
							</Button>
							<Button variant="destructive" onPress={handleDeleteCard}>
								{eraseCard ? "Erase Card" : "Delete Card"}
							</Button>
						</DialogFooter>
					</div>
				</Dialog>
			)}
		</div>
	);
}
