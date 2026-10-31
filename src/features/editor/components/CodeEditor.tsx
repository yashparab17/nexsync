import { useEffect, useMemo, useRef, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { acceptCompletion, autocompletion } from "@codemirror/autocomplete";
import { lintGutter } from "@codemirror/lint";
import { EditorState, Prec, type Extension } from "@codemirror/state";
import { EditorView, GutterMarker, gutter, keymap, lineNumbers } from "@codemirror/view";
import { codeLook } from "@/lib/editor/codeTheme";
import { yCollab, yUndoManagerKeymap } from "y-codemirror.next";
import { UndoManager } from "yjs";

import { useThemeContext } from "@/store/ThemeContext";
import { colorOf } from "@/lib/collabColor";
import { loadLanguage, type LoadedLanguage } from "@/lib/editor/languages";
import { syntaxLinter } from "@/lib/editor/syntax";
import { useEditorPrefs } from "@/lib/editorPrefs";
import { useSeedOnce } from "@/hooks/useSeedOnce";
import { seedText } from "@/lib/yjs/seed";
import type { CollabDoc } from "@/hooks/useCollabDoc";
import { leaderKeys, vimCommands, type VimCommand } from "@/lib/editor/vimSetup";

// Where the cursor is, for the status line
export interface CursorInfo {
	line: number;
	col: number;
	lines: number;
	// Characters and lines selected; 0 when nothing is
	selected: number;
	selectedLines: number;
}

function cursorOf(state: EditorState): CursorInfo {
	const sel = state.selection.main;
	const line = state.doc.lineAt(sel.head);
	return {
		line: line.number,
		col: sel.head - line.from + 1,
		lines: state.doc.lines,
		selected: sel.to - sel.from,
		selectedLines: sel.empty ? 0 : state.doc.lineAt(sel.to).number - state.doc.lineAt(sel.from).number + 1,
	};
}

// Line numbers counted from the cursor line, as in Neovim's relativenumber; the cursor line shows its own number
class NumberMarker extends GutterMarker {
	constructor(private readonly text: string) {
		super();
	}
	eq(other: NumberMarker) {
		return other.text === this.text;
	}
	toDOM() {
		return document.createTextNode(this.text);
	}
}
const relativeLineNumbers = gutter({
	class: "cm-lineNumbers",
	lineMarker(view, line) {
		const here = view.state.doc.lineAt(view.state.selection.main.head).number;
		const n = view.state.doc.lineAt(line.from).number;
		return new NumberMarker(String(n === here ? n : Math.abs(n - here)));
	},
	lineMarkerChange: (update) => update.selectionSet || update.docChanged || update.viewportChanged,
	initialSpacer: (view) => new NumberMarker(String(view.state.doc.lines)),
});

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
	// Told where the cursor is after every move or edit
	onCursor?: (info: CursorInfo) => void;
	// With Vim keys on: the mode changes (normal, insert, visual, replace), and the commands typed after a colon or Space
	onVimMode?: (mode: string) => void;
	onVimCommand?: (command: VimCommand) => void;
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
	onCursor,
	onVimMode,
	onVimCommand,
}: CodeEditorProps) {
	const { isDark } = useThemeContext();
	const viewRef = useRef<EditorView | null>(null);
	// Read through refs, so a new callback each render does not rebuild the editor
	const cursorRef = useRef(onCursor);
	cursorRef.current = onCursor;
	const modeRef = useRef(onVimMode);
	modeRef.current = onVimMode;
	const commandRef = useRef(onVimCommand);
	commandRef.current = onVimCommand;
	// Whether Vim is in normal mode, for the Space-prefixed commands
	const normalRef = useRef(false);
	const leader = useMemo(() => leaderKeys(() => normalRef.current, (command) => commandRef.current?.(command)), []);

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
	const { fontSize, tabSize, wrap, vim, relativeNumbers, minimap } = useEditorPrefs();

	// Vim keys load on first use, so people who never turn them on do not download them
	const [vimExtension, setVimExtension] = useState<Extension | null>(null);
	useEffect(() => {
		if (!vim) {
			setVimExtension(null);
			return;
		}
		let current = true;
		void import("@replit/codemirror-vim").then((mod) => {
			if (current) setVimExtension(mod.vim({ status: false }));
		});
		return () => {
			current = false;
		};
	}, [vim]);

	// The minimap loads the same way
	const [minimapExtension, setMinimapExtension] = useState<Extension | null>(null);
	useEffect(() => {
		if (!minimap) {
			setMinimapExtension(null);
			return;
		}
		let current = true;
		void import("@replit/codemirror-minimap").then((mod) => {
			if (current)
				setMinimapExtension(
					mod.showMinimap.compute(["doc"], () => ({
						create: () => ({ dom: document.createElement("div") }),
						displayText: "blocks",
						showOverlay: "mouse-over",
					})),
				);
		});
		return () => {
			current = false;
		};
	}, [minimap]);

	// Mode changes and the colon and Space commands reach the page through the vim module
	const [viewReady, setViewReady] = useState(false);
	useEffect(() => {
		const view = viewRef.current;
		if (!vimExtension || !view) {
			modeRef.current?.("");
			return;
		}
		let off: (() => void) | undefined;
		void import("@replit/codemirror-vim").then((mod) => {
			const cm = mod.getCM(view);
			if (!cm) return;
			vimCommands(mod, cm, (command) => commandRef.current?.(command));
			const listener = (event: { mode: string; subMode?: string }) => {
				normalRef.current = event.mode === "normal";
				modeRef.current?.(event.subMode ? `${event.mode}:${event.subMode}` : event.mode);
			};
			cm.on("vim-mode-change", listener);
			normalRef.current = true;
			modeRef.current?.("normal");
			off = () => {
				normalRef.current = false;
				cm.off("vim-mode-change", listener);
			};
		});
		return () => off?.();
	}, [vimExtension, viewReady]);

	const cursorExtension = useMemo(
		() =>
			EditorView.updateListener.of((update) => {
				if (!update.selectionSet && !update.docChanged && !update.viewportChanged) return;
				cursorRef.current?.(cursorOf(update.state));
			}),
		[],
	);
	const lookExtensions = useMemo(
		() => [
			...codeLook(isDark),
			EditorView.theme({
				"&": { fontSize: `${fontSize}px`, backgroundColor: "var(--background)" },
				".cm-scroller": { fontFamily: "var(--font-mono)" },
				".cm-gutters": { backgroundColor: "var(--sidebar)", borderRight: "1px solid var(--border)" },
			}),
			EditorState.tabSize.of(tabSize),
			relativeNumbers ? relativeLineNumbers : lineNumbers(),
			cursorExtension,
			...(vimExtension ? [Prec.highest(EditorView.domEventHandlers({ keydown: (e) => leader(e) && (e.preventDefault(), e.stopPropagation(), true) })), vimExtension] : []),
			...(minimapExtension ? [minimapExtension] : []),
			...(wrap || language.name === "Markdown" ? [EditorView.lineWrapping] : []),
				// Suggestions only while writing code: none open on their own in prose or a plain file. None is chosen until the arrow keys pick one, so Enter
				// still makes a new line; Tab takes the shown one,
				autocompletion({ activateOnTyping: !["Markdown", "Plain Text"].includes(language.name), selectOnOpen: false, icons: false, maxRenderedOptions: 30 }),
				Prec.high(keymap.of([{ key: "Tab", run: acceptCompletion }])),
		],
		[isDark, fontSize, tabSize, wrap, language.name, relativeNumbers, cursorExtension, vimExtension, minimapExtension, leader],
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
		awareness?.setLocalStateField("user", { name: userName, color: colorOf(userName) });
	}, [awareness, userName]);

	// One undo history for as long as the shared text lasts. yCollab would make a new one each time the extensions are rebuilt (a comment
	// or suggestion arriving does that), which silently emptied the history.
	const undoManager = useMemo(() => (collab ? new UndoManager(collab.doc.getText("content")) : null), [collab]);
	const extensions = useMemo(() => {
		if (!collab) return [...languageExtensions, ...lookExtensions, ...(extraExtensions ?? [])];
		return [
			...languageExtensions,
			...lookExtensions,
			...(extraExtensions ?? []),
			yCollab(collab.doc.getText("content"), collab.awareness, undoManager ? { undoManager } : undefined),
			// Route Ctrl+Z/Ctrl+Y through yCollab's Y.UndoManager instead of CodeMirror's own
			// history (disabled below via basicSetup), so undo only reverts local edits rather
			// than fighting the shared CRDT state.
			keymap.of(yUndoManagerKeymap),
		];
	}, [languageExtensions, lookExtensions, extraExtensions, collab, undoManager]);

	return (
		<div className="h-full w-full overflow-hidden border-t bg-background font-mono text-xs">
			<CodeMirror
				{...(collab ? (startedWithCollab.current ? { value: startingText.current } : {}) : { value })}
				height="100%"
				minHeight={minHeight}
				theme="none"
				extensions={extensions}
				onChange={onChange}
				onCreateEditor={(view) => {
					viewRef.current = view;
					cursorRef.current?.(cursorOf(view.state));
					setViewReady(true);
					onReady?.(view);
				}}
				readOnly={readOnly}
				basicSetup={{
					lineNumbers: false,
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
					autocompletion: false,
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
