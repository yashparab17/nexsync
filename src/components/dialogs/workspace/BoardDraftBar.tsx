import { useEffect, useState } from "react";
import { GitBranch } from "@/components/animate-icons";

import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { discardBoardDraft, getKanban, listBoardDrafts, mergeBoardDraft, previewBoardDraft, startBoardDraft } from "@/lib/tauri";
import { errorText } from "@/lib/utils";
import { useNotifications } from "@/store/notifications/NotificationContext";
import { useP2P } from "@/store/p2p/P2PContext";
import type { BoardDraft, BoardPreview, KanbanColumn } from "@/types/workspace";

interface BoardDraftBarProps {
	workspacePath: string;
	// The board as shown now (the draft's, while one is open), for the names of its lists
	columns: KanbanColumn[];
	board: BoardDraft | null;
	onBoard: (board: BoardDraft | null) => void;
	// Whether this person may change the board; viewers cannot draft
	canDraft: boolean;
}

const MAX_NAME = 80;

// Try out a reorganised board without changing the real one: start a draft, move cards, then review and merge or throw away
export default function BoardDraftBar({ workspacePath, columns, board, onBoard, canDraft }: BoardDraftBarProps) {
	const { publishDataChange, refreshData } = useP2P();
	const { notify } = useNotifications();
	const [choosing, setChoosing] = useState(false);
	const [reviewing, setReviewing] = useState<BoardPreview | null>(null);
	const [drafts, setDrafts] = useState<BoardDraft[]>([]);
	const [name, setName] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (choosing) listBoardDrafts(workspacePath).then(setDrafts).catch((e) => setError(errorText(e, "Could not load the drafts.")));
	}, [choosing, workspacePath]);

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

	const start = () =>
		run(async () => {
			onBoard(await startBoardDraft(workspacePath, name));
			setName("");
			setChoosing(false);
		});

	const review = () =>
		run(async () => {
			if (board) setReviewing(await previewBoardDraft(workspacePath, board.id));
		});

	const merge = () =>
		run(async () => {
			if (!board) return;
			const ids = await mergeBoardDraft(workspacePath, board.id);
			// Each merged card goes to collaborators like any other edit of it
			const live = (await getKanban(workspacePath)).flatMap((c) => c.cards);
			for (const card of live.filter((c) => ids.includes(c.id))) publishDataChange({ entity: "card", op: "upsert", card });
			refreshData();
			notify(`Merged the board draft "${board.name}": ${ids.length} ${ids.length === 1 ? "card" : "cards"} moved.`);
			setReviewing(null);
			onBoard(null);
		});

	const discard = (target: BoardDraft) =>
		run(async () => {
			await discardBoardDraft(workspacePath, target.id);
			setDrafts((list) => list.filter((d) => d.id !== target.id));
			setReviewing(null);
			if (board?.id === target.id) onBoard(null);
		});

	const listName = (id: unknown) => columns.find((c) => c.id === id)?.title ?? "another list";

	if (!canDraft && !board) return null;

	return (
		<>
			{board ? (
				<div className="flex shrink-0 flex-wrap items-center gap-2 border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs">
					<GitBranch className="size-3.5 shrink-0 text-primary" />
					<span className="min-w-0 flex-1">
						You are trying out <span className="font-semibold">{board.name}</span>. Moves here are private until you merge them. Cards can be moved; to edit or add cards, go back to the board.
					</span>
					<Button size="xs" onPress={() => void review()} isDisabled={busy}>
						Review and merge
					</Button>
					<Button variant="ghost" size="xs" onPress={() => onBoard(null)}>
						Back to the board
					</Button>
					<Button variant="ghost" size="xs" onPress={() => void discard(board)} isDisabled={busy}>
						Discard
					</Button>
				</div>
			) : (
				<Button variant="outline" size="sm" onPress={() => setChoosing(true)} className="gap-1.5">
					<GitBranch className="size-4" />
					Try a reorganisation
				</Button>
			)}

			{error && !choosing && !reviewing && (
				<p role="alert" className="shrink-0 border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
					{error}
				</p>
			)}

			{choosing && (
				<Dialog isOpen onOpenChange={(open) => !open && setChoosing(false)} className="sm:max-w-lg">
					<div className="flex flex-col gap-4">
						<DialogHeader>
							<DialogTitle>Try a reorganisation</DialogTitle>
							<DialogDescription>
								Move cards between lists and reorder them without changing the real board. When it looks right, review what it would change and merge it. Nothing reaches your collaborators until then,
								and anything they change meanwhile is kept.
							</DialogDescription>
						</DialogHeader>
						{error && (
							<p role="alert" className="border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
								{error}
							</p>
						)}
						<form
							className="flex gap-2"
							onSubmit={(e) => {
								e.preventDefault();
								void start();
							}}
						>
							<Input aria-label="Name of the draft" placeholder="Name it, for example Sprint 12 plan" value={name} maxLength={MAX_NAME} onChange={(e) => setName(e.target.value)} />
							<Button type="submit" isDisabled={busy || !name.trim()}>
								Start
							</Button>
						</form>
						{drafts.length > 0 && (
							<ul className="divide-y divide-border/60 border">
								{drafts.map((d) => (
									<li key={d.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
										<span className="min-w-0 truncate">
											{d.name}
											<span className="ml-2 text-xs text-muted-foreground">{new Date(d.created_at).toLocaleString()}</span>
										</span>
										<span className="flex gap-2">
											<Button
												size="sm"
												variant="outline"
												onPress={() => {
													onBoard(d);
													setChoosing(false);
												}}
											>
												Continue
											</Button>
											<Button size="sm" variant="ghost" onPress={() => void discard(d)} isDisabled={busy}>
												Discard
											</Button>
										</span>
									</li>
								))}
							</ul>
						)}
					</div>
				</Dialog>
			)}

			{reviewing && board && (
				<Dialog isOpen onOpenChange={(open) => !open && setReviewing(null)} className="sm:max-w-xl">
					<div className="flex max-h-[75vh] min-h-0 flex-col gap-4">
						<DialogHeader>
							<DialogTitle>Merge {board.name}?</DialogTitle>
							<DialogDescription>This is what merging would change on the real board. All of it is merged together, or none of it.</DialogDescription>
						</DialogHeader>
						{error && (
							<p role="alert" className="border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
								{error}
							</p>
						)}
						{reviewing.cards.length === 0 ? (
							<p className="text-sm text-muted-foreground">Every card is where it was, so there is nothing to merge.</p>
						) : (
							<ul className="min-h-0 flex-1 divide-y divide-border/60 overflow-y-auto border">
								{reviewing.cards.map((card) => (
									<li key={card.id} className="space-y-1 px-3 py-2 text-sm">
										<p className="font-medium">{card.title || "Untitled card"}</p>
										{card.deleted ? (
											<p className="text-xs text-warning">Deleted since you started, so its move is dropped.</p>
										) : (
											<ul className="text-xs text-muted-foreground">
												{card.changes.map((c) => (
													<li key={c.path}>{c.path === "column_id" ? `Moves to ${listName(c.draft)}` : c.path === "position" ? "Changes its place in the list" : `Changes ${c.path}`}</li>
												))}
											</ul>
										)}
										{card.collisions.length > 0 && <p className="text-xs text-warning">Someone else also changed {card.collisions.map((c) => c.field).join(", ")}; you will be asked which to keep.</p>}
									</li>
								))}
							</ul>
						)}
						<div className="flex justify-end gap-2">
							<Button variant="ghost" onPress={() => setReviewing(null)}>
								Keep working
							</Button>
							<Button onPress={() => void merge()} isDisabled={busy || reviewing.cards.length === 0}>
								Merge into the board
							</Button>
						</div>
					</div>
				</Dialog>
			)}
		</>
	);
}
