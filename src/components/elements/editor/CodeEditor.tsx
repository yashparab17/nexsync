import { useMemo } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { rust } from "@codemirror/lang-rust";
import { oneDark } from "@codemirror/theme-one-dark";
import { keymap } from "@codemirror/view";
import { yCollab, yUndoManagerKeymap } from "y-codemirror.next";

import { useThemeContext } from "@/store/ThemeContext";
import { colorForName } from "@/lib/collabColor";
import { useSeedOnce } from "@/hooks/useSeedOnce";
import type { CollabDoc } from "@/hooks/useCollabDoc";

interface CodeEditorProps {
	value: string;
	fileName?: string;
	onChange: (value: string) => void;
	readOnly?: boolean;
	minHeight?: string;
	// Live P2P-synced document; when present the editor mirrors this doc's
	// "content" Y.Text instead of the controlled `value` prop
	collab?: CollabDoc | null;
	userName?: string;
}

// Determines the CodeMirror language extension from the file extension
function getLanguageExtension(fileName: string) {
	const ext = fileName.split(".").pop()?.toLowerCase() || "";
	switch (ext) {
		case "js":
		case "mjs":
		case "cjs":
			return [javascript({ jsx: false, typescript: false })];
		case "jsx":
			return [javascript({ jsx: true, typescript: false })];
		case "ts":
			return [javascript({ jsx: false, typescript: true })];
		case "tsx":
			return [javascript({ jsx: true, typescript: true })];
		case "json":
			return [json()];
		case "rs":
			return [rust()];
		case "html":
		case "htm":
			return [html()];
		case "css":
		case "scss":
		case "less":
			return [css()];
		case "md":
		case "markdown":
			return [markdown()];
		default:
			return [];
	}
}

// CodeMirror code editor supporting multiple programming languages, dark theme, and optional live Yjs collaboration
export default function CodeEditor({
	value,
	fileName = "file.txt",
	onChange,
	readOnly = false,
	minHeight = "400px",
	collab = null,
	userName = "You",
}: CodeEditorProps) {
	const { isDark } = useThemeContext();

	// Configure syntax highlighting extensions based on filename
	const languageExtensions = useMemo(() => {
		return getLanguageExtension(fileName);
	}, [fileName]);

	// Seed the shared text from on-disk content the first time it's ever opened
	useSeedOnce(
		!!collab?.synced,
		() => {
			if (!collab) return;
			const ytext = collab.doc.getText("content");
			if (ytext.length === 0 && value) {
				ytext.insert(0, value);
			}
		},
		[collab, value],
	);

	const extensions = useMemo(() => {
		if (!collab) return languageExtensions;
		collab.awareness.setLocalStateField("user", {
			name: userName,
			color: colorForName(userName),
		});
		return [
			...languageExtensions,
			yCollab(collab.doc.getText("content"), collab.awareness),
			// Route Ctrl+Z/Ctrl+Y through yCollab's Y.UndoManager instead of CodeMirror's own
			// history (disabled below via basicSetup), so undo only reverts local edits rather
			// than fighting the shared CRDT state.
			keymap.of(yUndoManagerKeymap),
		];
	}, [languageExtensions, collab, userName]);

	return (
		<div className="h-full w-full overflow-hidden rounded-lg border bg-background font-mono text-xs">
			<CodeMirror
				{...(collab ? {} : { value })}
				height="100%"
				minHeight={minHeight}
				theme={isDark ? oneDark : "light"}
				extensions={extensions}
				onChange={onChange}
				readOnly={readOnly}
				basicSetup={{
					lineNumbers: true,
					highlightActiveLineGutter: true,
					highlightSpecialChars: true,
					// yCollab supplies its own CRDT-aware undo/redo when collaborating (see extensions above)
					history: !collab,
					foldGutter: true,
					drawSelection: true,
					dropCursor: true,
					allowMultipleSelections: true,
					indentOnInput: true,
					syntaxHighlighting: true,
					bracketMatching: true,
					closeBrackets: true,
					autocompletion: true,
					rectangularSelection: true,
					crosshairCursor: true,
					highlightActiveLine: true,
					highlightSelectionMatches: true,
					closeBracketsKeymap: true,
					defaultKeymap: true,
					searchKeymap: true,
					historyKeymap: !collab,
					foldKeymap: true,
					completionKeymap: true,
					lintKeymap: true,
				}}
				className="h-full [&_.cm-editor]:h-full [&_.cm-scroller]:overflow-auto"
			/>
		</div>
	);
}
