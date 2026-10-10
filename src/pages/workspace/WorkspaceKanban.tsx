import { useCallback, useEffect, useMemo, useState } from "react";
import {
	AlertTriangle,
	ArrowLeft,
	ArrowRight,
	CheckSquare,
	Columns3,
	Pencil,
	Plus,
	Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import EraseOption from "@/components/elements/EraseOption";
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
import { ChecklistEditor, DueBadge, TagChip, TagInput } from "@/components/elements/PlanningFields";
import { collectTags, endPosition, planMove } from "@/lib/planning";
import { cn } from "@/lib/utils";

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
import ConflictPanel from "@/components/elements/ConflictPanel";
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

export default function WorkspaceKanban() {
	const { workspace, metadata, refreshMetadata, addActivityEvent } = useWorkspace();
	const members = metadata?.members.members ?? [];
	const memberName = (id: string) => members.find((m) => m.id === id)?.name ?? "a removed member";
	const { dataVersion, publishDataChange, viewersAt } = useP2P();
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

	// Delete Column
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
		}
	};

	// Delete Card
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
					<DateField id={`${prefix}-due`} value={cardDue} onChange={setCardDue} className="mt-1" />
				</div>
				<div>
					<Label htmlFor={`${prefix}-assignee`}>Assignee</Label>
					<select
						id={`${prefix}-assignee`}
						value={cardAssignee}
						onChange={(e) => setCardAssignee(e.target.value)}
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
			</div>
			<div>
				<Label htmlFor={`${prefix}-tags`}>Tags</Label>
				<TagInput id={`${prefix}-tags`} value={cardTags} onChange={setCardTags} suggestions={allTags} />
			</div>
			<div>
				<Label>Checklist</Label>
				<ChecklistEditor value={cardChecklist} onChange={setCardChecklist} />
			</div>
		</>
	);

	return (
		<div className="flex h-[calc(100vh-10rem)] flex-col space-y-4">
			{/* Header */}
			<div className="flex shrink-0 items-center justify-between">
				<div>
					<h1 className="text-2xl font-bold tracking-tight">Kanban Board</h1>
					<p className="mt-1 text-sm text-muted-foreground">
						Organise work in columns and cards.
					</p>
				</div>
				<div className="flex min-w-0 flex-1 items-center justify-end gap-2">
					{workspace?.path && <BoardDraftBar workspacePath={workspace.path} columns={columns} board={board} onBoard={setBoard} canDraft={!isViewer} />}
					{canChange && (
						<Button
							variant="outline"
							size="sm"
							onPress={() => setIsCreateColOpen(true)}
							className="gap-1.5"
						>
							<Plus className="size-4" />
							New Column
						</Button>
					)}
				</div>
			</div>

			{allTags.length > 0 && (
				<div className="flex shrink-0 flex-wrap items-center gap-1.5">
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

			{/* Kanban Board Container */}
			{loading ? (
				<Loading fill className="flex-1" />
			) : columns.length === 0 ? (
				<div className="flex flex-1 flex-col items-center justify-center rounded-none border border-dashed border-border/80 p-12 text-center bg-card/10">
					<div className="flex size-12 items-center justify-center rounded-none bg-muted/60">
						<Columns3 className="size-6 text-muted-foreground" />
					</div>
					<h3 className="mt-4 text-base font-semibold">No Columns Yet</h3>
					<p className="mt-1 text-sm text-muted-foreground max-w-sm">
						Your Kanban board is currently empty. Create a column to get started.
					</p>
					{canChange && (
						<div className="mt-4 flex gap-3">
							<Button
								size="sm"
								onPress={() => setIsCreateColOpen(true)}
								className="gap-1"
							>
								<Plus className="size-4" />
								New Column
							</Button>
						</div>
					)}
				</div>
			) : (
				<div className="flex flex-1 gap-4 overflow-x-auto pb-4 pt-1">
					{columns.map((col, colIndex) => {
						const prevCol = colIndex > 0 ? columns[colIndex - 1] : null;
						const nextCol =
							colIndex < columns.length - 1 ? columns[colIndex + 1] : null;

						return (
							<div
								key={col.id}
								className="flex w-80 shrink-0 flex-col border-t-2 border-primary bg-muted/30 p-3"
							>
								{/* Column Header */}
								<div className="flex items-center justify-between pb-2">
									<div className="flex items-center gap-2">
										<h3 className="text-xs font-bold uppercase tracking-widest text-foreground">
											{col.title}
										</h3>
										<span className="flex h-5 min-w-5 items-center justify-center bg-primary/10 px-1 text-[11px] font-bold text-primary">
											{col.cards.length}
										</span>
									</div>

									{canChange && (
										<div className="flex items-center gap-1">
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
											<Button
												variant="ghost"
												size="icon-xs"
												onPress={() => setDeletingColId(col.id)}
												aria-label="Delete column"
											>
												<Trash2 className="size-3.5 text-muted-foreground hover:text-destructive" />
											</Button>
										</div>
									)}
								</div>

								{/* Cards Column Body */}
								<div
								className="flex flex-1 flex-col gap-2.5 overflow-y-auto py-1"
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
										<div className="flex flex-1 flex-col items-center justify-center border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
											No cards in this column.
										</div>
									) : (
										col.cards.filter(matchesTag).map((card) => (
											<div
												key={card.id}
												className={cn(
													"group relative border-l-2 border-l-transparent bg-card p-3 transition-colors hover:border-l-primary hover:bg-card/80",
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
														{(card.conflicts?.length ?? 0) > 0 && (
															<AlertTriangle className="ml-1 inline size-3.5 text-amber-500" aria-label="Has a change to sort out" />
														)}
													</h4>
													<PresenceDots names={viewersAt("kanban", card.id)} doing="editing this card" />
													{canChange && (
														<div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
															<Button
																variant="ghost"
																size="icon-xs"
																onPress={() => handleOpenEditCard(card)}
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
													<p className="mt-1.5 text-xs text-muted-foreground line-clamp-3">
														{card.description}
													</p>
												)}

												{((card.tags ?? []).length > 0 ||
													card.due_date ||
													card.assignee_id ||
													(card.checklist ?? []).length > 0 ||
													(card.violations ?? []).length > 0) && (
													<div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
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
												<div className="mt-3 flex items-center justify-between border-t border-border/40 pt-2 text-[10px] text-muted-foreground">
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
										className="mt-2 w-full justify-start text-xs text-muted-foreground hover:text-foreground"
										onPress={() => {
											setCardTitle("");
											setCardDesc("");
											openNewCard(col.id);
										}}
									>
										<Plus className="size-3.5 mr-1.5" />
										Add a card
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
						<DialogHeader>
							<DialogTitle>Add Kanban Column</DialogTitle>
							<DialogDescription>
								Create a new status column for organizing workspace cards.
							</DialogDescription>
						</DialogHeader>

						<div>
							<Label htmlFor="col-title">Column Title *</Label>
							<Input
								id="col-title"
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
						<DialogHeader>
							<DialogTitle>Add Kanban Card</DialogTitle>
							<DialogDescription>
								Add a card to this column.
							</DialogDescription>
						</DialogHeader>

						<div className="space-y-3">
							<div>
								<Label htmlFor="card-title">Title *</Label>
								<Input
									id="card-title"
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
									placeholder="Add context or notes..."
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
						<DialogHeader>
							<DialogTitle>Edit Kanban Card</DialogTitle>
							<DialogDescription>
								Update this card's details.
							</DialogDescription>
						</DialogHeader>

						<div className="space-y-3">
							<div>
								<Label htmlFor="edit-card-title">Title *</Label>
								<Input
									id="edit-card-title"
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

						<ConflictPanel conflicts={editingCard.conflicts ?? []} violations={editingCard.violations} show={showValue} canChoose={!isViewer} onChoose={resolveConflict} />
						{!isViewer && workspace && <DraftsButton workspacePath={workspace.path} entity="card" record={editingCard} members={members} onMerged={() => setEditingCard(null)} />}

						<Comments
							comments={editingCard.comments ?? []}
							me={me}
							memberNames={members.map((m) => m.name)}
							canComment={!isViewer}
							onChange={saveComments}
						/>

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

			{/* Delete Column Confirmation Modal */}
			{deletingColId && (
				<Dialog
					isOpen={!!deletingColId}
					onOpenChange={(open) => !open && setDeletingColId(null)}
				>
					<div className="space-y-4">
						<DialogHeader>
							<DialogTitle>Delete Column</DialogTitle>
							<DialogDescription>
								Are you sure you want to delete this column and all of its
								cards? This action cannot be undone.
							</DialogDescription>
						</DialogHeader>

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

			{/* Delete Card Confirmation Modal */}
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
						<DialogHeader>
							<DialogTitle>Delete Card</DialogTitle>
							<DialogDescription>
								Are you sure you want to delete this card?
							</DialogDescription>
						</DialogHeader>
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
