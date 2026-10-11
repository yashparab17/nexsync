// The rendered view of a Markdown text, as in Obsidian's reading view: headings, lists, code, tables and task lists, with
// [[note links]] that open the note. Everything is sanitized, since the text may have been written by a collaborator.

import { useMemo } from "react";
import DOMPurify from "dompurify";
import { marked } from "marked";

import { resolveLink, type NoteRef } from "@/lib/notes/links";

interface MarkdownPreviewProps {
	text: string;
	// The notes a [[link]] can point at; links to notes that do not exist show as unresolved
	notes?: NoteRef[];
	onOpenNote?: (note: NoteRef) => void;
}

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);

// [[Target]] and [[Target|shown text]] become links the preview can catch; code is left alone
function withWikiLinks(text: string, notes: NoteRef[]): string {
	let fenced = false;
	return text
		.split("\n")
		.map((line) => {
			if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
			if (fenced) return line;
			return line.replace(/\[\[([^\]\n|]+)(?:\|([^\]\n]*))?\]\]/g, (_m, target: string, alias?: string) => {
				const shown = (alias ?? target).trim();
				const exists = !!resolveLink(target.trim(), notes);
				return `<a href="#" data-wikilink="${escapeHtml(target.trim())}" class="${exists ? "wikilink" : "wikilink wikilink-missing"}">${escapeHtml(shown)}</a>`;
			});
		})
		.join("\n");
}

export default function MarkdownPreview({ text, notes = [], onOpenNote }: MarkdownPreviewProps) {
	const html = useMemo(() => {
		const raw = marked.parse(withWikiLinks(text, notes), { async: false, gfm: true }) as string;
		return DOMPurify.sanitize(raw, { ADD_ATTR: ["data-wikilink"], FORBID_TAGS: ["style", "form"] });
	}, [text, notes]);

	const onClick = (e: React.MouseEvent) => {
		const link = (e.target as HTMLElement).closest("a");
		if (!link) return;
		e.preventDefault();
		const target = link.getAttribute("data-wikilink");
		if (target) {
			const note = resolveLink(target, notes);
			if (note) onOpenNote?.(note);
			return;
		}
		const href = link.getAttribute("href") ?? "";
		if (/^https?:\/\//i.test(href)) void import("@tauri-apps/plugin-opener").then((m) => m.openUrl(href)).catch(() => {});
	};

	return (
		// eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
		<div className="md-preview h-full overflow-y-auto px-8 py-6" onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />
	);
}
