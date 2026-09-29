// Which files are notes, which are documents for other apps, and how to highlight code

import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { LanguageDescription, type LanguageSupport } from "@codemirror/language";
import { languages } from "@codemirror/language-data";

// Text the Notes page can edit
const NOTE_EXTENSIONS = ["md", "markdown", "txt", "text"];
// Documents other apps edit; Notes lists them and opens them in the system app
const DOCUMENT_EXTENSIONS = ["doc", "docx", "odt", "rtf", "pdf", "ppt", "pptx", "xls", "xlsx", "csv"];
// Files that are not text at all, so no editor can show them
const BINARY_EXTENSIONS = [
	"png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "svg", "mp3", "wav", "mp4", "mov", "webm",
	"zip", "gz", "7z", "rar", "exe", "dll", "bin", "woff", "woff2", "ttf", "otf",
];

export function extensionOf(fileName: string): string {
	const dot = fileName.lastIndexOf(".");
	return dot > 0 ? fileName.slice(dot + 1).toLowerCase() : "";
}

export const isMarkdownFile = (fileName: string) => ["md", "markdown"].includes(extensionOf(fileName));
export const isNoteFile = (fileName: string) => NOTE_EXTENSIONS.includes(extensionOf(fileName));
export const isDocumentFile = (fileName: string) => DOCUMENT_EXTENSIONS.includes(extensionOf(fileName));
export const isBinaryFile = (fileName: string) => BINARY_EXTENSIONS.includes(extensionOf(fileName));

// Where a file opens: notes for text documents, the system app for binaries and office files, the code editor otherwise
export function editorRouteFor(fileName: string): "notes" | "system" | "editor" {
	if (isNoteFile(fileName)) return "notes";
	if (isDocumentFile(fileName) || isBinaryFile(fileName)) return "system";
	return "editor";
}

export interface LoadedLanguage {
	name: string;
	support: LanguageSupport | null;
}

// Loads the CodeMirror language for a file name; the grammar is fetched only when a file of that type is opened
export async function loadLanguage(fileName: string): Promise<LoadedLanguage> {
	const ext = extensionOf(fileName);
	if (ext === "md" || ext === "markdown") {
		// Fenced code blocks inside Markdown get their own language highlighting
		return { name: "Markdown", support: markdown({ base: markdownLanguage, codeLanguages: languages }) };
	}
	const description = LanguageDescription.matchFilename(languages, fileName);
	if (!description) return { name: "Plain Text", support: null };
	try {
		return { name: description.name, support: await description.load() };
	} catch {
		return { name: description.name, support: null };
	}
}
