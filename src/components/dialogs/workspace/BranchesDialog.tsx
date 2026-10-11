import { useCallback, useEffect, useState } from "react";
import * as Y from "yjs";
import { GitBranch, GitMerge } from "@/components/animate-icons";

import { DiffView } from "@/components/dialogs/workspace/FileHistoryDialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { branchDocId, closeBranch, listBranches, mergeBranch, previewMerge, startBranch, MAX_BRANCH_NAME, type Branch } from "@/lib/branches";
import { diffLines, type DiffResult } from "@/lib/diff";
import { getYjsDoc, saveYjsDoc } from "@/lib/tauri";

interface BranchesDialogProps {
	workspacePath: string;
	fileName: string;
	// The file's shared document, which also holds the list of branches
	doc: Y.Doc;
	userName: string;
	// Whether this person may change the file; viewers can look but not branch or merge
	canEdit: boolean;
	// The branch being edited right now, if any
	activeId: string | null;
	onOpenBranch: (id: string | null) => void;
	onClose: () => void;
}

interface Review {
	branch: Branch;
	state: Uint8Array;
	diff: DiffResult;
}

const when = (at: number) => new Date(at).toLocaleString();

// Branches of one file: start one, work on it away from the file, then review what it would change and merge it
export default function BranchesDialog({ workspacePath, fileName, doc, userName, canEdit, activeId, onOpenBranch, onClose }: BranchesDialogProps) {
	const [branches, setBranches] = useState(() => listBranches(doc));
	const [name, setName] = useState("");
	const [review, setReview] = useState<Review | "missing" | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [done, setDone] = useState<string | null>(null);

	// The list is part of the file, so it also changes when a collaborator starts or finishes a branch
	useEffect(() => {
		const map = doc.getMap("branches");
		const refresh = () => setBranches(listBranches(doc));
		map.observe(refresh);
		return () => map.unobserve(refresh);
	}, [doc]);

	const create = async () => {
		setBusy(true);
		setError(null);
		try {
			const { branch, state } = startBranch(doc, name, userName);
			await saveYjsDoc(workspacePath, branchDocId(branch.id), state);
			setName("");
			onOpenBranch(branch.id);
			onClose();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setBusy(false);
		}
	};

	const openReview = useCallback(
		async (branch: Branch) => {
			setError(null);
			setDone(null);
			setBusy(true);
			try {
				const state = await getYjsDoc(workspacePath, branchDocId(branch.id));
				if (!state) {
					setReview("missing");
					return;
				}
				const { before, after } = previewMerge(doc, state);
				setReview({ branch, state, diff: diffLines(before, after) });
			} catch (err) {
				setError(err instanceof Error ? err.message : String(err));
			} finally {
				setBusy(false);
			}
		},
		[workspacePath, doc],
	);

	const merge = () => {
		if (!review || review === "missing") return;
		mergeBranch(doc, review.branch, review.state, userName);
		if (activeId === review.branch.id) onOpenBranch(null);
		setDone(`Merged "${review.branch.name}" into ${fileName}.`);
		setReview(null);
	};

	const close = () => {
		if (!review || review === "missing") return;
		closeBranch(doc, review.branch, userName);
		if (activeId === review.branch.id) onOpenBranch(null);
		setReview(null);
	};

	return (
		<Dialog isOpen onOpenChange={(open) => !open && onClose()} className="sm:max-w-3xl">
			<div className="flex max-h-[75vh] min-h-0 flex-col gap-4">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<GitBranch className="size-4" />
						Branches of {fileName}
					</DialogTitle>
					<DialogDescription>
						A branch is a copy to work on without changing the file. When it is ready, review what it would change, then merge it in. Merging adds exactly what was written on the branch, so nothing a
						collaborator wrote in the file meanwhile is lost.
					</DialogDescription>
				</DialogHeader>

				{error && (
					<p role="alert" className="border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
						{error}
					</p>
				)}
				{done && <p className="p-2 text-xs text-success">{done}</p>}

				{review ? (
					<div className="flex min-h-0 flex-1 flex-col gap-3">
						{review === "missing" ? (
							<p className="text-sm text-muted-foreground">This branch has not reached this device yet. It arrives when you are connected to the person who made it.</p>
						) : (
							<>
								<div className="flex flex-wrap items-center justify-between gap-2">
									<p className="text-sm">
										Merging <span className="font-semibold">{review.branch.name}</span> would change {fileName}: <span className="text-success">+{review.diff.added}</span>{" "}
										<span className="text-destructive">-{review.diff.removed}</span>
									</p>
									{canEdit && review.branch.status === "open" && (
										<div className="flex gap-2">
											<Button size="sm" onPress={merge} className="gap-1.5">
												<GitMerge className="size-3.5" />
												Merge into the file
											</Button>
											<Button size="sm" variant="outline" onPress={close}>
												Close without merging
											</Button>
										</div>
									)}
								</div>
								<div className="min-h-0 flex-1 overflow-auto border">
									<DiffView diff={review.diff} />
								</div>
							</>
						)}
						<div>
							<Button size="sm" variant="ghost" onPress={() => setReview(null)}>
								Back to the list
							</Button>
						</div>
					</div>
				) : (
					<>
						{canEdit && (
							<form
								className="flex gap-2"
								onSubmit={(e) => {
									e.preventDefault();
									void create();
								}}
							>
								<Input aria-label="Branch name" placeholder="Name the branch, for example Try a new layout" value={name} maxLength={MAX_BRANCH_NAME} onChange={(e) => setName(e.target.value)} />
								<Button type="submit" isDisabled={busy || !name.trim()}>
									Start a branch
								</Button>
							</form>
						)}

						{branches.length === 0 ? (
							<p className="text-sm text-muted-foreground">No branches yet.</p>
						) : (
							<ul className="min-h-0 flex-1 divide-y divide-border/60 overflow-y-auto border">
								{branches.map((b) => (
									<li key={b.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
										<div className="min-w-0">
											<p className="truncate font-medium">
												{b.name}
												{activeId === b.id && <span className="ml-2 text-xs text-primary">editing now</span>}
											</p>
											<p className="text-xs text-muted-foreground">
												Started by {b.by}, {when(b.at)}
												{b.status !== "open" && ` · ${b.status === "merged" ? "merged" : "closed"} by ${b.closedBy ?? "someone"}${b.closedAt ? `, ${when(b.closedAt)}` : ""}`}
											</p>
										</div>
										<div className="flex gap-2">
											{b.status === "open" && activeId !== b.id && canEdit && (
												<Button
													size="sm"
													variant="outline"
													onPress={() => {
														onOpenBranch(b.id);
														onClose();
													}}
												>
													Work on it
												</Button>
											)}
											<Button size="sm" variant="outline" onPress={() => void openReview(b)} isDisabled={busy}>
												{b.status === "open" ? "Review" : "See changes"}
											</Button>
										</div>
									</li>
								))}
							</ul>
						)}
						{activeId && (
							<div>
								<Button
									size="sm"
									variant="ghost"
									onPress={() => {
										onOpenBranch(null);
										onClose();
									}}
								>
									Go back to the file
								</Button>
							</div>
						)}
					</>
				)}
			</div>
		</Dialog>
	);
}
