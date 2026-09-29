import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BlockNoteSchema, defaultBlockSpecs } from "@blocknote/core";
import { withCollaboration } from "@blocknote/core/yjs";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";

import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";

import { useSeedOnce } from "@/hooks/useSeedOnce";
import type { CollabDoc } from "@/hooks/useCollabDoc";
import { colorForName } from "@/lib/collabColor";
import { blocksToPlainText, plainTextToBlocks } from "@/lib/notes/text";
import { useThemeContext } from "@/store/ThemeContext";

interface RichTextEditorProps {
	// The note as it is on disk; used to fill the document the first time it is opened
	initialText: string;
	// Called with the note as plain text, once the editor is ready and after every change
	onChange: (plainText: string) => void;
	readOnly?: boolean;
	// Live P2P-synced document; the editor mirrors its "blocknote" fragment
	collab?: CollabDoc | null;
	userName?: string;
	// Hands over a function that replaces the whole note, so an older version can be put back
	onReady?: (replaceText: (text: string) => void) => void;
}

// A plain text file can hold paragraphs, headings and lists, but not images or code blocks
const { paragraph, heading, bulletListItem, numberedListItem, checkListItem } = defaultBlockSpecs;
const schema = BlockNoteSchema.create({
	blockSpecs: { paragraph, heading, bulletListItem, numberedListItem, checkListItem },
});

// Rich-text editor for text notes (.txt). The file on disk holds the words and line breaks; formatting
// lives in the shared document, so collaborators see it but the file itself stays plain text.
export default function RichTextEditor({
	initialText,
	onChange,
	readOnly = false,
	collab = null,
	userName = "You",
	onReady,
}: RichTextEditorProps) {
	const { isDark } = useThemeContext();
	const lastReported = useRef<string | null>(null);
	const [localReady, setLocalReady] = useState(false);

	const options = useMemo(
		() =>
			collab
				? withCollaboration({
						schema,
						collaboration: {
							fragment: collab.doc.getXmlFragment("blocknote"),
							user: { name: userName, color: colorForName(userName) },
							provider: { awareness: collab.awareness },
						},
					})
				: { schema },
		[collab, userName],
	);
	const editor = useCreateBlockNote(options, [collab?.doc]);

	useEffect(() => {
		onReady?.((text) => editor.replaceBlocks(editor.document, plainTextToBlocks(text) as never));
	}, [editor, onReady]);

	// Tell the note what the editor holds, but only when that changed
	const report = useCallback(() => {
		const text = blocksToPlainText(editor.document as never);
		if (text === lastReported.current) return;
		lastReported.current = text;
		onChange(text);
	}, [editor, onChange]);

	// Without a live document, load the file once
	useEffect(() => {
		if (collab) return;
		editor.replaceBlocks(editor.document, plainTextToBlocks(initialText) as never);
		setLocalReady(true);
		report();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [editor, collab]);

	// With a live document, fill it from the file the first time it is ever opened
	useSeedOnce(
		!!collab?.synced,
		() => {
			if (!collab) return;
			const fragment = collab.doc.getXmlFragment("blocknote");
			if (fragment.length === 0 && initialText.trim()) {
				editor.replaceBlocks(editor.document, plainTextToBlocks(initialText) as never);
			}
			report();
		},
		[collab, editor, initialText],
	);

	const isReady = collab ? collab.synced : localReady;

	return (
		<div className="h-full w-full overflow-y-auto bg-background px-2 py-4 [&_.bn-container]:max-w-3xl [&_.bn-editor]:bg-transparent">
			{!isReady ? (
				<div className="flex h-48 items-center justify-center">
					<p className="animate-pulse text-xs uppercase tracking-widest text-muted-foreground">Loading note…</p>
				</div>
			) : (
				<BlockNoteView
					editor={editor}
					theme={isDark ? "dark" : "light"}
					editable={!readOnly}
					onChange={report}
					className="min-h-[400px] text-sm"
				/>
			)}
		</div>
	);
}
