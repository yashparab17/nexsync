import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { SquareKanban as KanbanSquare, Clock, Code2, Compass, File, FileText, ListTodo, MessageSquareText, X } from "@/components/animate-icons";

import { cn } from "@/lib/utils";
import { isBinaryFile, isDocumentFile, isNoteFile } from "@/lib/editor/languages";
import { getKanban, getTasks, searchWorkspaceFiles } from "@/lib/tauri";
import { chatHits, hitTitle } from "@/lib/chat/search";
import { channelLabel, routeForChannel } from "@/lib/chat/routes";
import { useChat } from "@/store/chat/ChatContext";
import { useWorkspace } from "@/store/workspace/WorkspaceContext";

interface Hit {
	key: string;
	kind: "Note" | "Code" | "File" | "Asset" | "Task" | "Card" | "Message" | "Comment" | "Go to";
	title: string;
	sub: string;
	to: string;
	// Lower-cased file text, searched after title/subtitle
	body?: string;
}

const MAX_RESULTS = 30;
const IS_MAC = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform || navigator.userAgent);

// Text around the first match, for showing why a result matched
export function snippet(text: string, q: string): string {
	const i = text.toLowerCase().indexOf(q);
	if (i < 0) return "";
	const s = Math.max(0, i - 30);
	return (s > 0 ? "…" : "") + text.slice(s, i + q.length + 60).replace(/\s+/g, " ");
}

const ICONS = { Note: FileText, Code: Code2, File, Asset: File, Task: ListTodo, Card: KanbanSquare, Message: MessageSquareText, Comment: MessageSquareText, "Go to": Compass };

// Pages the palette can jump to
const PAGES: [string, string][] = [
	["Dashboard", "/workspace/dashboard"],
	["Notes", "/workspace/notes"],
	["Tasks", "/workspace/tasks"],
	["Kanban board", "/workspace/kanban"],
	["Chat", "/workspace/chat"],
	["Editor", "/workspace/editor"],
	["Explorer", "/workspace/explorer"],
	["Files", "/workspace/files"],
	["Assets", "/workspace/assets"],
	["Insights", "/workspace/insights"],
	["Members", "/workspace/members"],
	["Trash", "/workspace/trash"],
	["Workspace settings", "/workspace/dashboard?settings=1"],
];
const COMMANDS: Hit[] = PAGES.map(([title, to]) => ({ key: `go:${to}`, kind: "Go to", title, sub: "Open page", to }));

const FILTERS = ["All", "Note", "Task", "Card", "Message", "Comment", "Code", "File", "Asset", "Go to"] as const;
type Filter = (typeof FILTERS)[number];

// Where in an item the words must be found
const SCOPES = [["any", "Anywhere"], ["title", "Titles"], ["body", "Contents"]] as const;
type Scope = (typeof SCOPES)[number][0];

// The last few results opened, per workspace, kept in this browser only
const MAX_RECENT = 8;
const recentKey = (workspaceId?: string) => `nexsync.recent:${workspaceId ?? ""}`;
function readRecent(workspaceId?: string): Hit[] {
	try {
		const saved = JSON.parse(localStorage.getItem(recentKey(workspaceId)) ?? "[]");
		return Array.isArray(saved)
			? saved.filter((h) => h && typeof h.key === "string" && typeof h.title === "string" && typeof h.to === "string").slice(0, MAX_RECENT)
			: [];
	} catch {
		return [];
	}
}
function writeRecent(workspaceId: string | undefined, hit: Hit) {
	try {
		const { key, kind, title, sub, to } = hit;
		const next = [{ key, kind, title, sub, to }, ...readRecent(workspaceId).filter((h) => h.key !== key)].slice(0, MAX_RECENT);
		localStorage.setItem(recentKey(workspaceId), JSON.stringify(next));
	} catch {
		// Storage can be blocked; recents are a convenience
	}
}

