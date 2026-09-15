import { useEffect, useRef, useState } from "react";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";

import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";

import { useTheme } from "@/hooks/useTheme";

interface BlockNoteEditorProps {
	initialMarkdown: string;
	onChange: (markdown: string) => void;
	readOnly?: boolean;
}

// Rich-text Markdown block editor powered by BlockNote
export default function BlockNoteEditor({
	initialMarkdown,
	onChange,
	readOnly = false,
}: BlockNoteEditorProps) {
	const { isDark } = useTheme();
	const isUpdatingRef = useRef(false);
	const lastMarkdownRef = useRef(initialMarkdown);
	const [isReady, setIsReady] = useState(false);

	// Initialize BlockNote editor instance
	const editor = useCreateBlockNote();

	// Load initial Markdown blocks into editor once ready
	useEffect(() => {
		async function loadInitialMarkdown() {
			if (!editor) return;
			try {
				isUpdatingRef.current = true;
				if (initialMarkdown.trim()) {
					const blocks = await editor.tryParseMarkdownToBlocks(initialMarkdown);
					editor.replaceBlocks(editor.document, blocks);
				} else {
					editor.replaceBlocks(editor.document, [
						{
							type: "paragraph",
							content: [],
						},
					]);
				}
				lastMarkdownRef.current = initialMarkdown;
				setIsReady(true);
			} catch (err) {
				console.error("Failed to parse markdown to blocks:", err);
				setIsReady(true);
			} finally {
				isUpdatingRef.current = false;
			}
		}

		loadInitialMarkdown();
	}, [editor, initialMarkdown]);

	// Handle block changes and serialize back to markdown
	const handleChange = async () => {
		if (!editor || isUpdatingRef.current) return;
		try {
			const markdown = await editor.blocksToMarkdownLossy(editor.document);
			if (markdown !== lastMarkdownRef.current) {
				lastMarkdownRef.current = markdown;
				onChange(markdown);
			}
		} catch (err) {
			console.error("Failed to serialize blocks to markdown:", err);
		}
	};

	return (
		<div className="h-full w-full overflow-y-auto rounded-lg border bg-card p-4 transition-colors">
			{!isReady ? (
				<div className="flex h-48 items-center justify-center">
					<p className="text-xs uppercase tracking-widest text-muted-foreground animate-pulse">
						Loading Rich Notes Editor…
					</p>
				</div>
			) : (
				<BlockNoteView
					editor={editor}
					theme={isDark ? "dark" : "light"}
					editable={!readOnly}
					onChange={handleChange}
					className="min-h-[400px] text-sm"
				/>
			)}
		</div>
	);
}
