import { useCallback, useEffect, useMemo, useState } from "react";
import {
	FileText,
	Loader2,
	Plus,
	Search,
	StickyNote,
	Trash2,
} from "lucide-react";

import EditorContainer from "@/components/elements/editor/EditorContainer";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

import { useErrorLog } from "@/hooks/useErrorLog";
import {
	createWorkspaceFile,
	deleteWorkspaceItem,
	listWorkspaceFiles,
	readWorkspaceFile,
	writeWorkspaceFile,
} from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/store/workspace/WorkspaceContext";
import { useP2P, useIsViewer } from "@/store/p2p/P2PContext";
import type { WorkspaceFile } from "@/types/workspace";

// Filtered Notes workspace view managing .md documents with rich BlockNote and CodeMirror editing
export default function WorkspaceNotes() {
	const { workspace, refreshMetadata, addActivityEvent } = useWorkspace();
	const logError = useErrorLog();

	// Notes file list
	const [notes, setNotes] = useState<WorkspaceFile[]>([]);
	const [loading, setLoading] = useState(true);
	const [searchQuery, setSearchQuery] = useState("");

	// Active Note Editor
	const [selectedNote, setSelectedNote] = useState<WorkspaceFile | null>(null);
	const [noteContent, setNoteContent] = useState<string>("");
	const [contentLoading, setContentLoading] = useState(false);

	// Modals
	const [isNewNoteOpen, setIsNewNoteOpen] = useState(false);
	const [newNoteTitle, setNewNoteTitle] = useState("");
	const [deletingNote, setDeletingNote] = useState<WorkspaceFile | null>(null);
	const [submitting, setSubmitting] = useState(false);

	// Load all markdown notes in workspace
	const loadNotes = useCallback(async () => {
		if (!workspace?.path) return;
		try {
			setLoading(true);
			// Fetch files from notes root and files root
			const [notesFiles, rootFiles] = await Promise.all([
				listWorkspaceFiles(workspace.path, "notes").catch(() => []),
				listWorkspaceFiles(workspace.path, "files").catch(() => []),
			]);

			const all = [...notesFiles, ...rootFiles].filter(
				(f) =>
					!f.is_dir &&
					(f.name.endsWith(".md") || f.name.endsWith(".markdown")),
			);

			// Deduplicate by path
			const unique = Array.from(new Map(all.map((item) => [item.path, item])).values());
			setNotes(unique);

			// If active note is selected, ensure it still exists
			if (selectedNote) {
				const stillExists = unique.find((n) => n.path === selectedNote.path);
				if (!stillExists && unique.length > 0) {
					setSelectedNote(unique[0]);
				}
			} else if (unique.length > 0) {
				setSelectedNote(unique[0]);
			}
		} catch (err) {
			console.error("Failed to load notes:", err);
			logError(err, { source: "notes" });
		} finally {
			setLoading(false);
		}
	}, [workspace?.path, logError, selectedNote]);

	useEffect(() => {
		loadNotes();
	}, [loadNotes]);

	// Load selected note content from OS disk
	useEffect(() => {
		async function fetchContent() {
			if (!workspace?.path || !selectedNote) {
				setNoteContent("");
				return;
			}
			try {
				setContentLoading(true);
				const relPath = selectedNote.path.replace(/^\/+/, "");
				const text = await readWorkspaceFile(workspace.path, relPath);
				setNoteContent(text);
			} catch (err) {
				console.error("Failed to read note content:", err);
				logError(err, { source: "notes" });
			} finally {
				setContentLoading(false);
			}
		}

		fetchContent();
	}, [workspace?.path, selectedNote, logError]);

	// Reload the note list when a collaborator's changes arrive. The open note itself no longer
	// needs a refetch-and-remount: live edits now flow straight into the editor's Yjs document.
	const { lastSyncedFile } = useP2P();
	useEffect(() => {
		if (!lastSyncedFile || !workspace?.path) return;
		void loadNotes();
	}, [lastSyncedFile]);

	const isViewer = useIsViewer();

	// Save note content to OS disk
	const handleSaveNote = async (newText: string) => {
		if (!workspace?.path || !selectedNote) return;
		try {
			const relPath = selectedNote.path.replace(/^\/+/, "");
			await writeWorkspaceFile(workspace.path, relPath, newText);
			setNoteContent(newText);
			addActivityEvent(
				"Saved note",
				`Edited note ${selectedNote.name}`,
				selectedNote.path,
				"note",
			);
			await refreshMetadata();
		} catch (err) {
			console.error("Failed to save note:", err);
			logError(err, { source: "notes" });
			throw err;
		}
	};

	// Create new markdown note on OS disk
	const handleCreateNoteSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (isViewer || !workspace?.path || !newNoteTitle.trim()) return;

		try {
			setSubmitting(true);
			let filename = newNoteTitle.trim();
			if (!filename.endsWith(".md") && !filename.endsWith(".markdown")) {
				filename += ".md";
			}

			// Save into "notes" subdirectory
			await createWorkspaceFile(workspace.path, "notes", filename);
			addActivityEvent(
				"Created note",
				`Created note ${filename}`,
				`/notes/${filename}`,
				"note",
			);
			setIsNewNoteOpen(false);
			setNewNoteTitle("");
			await loadNotes();
			await refreshMetadata();

			// Auto select newly created note
			const newNotePath = `/notes/${filename}`;
			setSelectedNote({
				name: filename,
				path: newNotePath,
				is_dir: false,
				size: 0,
				modified_at: new Date().toISOString(),
			});
		} catch (err) {
			console.error("Failed to create note:", err);
			logError(err, { source: "notes" });
		} finally {
			setSubmitting(false);
		}
	};

	// Delete Note
	const handleDeleteNote = async () => {
		if (isViewer || !workspace?.path || !deletingNote) return;
		try {
			const relPath = deletingNote.path.replace(/^\/+/, "");
			await deleteWorkspaceItem(workspace.path, relPath);
			addActivityEvent(
				"Deleted note",
				`Deleted note ${deletingNote.name}`,
				undefined,
				"note",
			);
			if (selectedNote?.path === deletingNote.path) {
				setSelectedNote(null);
			}
			setDeletingNote(null);
			await loadNotes();
			await refreshMetadata();
		} catch (err) {
			console.error("Failed to delete note:", err);
			logError(err, { source: "notes" });
		}
	};

	// Filtered notes by search query
	const filteredNotes = useMemo(() => {
		return notes.filter((n) =>
			n.name.toLowerCase().includes(searchQuery.toLowerCase()),
		);
	}, [notes, searchQuery]);

	return (
		<div className="flex h-[calc(100vh-8rem)] gap-4">
			{/* Left Column: Note Navigation List */}
			<div className="flex w-80 shrink-0 flex-col rounded-xl border bg-muted/20 p-3 shadow-2xs">
				{/* Top Header & Search */}
				<div className="flex items-center justify-between pb-3">
					<div className="flex items-center gap-2">
						<StickyNote className="size-5 text-primary" />
						<h2 className="font-semibold text-base">Notes</h2>
						<span className="flex size-5 items-center justify-center rounded-full bg-muted text-[11px] font-bold text-muted-foreground">
							{notes.length}
						</span>
					</div>
					{!isViewer && (
						<Button
							size="sm"
							onPress={() => {
								setNewNoteTitle("");
								setIsNewNoteOpen(true);
							}}
							className="gap-1 px-2.5 h-8"
						>
							<Plus className="size-3.5" />
							New
						</Button>
					)}
				</div>

				{/* Search Input */}
				<div className="relative mb-3">
					<Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
					<Input
						value={searchQuery}
						onChange={(e) => setSearchQuery(e.target.value)}
						placeholder="Search notes…"
						className="h-8 pl-8 text-xs bg-background/70"
					/>
				</div>

				{/* Note List */}
				<div className="flex-1 space-y-1.5 overflow-y-auto pr-1">
					{loading ? (
						<div className="flex h-32 items-center justify-center">
							<Loader2 className="size-5 animate-spin text-muted-foreground" />
						</div>
					) : filteredNotes.length === 0 ? (
						<div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border/60 p-6 text-center text-xs text-muted-foreground">
							{searchQuery
								? "No matching notes found."
								: "No notes yet. Click New to create your first markdown note."}
						</div>
					) : (
						filteredNotes.map((note) => {
							const isSelected = selectedNote?.path === note.path;
							return (
								<div
									key={note.path}
									onClick={() => setSelectedNote(note)}
									className={cn(
										"group flex items-center justify-between gap-2 rounded-lg border p-2.5 transition-all cursor-pointer",
										isSelected
											? "border-primary bg-primary/10 shadow-xs"
											: "border-transparent bg-card/60 hover:border-border hover:bg-muted/40",
									)}
								>
									<div className="min-w-0 flex-1">
										<div className="flex items-center gap-1.5">
											<FileText className="size-3.5 shrink-0 text-sky-400" />
											<p className="truncate text-xs font-semibold text-foreground">
												{note.name.replace(/\.md$/, "")}
											</p>
										</div>
										<p className="mt-0.5 text-[10px] text-muted-foreground truncate">
											{note.path}
										</p>
									</div>

									{!isViewer && (
										<Button
											variant="ghost"
											size="icon-xs"
											className="opacity-0 group-hover:opacity-100 transition-opacity"
											onPress={() => setDeletingNote(note)}
											aria-label={`Delete ${note.name}`}
										>
											<Trash2 className="size-3 text-destructive" />
										</Button>
									)}
								</div>
							);
						})
					)}
				</div>
			</div>

			{/* Right Column: Embedded Rich Editor Container */}
			<div className="flex flex-1 flex-col overflow-hidden rounded-xl border bg-card p-4 shadow-2xs">
				{!selectedNote ? (
					<div className="flex flex-1 flex-col items-center justify-center text-center p-8">
						<div className="flex size-12 items-center justify-center rounded-full bg-muted/60">
							<FileText className="size-6 text-muted-foreground" />
						</div>
						<h3 className="mt-4 font-semibold text-base">Select or create a note</h3>
						<p className="mt-1 max-w-sm text-xs text-muted-foreground">
							Choose a note from the left sidebar to edit with BlockNote rich-text or
							CodeMirror markdown code.
						</p>
						{!isViewer && (
							<Button
								size="sm"
								className="mt-4 gap-1.5"
								onPress={() => setIsNewNoteOpen(true)}
							>
								<Plus className="size-4" />
								Create New Note
							</Button>
						)}
					</div>
				) : contentLoading ? (
					<div className="flex flex-1 items-center justify-center">
						<Loader2 className="size-6 animate-spin text-muted-foreground" />
					</div>
				) : (
					<EditorContainer
						key={selectedNote.path}
						fileName={selectedNote.name}
						initialContent={noteContent}
						onSave={handleSaveNote}
						onClose={() => setSelectedNote(null)}
						readOnly={isViewer}
						workspacePath={workspace?.path}
						docId={selectedNote.path.replace(/^\/+/, "")}
					/>
				)}
			</div>

			{/* New Note Dialog */}
			{isNewNoteOpen && (
				<Dialog
					isOpen={isNewNoteOpen}
					onOpenChange={setIsNewNoteOpen}
					className="max-w-md"
				>
					<form onSubmit={handleCreateNoteSubmit} className="space-y-4">
						<DialogHeader>
							<DialogTitle>New Note</DialogTitle>
							<DialogDescription>
								Create a new Markdown document on the local file system.
							</DialogDescription>
						</DialogHeader>

						<div>
							<Input
								required
								value={newNoteTitle}
								onChange={(e) => setNewNoteTitle(e.target.value)}
								placeholder="e.g. Architecture Overview, Meeting Notes"
								autoFocus
							/>
						</div>

						<DialogFooter>
							<Button
								type="button"
								variant="outline"
								onPress={() => setIsNewNoteOpen(false)}
								isDisabled={submitting}
							>
								Cancel
							</Button>
							<Button
								type="submit"
								isDisabled={submitting || !newNoteTitle.trim()}
							>
								{submitting ? "Creating…" : "Create Note"}
							</Button>
						</DialogFooter>
					</form>
				</Dialog>
			)}

			{/* Delete Note Confirmation Dialog */}
			{deletingNote && (
				<Dialog
					isOpen={!!deletingNote}
					onOpenChange={(open) => !open && setDeletingNote(null)}
				>
					<div className="space-y-4">
						<DialogHeader>
							<DialogTitle>Delete Note</DialogTitle>
							<DialogDescription>
								Are you sure you want to delete{" "}
								<span className="font-semibold text-foreground">
									{deletingNote.name}
								</span>{" "}
								from the disk? This action cannot be undone.
							</DialogDescription>
						</DialogHeader>

						<DialogFooter>
							<Button variant="outline" onPress={() => setDeletingNote(null)}>
								Cancel
							</Button>
							<Button variant="destructive" onPress={handleDeleteNote}>
								Delete
							</Button>
						</DialogFooter>
					</div>
				</Dialog>
			)}
		</div>
	);
}