// Header search: matches file names, task and kanban card titles/descriptions
export default function WorkspaceSearch() {
	const { workspace } = useWorkspace();
	const chat = useChat();
	const navigate = useNavigate();
	const [query, setQuery] = useState("");
	const [index, setIndex] = useState<Hit[]>([]);
	const [open, setOpen] = useState(false);
	const [active, setActive] = useState(0);
	const [filter, setFilter] = useState<Filter>("All");
	const [scope, setScope] = useState<Scope>("any");
	const [recent, setRecent] = useState<Hit[]>([]);
	const box = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);

	// Rebuild the index each time the box is focused so results are never stale
	// ... but not more than every 20 seconds, so a big workspace is not re-read on every click into the box
	const builtAt = useRef({ path: "", at: 0 });
	const loadIndex = async () => {
		if (!workspace?.path) return;
		if (builtAt.current.path === workspace.path && Date.now() - builtAt.current.at < 20_000) return;
		builtAt.current = { path: workspace.path, at: Date.now() };
		const [files, tasks, columns] = await Promise.all([
			searchWorkspaceFiles(workspace.path).catch(() => []),
			getTasks(workspace.path).catch(() => []),
			getKanban(workspace.path).catch(() => []),
		]);
		setIndex([
			...files.map((f): Hit => {
				const isNote = isNoteFile(f.name) && /^\/(notes|files)\/[^/]+$/.test(f.path);
				const isAsset = /^\/assets\/[^/]+$/.test(f.path);
				const isCode = !isNote && !isAsset && /^\/(editor|files|notes)\//.test(f.path) && !isBinaryFile(f.name) && !isDocumentFile(f.name);
				const open = encodeURIComponent(f.path);
				return {
					key: `f:${f.path}`,
					kind: isNote ? "Note" : isAsset ? "Asset" : isCode ? "Code" : "File",
					title: f.name,
					sub: f.path,
					body: f.body,
					to: `/workspace/${isNote ? "notes" : isAsset ? "assets" : isCode ? "editor" : "files"}?open=${open}`,
				};
			}),
			...tasks.map((t): Hit => ({
				key: `t:${t.id}`, kind: "Task", title: t.title,
				sub: `${t.description} ${t.status}`, to: `/workspace/tasks?open=${t.id}`,
			})),
			...columns.flatMap((c) =>
				c.cards.map((k): Hit => ({
					key: `k:${k.id}`, kind: "Card", title: k.title,
					sub: `${k.description} ${c.title}`, to: `/workspace/kanban?open=${k.id}`,
				})),
			),
		]);
	};

	// Messages and comments, as they read now; found by their words (the title is only their first line)
	const chatIndex = useMemo(
		() =>
			chatHits(chat.entries, chat.people).map((h): Hit => ({ key: `c:${h.id}`, kind: h.kind, title: hitTitle(h, chat.people), sub: `${channelLabel(h.channel)} · ${h.name}`, to: routeForChannel(h.channel), body: h.text })),
		[chat.entries, chat.people],
	);

	const q = query.trim().toLowerCase();
	const results = q
		? [...COMMANDS, ...index, ...chatIndex]
				.filter((h) => filter === "All" || h.kind === filter)
				.map((h) => {
					const inTitle = h.title.toLowerCase().includes(q);
					const inMeta = `${h.title} ${h.sub}`.toLowerCase().includes(q);
					const inBody = !!h.body && h.body.toLowerCase().includes(q);
					const score = scope === "title" ? (inTitle ? 2 : -1) : scope === "body" ? (inBody ? 0 : -1) : inTitle ? 2 : inMeta ? 1 : inBody ? 0 : -1;
					return { hit: scope === "body" || (!inMeta && inBody) ? { ...h, sub: snippet(h.body!, q) } : h, score };
				})
				.filter((r) => r.score >= 0)
				.sort((a, b) => b.score - a.score)
				.slice(0, MAX_RESULTS)
				.map((r) => r.hit)
		: filter === "All"
			? recent
			: [];

	useEffect(() => setActive(0), [query, filter, scope]);

	useEffect(() => {
		const close = (e: MouseEvent) => {
			if (!box.current?.contains(e.target as Node)) setOpen(false);
		};
		document.addEventListener("mousedown", close);
		return () => document.removeEventListener("mousedown", close);
	}, []);

	// Ctrl or Cmd+K jumps to the box from anywhere in the workspace
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "k") {
				e.preventDefault();
				inputRef.current?.focus();
				inputRef.current?.select();
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);

	const go = (h: Hit) => {
		writeRecent(workspace?.id, h);
		setOpen(false);
		setQuery("");
		navigate(h.to);
	};

	const onKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(i + 1, results.length - 1)); }
		else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
		else if (e.key === "Enter" && results[active]) go(results[active]);
		else if (e.key === "Escape") setOpen(false);
	};

	const listId = "workspace-search-results";
	const showList = open && (q || recent.length > 0);
	const mod = IS_MAC ? "⌘" : "Ctrl";

	return (
		<div ref={box} className="relative w-full max-w-md">
			<div className={cn("flex h-9 items-center gap-2 rounded-md bg-input px-3 field-focus", "hover:bg-muted")}>
				<span className="shrink-0 font-mono text-sm text-primary" aria-hidden>&gt;</span>
				<input
					ref={inputRef}
					style={{ outline: "none" }}
					role="combobox"
					aria-expanded={!!showList}
					aria-controls={listId}
					aria-autocomplete="list"
					aria-activedescendant={showList && results[active] ? `${listId}-${active}` : undefined}
					value={query}
					onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
					onFocus={() => { setOpen(true); setRecent(readRecent(workspace?.id)); void loadIndex(); }}
					onKeyDown={onKeyDown}
					placeholder="Search notes, files, tasks, pages…"
					aria-label="Search workspace"
					className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none focus-visible:outline-none placeholder:text-muted-foreground"
				/>
				{query ? (
					<button type="button" onClick={() => { setQuery(""); inputRef.current?.focus(); }} aria-label="Clear search" className="text-muted-foreground outline-none hover:text-foreground focus-visible:text-foreground">
						<X className="size-4" />
					</button>
				) : (
					<kbd className="hidden shrink-0 border border-b-2 px-2 font-mono text-[13px] leading-5 text-muted-foreground sm:block">{mod} K</kbd>
				)}
			</div>

			{showList && (
				<div className="absolute top-full right-0 left-0 z-40 mt-2 bg-popover rounded-lg ring-1 ring-foreground/10">
					<div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b p-2">
						<div role="group" aria-label="Filter results" className="flex flex-wrap gap-1">
							{FILTERS.map((f) => (
								<Chip key={f} on={filter === f} onClick={() => { setFilter(f); inputRef.current?.focus(); }}>{f}</Chip>
							))}
						</div>
						<div role="group" aria-label="Search in" className="ml-auto flex gap-1 border-l pl-3">
							{SCOPES.map(([key, text]) => (
								<Chip key={key} on={scope === key} onClick={() => { setScope(key); inputRef.current?.focus(); }}>{text}</Chip>
							))}
						</div>
					</div>
					<ul id={listId} role="listbox" aria-label="Results" className="max-h-96 overflow-y-auto py-1">
						{!q && results.length > 0 && (
							<li role="presentation" className="flex items-center gap-2 px-3 pt-2 pb-1 font-mono text-[13px] text-muted-foreground">
								<Clock className="size-3.5" /> Recent
							</li>
						)}
						{results.length === 0 ? (
							<li role="presentation" className="px-3 py-4 text-center text-sm text-muted-foreground">
								Nothing matches “{query}”{filter !== "All" && <> in {filter.toLowerCase()}s</>}.
							</li>
						) : (
							results.map((h, i) => {
								const Icon = ICONS[h.kind];
								return (
									<li
										key={h.key}
										id={`${listId}-${i}`}
										role="option"
										aria-selected={i === active}
										onMouseEnter={() => setActive(i)}
										onMouseDown={(e) => e.preventDefault()}
										onClick={() => go(h)}
										className={cn("flex cursor-pointer items-center gap-3 border-l-2 px-3 py-2", i === active ? "border-l-primary bg-muted" : "border-l-transparent")}
									>
										<Icon className="size-4 shrink-0 text-primary" />
										<span className="min-w-0 flex-1">
											<span className="block truncate text-sm font-medium">
												<Marked text={h.title} q={q} />
											</span>
											<span className="block truncate font-mono text-[13px] text-muted-foreground">{h.sub}</span>
										</span>
										<span className="shrink-0 font-mono text-[13px] text-muted-foreground">{h.kind}</span>
									</li>
								);
							})
						)}
					</ul>
					<p className="flex items-center gap-3 border-t px-3 py-2 font-mono text-[13px] text-muted-foreground">
						<span>↑↓ move</span>
						<span>↵ open</span>
						<span>esc close</span>
						{q && results.length > 0 && <span className="ml-auto">{results.length === MAX_RESULTS ? `first ${MAX_RESULTS}` : results.length}</span>}
					</p>
				</div>
			)}
		</div>
	);
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
	return (
		<button
			type="button"
			aria-pressed={on}
			onClick={onClick}
			className={cn(
				"border px-2 py-0.5 font-mono text-[13px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
				on ? "border-primary bg-primary text-primary-foreground" : "border-transparent bg-muted text-muted-foreground hover:text-foreground",
			)}
		>
			{children}
		</button>
	);
}

// The part of a title that matched, picked out
function Marked({ text, q }: { text: string; q: string }) {
	const i = q ? text.toLowerCase().indexOf(q) : -1;
	if (i < 0) return <>{text}</>;
	return (
		<>
			{text.slice(0, i)}
			<mark className="bg-primary/25 text-foreground">{text.slice(i, i + q.length)}</mark>
			{text.slice(i + q.length)}
		</>
	);
}
