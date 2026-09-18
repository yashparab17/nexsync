import { useMemo } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { rust } from "@codemirror/lang-rust";
import { oneDark } from "@codemirror/theme-one-dark";

import { useTheme } from "@/hooks/useTheme";

interface CodeEditorProps {
	value: string;
	fileName?: string;
	onChange: (value: string) => void;
	readOnly?: boolean;
	minHeight?: string;
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

// CodeMirror code editor supporting multiple programming languages and dark theme
export default function CodeEditor({
	value,
	fileName = "file.txt",
	onChange,
	readOnly = false,
	minHeight = "400px",
}: CodeEditorProps) {
	const { isDark } = useTheme();

	// Configure syntax highlighting extensions based on filename
	const extensions = useMemo(() => {
		return getLanguageExtension(fileName);
	}, [fileName]);

	return (
		<div className="h-full w-full overflow-hidden rounded-lg border bg-background font-mono text-xs">
			<CodeMirror
				value={value}
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
					history: true,
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
					historyKeymap: true,
					foldKeymap: true,
					completionKeymap: true,
					lintKeymap: true,
				}}
				className="h-full [&_.cm-editor]:h-full [&_.cm-scroller]:overflow-auto"
			/>
		</div>
	);
}
