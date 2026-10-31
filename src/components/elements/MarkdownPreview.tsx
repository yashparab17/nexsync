// The rendered view of a Markdown text, as in Obsidian's reading view: headings, lists, code, tables and task lists, with
// [[note links]] that open the note. Everything is sanitized, since the text may have been written by a collaborator.

import { useEffect, useMemo, useRef } from "react";
import DOMPurify from "dompurify";
import { marked } from "marked";

import { resolveLink, type NoteRef } from "@/features/notes/lib/links";
import { LAYOUT } from "@/lib/workspaceLayout";
import { readWorkspaceBinaryFile, readWorkspaceFile } from "@/lib/tauri";

interface MarkdownPreviewProps {
	text: string;
	// The notes a [[link]] can point at; links to notes that do not exist show as unresolved
	notes?: NoteRef[];
	onOpenNote?: (note: NoteRef) => void;
	// With these, pictures and embedded notes load: ![](pictures/a.png), ![[a.png]] and ![[Another note]]. `from` is the note's own path.
	workspacePath?: string;
	from?: string;
}

const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", bmp: "image/bmp", avif: "image/avif" };
const extOf = (name: string) => name.split(".").pop()?.toLowerCase() ?? "";
const dirOf = (path: string) => path.split("/").slice(0, -1).join("/");

// Where a picture named in a note may be: beside the note, in the workspace's assets, or at the given path from the workspace
function pictureCandidates(name: string, from: string): string[] {
	const clean = name.replace(/^\.?\//, "").split(/[?#]/)[0];
	const beside = [dirOf(from), clean].filter(Boolean).join("/");
	return clean.includes("/") ? [beside, clean, `${LAYOUT.assets}/${clean}`] : [`${LAYOUT.assets}/${clean}`, beside, `${LAYOUT.notes}/${clean}`];
}

async function loadPicture(workspacePath: string, name: string, from: string): Promise<string | null> {
	const mime = MIME[extOf(name.split(/[?#]/)[0])];
	if (!mime) return null;
	for (const rel of pictureCandidates(decodeURI(name), from)) {
		try {
			return `data:${mime};base64,${await readWorkspaceBinaryFile(workspacePath, rel)}`;
		} catch {
			// Not there; the next place
		}
	}
	return null;
}

// ![[Target]] and ![[Target|width]] become a place for the picture or the note to be filled in once it is read; code is left alone
function withEmbeds(text: string): string {
	let fenced = false;
	return text
		.split("\n")
		.map((line) => {
			if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
			if (fenced) return line;
			return line.replace(/!\[\[([^\]\n|]+)(?:\|([^\]\n]*))?\]\]/g, (_m, target: string, size?: string) => `<span class="md-embed" data-embed="${escapeHtml(target.trim())}" data-size="${escapeHtml((size ?? "").trim())}"></span>`);
		})
		.join("\n");
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

export default function MarkdownPreview({ text, notes = [], onOpenNote, workspacePath, from = "" }: MarkdownPreviewProps) {
	const box = useRef<HTMLDivElement>(null);
	const html = useMemo(() => {
		const raw = marked.parse(withWikiLinks(withEmbeds(text), notes), { async: false, gfm: true }) as string;
		return DOMPurify.sanitize(raw, { ADD_ATTR: ["data-wikilink", "data-embed", "data-size"], FORBID_TAGS: ["style", "form"] });
	}, [text, notes]);

	// Fill in the pictures and embedded notes once the page is there
	useEffect(() => {
		const root = box.current;
		if (!root || !workspacePath) return;
		let live = true;
		root.querySelectorAll<HTMLImageElement>("img").forEach((img) => {
			const src = img.getAttribute("src") ?? "";
			if (!src || /^(https?:|data:|blob:)/i.test(src)) return;
			void loadPicture(workspacePath, src, from).then((url) => live && (url ? img.setAttribute("src", url) : (img.alt = img.alt || `${src} was not found`)));
		});
		root.querySelectorAll<HTMLElement>("span.md-embed").forEach((slot) => {
			const target = slot.getAttribute("data-embed") ?? "";
			const size = slot.getAttribute("data-size") ?? "";
			const missing = () => {
				slot.textContent = `${target} was not found`;
				slot.className = "wikilink wikilink-missing";
			};
			if (MIME[extOf(target)]) {
				void loadPicture(workspacePath, target, from).then((url) => {
					if (!live) return;
					if (!url) return missing();
					const img = document.createElement("img");
					img.src = url;
					img.alt = target;
					if (/^\d+$/.test(size)) img.width = Number(size);
					slot.replaceChildren(img);
				});
				return;
			}
			const note = resolveLink(target, notes);
			if (!note || note.path === from) return missing();
			void readWorkspaceFile(workspacePath, note.path)
				.then((body) => {
					if (!live) return;
					// One level only: an embedded note's own embeds are shown as plain links
					const inner = marked.parse(body.replace(/!\[\[([^\]\n|]+)(?:\|[^\]\n]*)?\]\]/g, "[[$1]]"), { async: false, gfm: true }) as string;
					const card = document.createElement("div");
					card.className = "md-embed-note";
					card.innerHTML = `<p class="md-embed-title">${escapeHtml(note.name.replace(/\.[^.]+$/, ""))}</p>${DOMPurify.sanitize(inner, { FORBID_TAGS: ["style", "form"] })}`;
					slot.replaceChildren(card);
				})
				.catch(() => live && missing());
		});
		return () => {
			live = false;
		};
	}, [html, workspacePath, from, notes]);

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
		<div ref={box} className="md-preview h-full overflow-y-auto px-8 py-6" onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />
	);
}
