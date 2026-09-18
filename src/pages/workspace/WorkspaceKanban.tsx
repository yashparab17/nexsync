import { useCallback, useEffect, useState } from "react";
import {
	ArrowLeft,
	ArrowRight,
	Columns3,
	Pencil,
	Plus,
	Sparkles,
	Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
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
import {
	createKanbanCard,
	createKanbanColumn,
	deleteKanbanCard,
	deleteKanbanColumn,
	getKanban,
	moveKanbanCard,
	updateKanbanCard,
} from "@/lib/tauri";
import { useWorkspace } from "@/store/workspace/WorkspaceContext";
import type { KanbanCard, KanbanColumn } from "@/types/workspace";

export default function WorkspaceKanban() {
	const { workspace, refreshMetadata, addActivityEvent } = useWorkspace();
	const logError = useErrorLog();

	const [columns, setColumns] = useState<KanbanColumn[]>([]);
	const [loading, setLoading] = useState(true);

	// Modals & Dialog States
	const [isCreateColOpen, setIsCreateColOpen] = useState(false);
	const [newColTitle, setNewColTitle] = useState("");

	const [activeColIdForNewCard, setActiveColIdForNewCard] = useState<
		string | null
	>(null);
	const [cardTitle, setCardTitle] = useState("");
	const [cardDesc, setCardDesc] = useState("");

	const [editingCard, setEditingCard] = useState<KanbanCard | null>(null);
	const [deletingCardId, setDeletingCardId] = useState<string | null>(null);
	const [deletingColId, setDeletingColId] = useState<string | null>(null);

	const [submitting, setSubmitting] = useState(false);

	// Fetch Kanban board data
	const loadKanban = useCallback(async () => {
		if (!workspace?.path) return;
		try {
			setLoading(true);
			const data = await getKanban(workspace.path);
			setColumns(data);
		} catch (err) {
			console.error("Failed to load kanban:", err);
			logError(err, { source: "kanban" });
		} finally {
			setLoading(false);
		}
	}, [workspace?.path, logError]);

	useEffect(() => {
		loadKanban();
	}, [loadKanban]);

	// Create Default Starter Columns if board is completely empty
	const handleCreateDefaultColumns = async () => {
		if (!workspace?.path) return;
		try {
			setSubmitting(true);
			const defaultCols = ["Backlog", "In Progress", "In Review", "Done"];
			for (let i = 0; i < defaultCols.length; i++) {
				const col: KanbanColumn = {
					id: crypto.randomUUID(),
					title: defaultCols[i],
					position: i,
					cards: [],
				};
				await createKanbanColumn({ path: workspace.path, column: col });
			}
			await addActivityEvent(
				"Created default columns",
				"Initialized default Kanban board columns",
				undefined,
				"kanban",
			);
			await loadKanban();
			await refreshMetadata();
		} catch (err) {
			console.error("Failed to create starter columns:", err);
			logError(err, { source: "kanban" });
		} finally {
			setSubmitting(false);
		}
	};

	// Create Column Submit
	const handleCreateColumnSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!workspace?.path || !newColTitle.trim()) return;

		try {
			setSubmitting(true);
			const newCol: KanbanColumn = {
				id: crypto.randomUUID(),
				title: newColTitle.trim(),
				position: columns.length,
				cards: [],
			};
			await createKanbanColumn({ path: workspace.path, column: newCol });
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
		if (!workspace?.path || !deletingColId) return;
		try {
			const deletedCol = columns.find((c) => c.id === deletingColId);
			await deleteKanbanColumn({ path: workspace.path, id: deletingColId });
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
		if (!workspace?.path || !activeColIdForNewCard || !cardTitle.trim()) return;

		try {
			setSubmitting(true);
			const col = columns.find((c) => c.id === activeColIdForNewCard);
			const nextPos = col ? col.cards.length : 0;
			const now = new Date().toISOString();

			const newCard: KanbanCard = {
				id: crypto.randomUUID(),
				column_id: activeColIdForNewCard,
				title: cardTitle.trim(),
				description: cardDesc.trim(),
				position: nextPos,
				created_at: now,
				updated_at: now,
			};

			await createKanbanCard({ path: workspace.path, card: newCard });
			await addActivityEvent(
				"Created card",
				`Created card "${newCard.title}"`,
				undefined,
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
	};

	// Edit Card Submit
	const handleEditCardSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!workspace?.path || !editingCard || !cardTitle.trim()) return;

		try {
			setSubmitting(true);
			const updated: KanbanCard = {
				...editingCard,
				title: cardTitle.trim(),
				description: cardDesc.trim(),
				updated_at: new Date().toISOString(),
			};
			await updateKanbanCard({ path: workspace.path, card: updated });
			await addActivityEvent(
				"Updated card",
				`Updated card "${updated.title}"`,
				undefined,
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
		if (!workspace?.path) return;
		try {
			const targetCol = columns.find((c) => c.id === targetColId);
			const newPos = targetCol ? targetCol.cards.length : 0;

			await moveKanbanCard({
				path: workspace.path,
				card_id: card.id,
				column_id: targetColId,
				position: newPos,
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
		if (!workspace?.path || !deletingCardId) return;
		try {
			let deletedTitle = "Card";
			for (const col of columns) {
				const c = col.cards?.find((x) => x.id === deletingCardId);
				if (c) {
					deletedTitle = c.title;
					break;
				}
			}
			await deleteKanbanCard({ path: workspace.path, id: deletingCardId });
			await addActivityEvent(
				"Deleted card",
				`Deleted card "${deletedTitle}"`,
				undefined,
				"kanban",
			);
			setDeletingCardId(null);
			await loadKanban();
			await refreshMetadata();
		} catch (err) {
			console.error("Failed to delete card:", err);
			logError(err, { source: "delete_card" });
		}
	};

	return (
		<div className="flex h-[calc(100vh-8rem)] flex-col space-y-4">
			{/* Header */}
			<div className="flex shrink-0 items-center justify-between">
				<div>
					<h1 className="text-2xl font-bold tracking-tight">Kanban Board</h1>
					<p className="mt-1 text-sm text-muted-foreground">
						Visual workspace columns and cards backed by local SQLite.
					</p>
				</div>
				<div className="flex items-center gap-2">
					<Button
						variant="outline"
						size="sm"
						onPress={() => setIsCreateColOpen(true)}
						className="gap-1.5"
					>
						<Plus className="size-4" />
						New Column
					</Button>
				</div>
			</div>

			{/* Kanban Board Container */}
			{loading ? (
				<div className="flex flex-1 items-center justify-center">
					<p className="text-xs uppercase tracking-widest text-muted-foreground animate-pulse">
						Loading Kanban board from SQLite…
					</p>
				</div>
			) : columns.length === 0 ? (
				<div className="flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-border/80 p-12 text-center bg-card/10">
					<div className="flex size-12 items-center justify-center rounded-full bg-muted/60">
						<Columns3 className="size-6 text-muted-foreground" />
					</div>
					<h3 className="mt-4 text-base font-semibold">No Columns Yet</h3>
					<p className="mt-1 text-sm text-muted-foreground max-w-sm">
						Your Kanban board is currently empty. You can generate default starter
						columns or create your own.
					</p>
					<div className="mt-4 flex gap-3">
						<Button
							size="sm"
							variant="outline"
							onPress={handleCreateDefaultColumns}
							isDisabled={submitting}
						>
							<Sparkles className="size-4 mr-1 text-amber-400" />
							Create Default Columns
						</Button>
						<Button
							size="sm"
							onPress={() => setIsCreateColOpen(true)}
							className="gap-1"
						>
							<Plus className="size-4" />
							New Column
						</Button>
					</div>
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
								className="flex w-80 shrink-0 flex-col rounded-xl border bg-muted/20 p-3 shadow-2xs"
							>
								{/* Column Header */}
								<div className="flex items-center justify-between pb-2">
									<div className="flex items-center gap-2">
										<h3 className="text-sm font-semibold tracking-wide text-foreground">
											{col.title}
										</h3>
										<span className="flex size-5 items-center justify-center rounded-full bg-muted text-[11px] font-bold text-muted-foreground">
											{col.cards.length}
										</span>
									</div>

									<div className="flex items-center gap-1">
										<Button
											variant="ghost"
											size="icon-xs"
											onPress={() => {
												setCardTitle("");
												setCardDesc("");
												setActiveColIdForNewCard(col.id);
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
								</div>

								{/* Cards Column Body */}
								<div className="flex flex-1 flex-col gap-2.5 overflow-y-auto py-1">
									{col.cards.length === 0 ? (
										<div className="flex flex-1 flex-col items-center justify-center rounded-lg border border-dashed border-border/60 p-6 text-center text-xs text-muted-foreground">
											No cards in this column.
										</div>
									) : (
										col.cards.map((card) => (
											<div
												key={card.id}
												className="group relative rounded-lg border bg-card p-3 shadow-xs transition-all hover:border-primary/40 hover:shadow-sm"
											>
												<div className="flex items-start justify-between gap-2">
													<h4 className="text-sm font-medium leading-snug text-foreground">
														{card.title}
													</h4>
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
												</div>

												{card.description && (
													<p className="mt-1.5 text-xs text-muted-foreground line-clamp-3">
														{card.description}
													</p>
												)}

												{/* Quick Move Across Columns */}
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
											</div>
										))
									)}
								</div>

								{/* Add Card Quick Button */}
								<Button
									variant="ghost"
									size="sm"
									className="mt-2 w-full justify-start text-xs text-muted-foreground hover:text-foreground"
									onPress={() => {
										setCardTitle("");
										setCardDesc("");
										setActiveColIdForNewCard(col.id);
									}}
								>
									<Plus className="size-3.5 mr-1.5" />
									Add a card
								</Button>
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
					className="max-w-md"
				>
					<form onSubmit={handleCreateCardSubmit} className="space-y-4">
						<DialogHeader>
							<DialogTitle>Add Kanban Card</DialogTitle>
							<DialogDescription>
								Add a card to the column in your workspace SQLite database.
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
					className="max-w-md"
				>
					<form onSubmit={handleEditCardSubmit} className="space-y-4">
						<DialogHeader>
							<DialogTitle>Edit Kanban Card</DialogTitle>
							<DialogDescription>
								Update card details in the workspace SQLite database.
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
							</div>
						</div>

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
					onOpenChange={(open) => !open && setDeletingCardId(null)}
				>
					<div className="space-y-4">
						<DialogHeader>
							<DialogTitle>Delete Card</DialogTitle>
							<DialogDescription>
								Are you sure you want to delete this card?
							</DialogDescription>
						</DialogHeader>

						<DialogFooter>
							<Button variant="outline" onPress={() => setDeletingCardId(null)}>
								Cancel
							</Button>
							<Button variant="destructive" onPress={handleDeleteCard}>
								Delete Card
							</Button>
						</DialogFooter>
					</div>
				</Dialog>
			)}
		</div>
	);
}
