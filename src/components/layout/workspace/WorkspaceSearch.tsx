import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Clock, Code2, Compass, File, FileText, KanbanSquare, ListTodo, Search, X } from "lucide-react";

import { isBinaryFile, isDocumentFile, isNoteFile } from "@/lib/editor/languages";
import { getKanban, getTasks, searchWorkspaceFiles } from "@/lib/tauri";
import { useWorkspace } from "@/store/workspace/WorkspaceContext";

interface Hit {
	key: string;
	kind: "Note" | "Code" | "File" | "Asset" | "Task" | "Card" | "Go to";
	title: string;
	sub: string;
	to: string;
	// Lower-cased file text, searched after title/subtitle
	body?: string;
}

const MAX_RESULTS = 30;

// Text around the first match, for showing why a result matched
export function snippet(text: string, q: string): string {
	const i = text.toLowerCase().indexOf(q);
	if (i < 0) return "";
	const s = Math.max(0, i - 30);
	return (s > 0 ? "…" : "") + text.slice(s, i + q.length + 60).replace(/\s+/g, " ");
}

const ICONS = { Note: FileText, Code: Code2, File, Asset: File, Task: ListTodo, Card: KanbanSquare, "Go to": Compass };

// Pages the palette can jump to
const PAGES: [string, string][] = [
	["Dashboard", "/workspace/dashboard"],
	["Notes", "/workspace/notes"],
	["Tasks", "/workspace/tasks"],
	["Kanban board", "/workspace/kanban"],
	["Editor", "/workspace/editor"],
	["Files", "/workspace/files"],
	["Assets", "/workspace/assets"],
	["Insights", "/workspace/insights"],
	["Members", "/workspace/members"],
	["Trash", "/workspace/trash"],
	["Workspace settings", "/workspace/dashboard?settings=1"],
];
const COMMANDS: Hit[] = PAGES.map(([title, to]) => ({ key: `go:${to}`, kind: "Go to", title, sub: "Open page", to }));

const FILTERS = ["All", "Note", "Task", "Card", "Code", "File", "Asset", "Go to"] as const;
type Filter = (typeof FILTERS)[number];

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
	const navigate = useNavigate();
	const [query, setQuery] = useState("");
	const [index, setIndex] = useState<Hit[]>([]);
	const [open, setOpen] = useState(false);
	const [active, setActive] = useState(0);
	const [filter, setFilter] = useState<Filter>("All");
	const [recent, setRecent] = useState<Hit[]>([]);
	const box = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);

	// Rebuild the index each time the box is focused so results are never stale
	const loadIndex = async () => {
		if (!workspace?.path) return;
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

	const q = query.trim().toLowerCase();
	const results = q
		? [...COMMANDS, ...index]
				.filter((h) => filter === "All" || h.kind === filter)
				.map((h) => {
					const inTitle = h.title.toLowerCase().includes(q);
					const inMeta = `${h.title} ${h.sub}`.toLowerCase().includes(q);
					const inBody = !!h.body && h.body.toLowerCase().includes(q);
					return { hit: inMeta || !inBody ? h : { ...h, sub: snippet(h.body!, q) }, score: inTitle ? 2 : inMeta ? 1 : inBody ? 0 : -1 };
				})
				.filter((r) => r.score >= 0)
				.sort((a, b) => b.score - a.score)
				.slice(0, MAX_RESULTS)
				.map((r) => r.hit)
		: filter === "All"
			? recent
			: [];

	useEffect(() => setActive(0), [query]);

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

	return (
		<div ref={box} className="relative w-full max-w-md">
			<div className="flex items-center border bg-background px-3">
				<Search className="size-4 shrink-0 text-muted-foreground" />
				<input
					ref={inputRef}
					value={query}
					onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
					onFocus={() => { setOpen(true); setRecent(readRecent(workspace?.id)); void loadIndex(); }}
					onKeyDown={onKeyDown}
					placeholder="Search workspace… (Ctrl+K)"
					aria-label="Search workspace"
					className="h-9 flex-1 bg-transparent px-2 text-sm outline-none placeholder:text-muted-foreground"
				/>
				{query && (
					<button onClick={() => setQuery("")} aria-label="Clear search" className="text-muted-foreground hover:text-foreground">
						<X className="size-4" />
					</button>
				)}
			</div>

			{open && (q || recent.length > 0) && (
				<ul className="absolute top-full left-0 z-40 mt-1 max-h-96 w-full overflow-y-auto border bg-popover shadow-md">
					<li className="flex flex-wrap gap-1 border-b p-2">
						{FILTERS.map((f) => (
							<button
								key={f}
								type="button"
								aria-pressed={filter === f}
								onClick={() => setFilter(f)}
								className={`px-2 py-0.5 text-xs font-semibold ${
									filter === f ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"
								}`}
							>
								{f}
							</button>
						))}
					</li>
					{!q && results.length > 0 && (
						<li className="flex items-center gap-1.5 px-3 pt-2 text-xs font-semibold text-muted-foreground">
							<Clock className="size-3" /> Recent
						</li>
					)}
					{results.length === 0 ? (
						<li className="p-3 text-xs text-muted-foreground">No results for “{query}”.</li>
					) : (
						results.map((h, i) => {
							const Icon = ICONS[h.kind];
							return (
								<li key={h.key}>
									<button
										onMouseEnter={() => setActive(i)}
										onClick={() => go(h)}
										className={`flex w-full items-center gap-3 px-3 py-2 text-left ${i === active ? "bg-muted" : ""}`}
									>
										<Icon className="size-4 shrink-0 text-primary" />
										<span className="min-w-0 flex-1">
											<span className="block truncate text-sm font-medium">{h.title}</span>
											<span className="block truncate text-xs text-muted-foreground">{h.sub}</span>
										</span>
										<span className="text-xs text-muted-foreground">{h.kind}</span>
									</button>
								</li>
							);
						})
					)}
				</ul>
			)}
		</div>
	);
}
