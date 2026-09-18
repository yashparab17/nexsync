import { useEffect, useMemo, useState } from "react";
import {
	Check,
	Code2,
	FileText,
	Loader2,
	Maximize2,
	Minimize2,
	Save,
	Sparkles,
	X,
} from "lucide-react";

import { Button } from "@/components/ui/button";

import BlockNoteEditor from "./BlockNoteEditor";
import CodeEditor from "./CodeEditor";
import { cn } from "@/lib/utils";

interface EditorContainerProps {
	fileName: string;
	initialContent: string;
	onSave: (content: string) => Promise<void>;
	onClose: () => void;
	readOnly?: boolean;
	autosave?: boolean;
}

// Unified dual-mode Editor Container dynamically switching between Rich-text BlockNote and CodeMirror
export default function EditorContainer({
	fileName,
	initialContent,
	onSave,
	onClose,
	readOnly = false,
	autosave: _autosave = true,
}: EditorContainerProps) {
	const isMarkdown = useMemo(() => {
		const ext = fileName.split(".").pop()?.toLowerCase();
		return ext === "md" || ext === "markdown";
	}, [fileName]);

	// Editor state
	const [content, setContent] = useState(initialContent);
	const [mode, setMode] = useState<"rich" | "raw">(
		isMarkdown ? "rich" : "raw",
	);
	const [isSaving, setIsSaving] = useState(false);
	const [savedSuccess, setSavedSuccess] = useState(false);
	const [isDirty, setIsDirty] = useState(false);
	const [isFullscreen, setIsFullscreen] = useState(false);

	// Sync content when initialContent changes
	useEffect(() => {
		setContent(initialContent);
		setIsDirty(false);
	}, [initialContent]);

	// Handle editor content change
	const handleContentChange = (newContent: string) => {
		setContent(newContent);
		setIsDirty(newContent !== initialContent);
	};

	// Save action
	const handleSave = async () => {
		if (isSaving) return;
		try {
			setIsSaving(true);
			await onSave(content);
			setIsDirty(false);
			setSavedSuccess(true);
			setTimeout(() => setSavedSuccess(false), 2000);
		} catch (err) {
			console.error("Save failed:", err);
		} finally {
			setIsSaving(false);
		}
	};

	// Keyboard shortcuts (Ctrl+S / Cmd+S to save, Esc to close if clean)
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if ((e.ctrlKey || e.metaKey) && e.key === "s") {
				e.preventDefault();
				handleSave();
			}
			if (e.key === "Escape" && !isDirty) {
				onClose();
			}
		};

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [content, isDirty, isSaving]);

	// Calculate word and line counts
	const stats = useMemo(() => {
		const lines = content.split("\n").length;
		const words = content.trim() ? content.trim().split(/\s+/).length : 0;
		const chars = content.length;
		return { lines, words, chars };
	}, [content]);

	return (
		<div
			className={cn(
				"flex flex-col bg-background transition-all",
				isFullscreen
					? "fixed inset-0 z-50 p-6 backdrop-blur-md"
					: "h-full w-full",
			)}
		>
			{/* Top Editor Header Bar */}
			<div className="flex flex-wrap items-center justify-between gap-3 border-b pb-3 mb-3">
				{/* Left: File details & unsaved indicator */}
				<div className="flex items-center gap-2">
					<Button
						variant="ghost"
						size="icon-xs"
						onPress={onClose}
						aria-label="Close editor"
					>
						<X className="size-4" />
					</Button>

					<div className="flex items-center gap-2">
						{isMarkdown ? (
							<FileText className="size-4 text-sky-400" />
						) : (
							<Code2 className="size-4 text-amber-400" />
						)}
						<span className="font-semibold text-sm">{fileName}</span>
					</div>

					{isDirty ? (
						<span className="flex items-center gap-1 text-[11px] font-medium text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full">
							<span className="size-1.5 rounded-full bg-amber-400 animate-pulse" />
							Unsaved changes
						</span>
					) : (
						<span className="text-[11px] text-muted-foreground flex items-center gap-1">
							<Check className="size-3 text-emerald-400" />
							Saved to disk
						</span>
					)}
				</div>

				{/* Right: Controls & Actions */}
				<div className="flex items-center gap-2">
					{/* Markdown Mode Toggle (Rich Text vs Raw Code) */}
					{isMarkdown && (
						<div className="flex items-center rounded-lg border bg-muted/40 p-0.5 text-xs">
							<button
								type="button"
								onClick={() => setMode("rich")}
								className={cn(
									"flex items-center gap-1 rounded-md px-2.5 py-1 transition-colors cursor-pointer",
									mode === "rich"
										? "bg-background text-foreground font-semibold shadow-xs"
										: "text-muted-foreground hover:text-foreground",
								)}
							>
								<Sparkles className="size-3" />
								Rich Text
							</button>
							<button
								type="button"
								onClick={() => setMode("raw")}
								className={cn(
									"flex items-center gap-1 rounded-md px-2.5 py-1 transition-colors cursor-pointer",
									mode === "raw"
										? "bg-background text-foreground font-semibold shadow-xs"
										: "text-muted-foreground hover:text-foreground",
								)}
							>
								<Code2 className="size-3" />
								Markdown Code
							</button>
						</div>
					)}

					{/* Stats Badge */}
					<div className="hidden sm:flex items-center gap-2 text-[11px] text-muted-foreground font-mono bg-muted/20 px-2.5 py-1 rounded-md border">
						<span>{stats.lines} lines</span>
						<span>•</span>
						<span>{stats.words} words</span>
						<span>•</span>
						<span>{stats.chars} chars</span>
					</div>

					{/* Fullscreen Toggle */}
					<Button
						variant="ghost"
						size="icon-xs"
						onPress={() => setIsFullscreen(!isFullscreen)}
						aria-label={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
					>
						{isFullscreen ? (
							<Minimize2 className="size-3.5" />
						) : (
							<Maximize2 className="size-3.5" />
						)}
					</Button>

					{/* Save Button */}
					<Button
						size="sm"
						onPress={handleSave}
						isDisabled={isSaving || (!isDirty && !savedSuccess)}
						className="gap-1.5"
					>
						{isSaving ? (
							<Loader2 className="size-3.5 animate-spin" />
						) : savedSuccess ? (
							<Check className="size-3.5 text-emerald-400" />
						) : (
							<Save className="size-3.5" />
						)}
						{isSaving ? "Saving…" : savedSuccess ? "Saved!" : "Save"}
					</Button>
				</div>
			</div>

			{/* Main Editor Canvas */}
			<div className="flex-1 min-h-0">
				{isMarkdown && mode === "rich" ? (
					<BlockNoteEditor
						initialMarkdown={content}
						onChange={handleContentChange}
						readOnly={readOnly}
					/>
				) : (
					<CodeEditor
						value={content}
						fileName={fileName}
						onChange={handleContentChange}
						readOnly={readOnly}
					/>
				)}
			</div>
		</div>
	);
}
