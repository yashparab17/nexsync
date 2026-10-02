import { useEffect, useMemo, useRef, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { lintGutter } from "@codemirror/lint";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { vscodeDark, vscodeLight } from "@uiw/codemirror-theme-vscode";
import { yCollab, yUndoManagerKeymap } from "y-codemirror.next";

import { useThemeContext } from "@/store/ThemeContext";
import { colorForName } from "@/lib/collabColor";
import { loadLanguage, type LoadedLanguage } from "@/lib/editor/languages";
import { syntaxLinter } from "@/lib/editor/syntax";
import { useEditorPrefs } from "@/lib/editorPrefs";
import { useSeedOnce } from "@/hooks/useSeedOnce";
import { seedText } from "@/lib/yjs/seed";
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
	// Called with the editor view once it exists, so a page can format, search or jump to a line
	onReady?: (view: EditorView) => void;
	// Called when the language for the file is known
	onLanguage?: (language: LoadedLanguage) => void;
	// Extra CodeMirror extensions, for example clickable note links
	extraExtensions?: Extension[];
}

const PLAIN: LoadedLanguage = { name: "Plain Text", support: null };

// CodeMirror code editor with lazily loaded language support, syntax problem markers, a VS Code theme and optional live Yjs collaboration
export default function CodeEditor({
	value,
	fileName = "file.txt",
	onChange,
	readOnly = false,
	minHeight = "400px",
	collab = null,
	userName = "You",
	onReady,
	onLanguage,
	extraExtensions,
}: CodeEditorProps) {
	const { isDark } = useThemeContext();

	// A live document that already exists when the editor is created must be its starting text: the sync
	// layer applies only later changes, so an editor started empty would stay blank.
	const startedWithCollab = useRef(!!collab);
	const startingText = useRef(collab ? collab.doc.getText("content").toString() : "");

	// The grammar for this file type is fetched the first time a file of that type is opened
	const [language, setLanguage] = useState<LoadedLanguage>(PLAIN);
	useEffect(() => {
		let current = true;
		void loadLanguage(fileName).then((loaded) => {
			if (!current) return;
			setLanguage(loaded);
			onLanguage?.(loaded);
		});
		return () => {
			current = false;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [fileName]);

	const languageExtensions = useMemo(() => {
		if (!language.support) return [];
		return [language.support, syntaxLinter, lintGutter()];
	}, [language]);

	// Look and feel from Settings; Markdown always wraps, since its lines are prose
	const { fontSize, tabSize, wrap } = useEditorPrefs();
	const lookExtensions = useMemo(
		() => [
			EditorView.theme({ "&": { fontSize: `${fontSize}px` } }),
			EditorState.tabSize.of(tabSize),
			...(wrap || language.name === "Markdown" ? [EditorView.lineWrapping] : []),
		],
		[fontSize, tabSize, wrap, language.name],
	);

	// Seed the shared text from on-disk content the first time it's ever opened
	useSeedOnce(
		!!collab?.synced,
		() => {
			if (!collab) return;
			seedText(collab.doc, value);
		},
		[collab, value],
	);

	// Presence is announced from an effect, not while rendering, because it makes the editor update
	const awareness = collab?.awareness;
	useEffect(() => {
		awareness?.setLocalStateField("user", { name: userName, color: colorForName(userName) });
	}, [awareness, userName]);

	const extensions = useMemo(() => {
		if (!collab) return [...languageExtensions, ...lookExtensions, ...(extraExtensions ?? [])];
		return [
			...languageExtensions,
			...lookExtensions,
			...(extraExtensions ?? []),
			yCollab(collab.doc.getText("content"), collab.awareness),
			// Route Ctrl+Z/Ctrl+Y through yCollab's Y.UndoManager instead of CodeMirror's own
			// history (disabled below via basicSetup), so undo only reverts local edits rather
			// than fighting the shared CRDT state.
			keymap.of(yUndoManagerKeymap),
		];
	}, [languageExtensions, lookExtensions, extraExtensions, collab]);

	return (
		<div className="h-full w-full overflow-hidden border-t bg-background font-mono text-xs">
			<CodeMirror
				{...(collab ? (startedWithCollab.current ? { value: startingText.current } : {}) : { value })}
				height="100%"
				minHeight={minHeight}
				theme={isDark ? vscodeDark : vscodeLight}
				extensions={extensions}
				onChange={onChange}
				onCreateEditor={onReady}
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
