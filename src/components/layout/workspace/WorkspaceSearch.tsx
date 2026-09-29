import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { File, FileText, KanbanSquare, ListTodo, Search, X } from "lucide-react";

import { getKanban, getTasks, listWorkspaceFiles, readWorkspaceFile } from "@/lib/tauri";
import { useWorkspace } from "@/store/workspace/WorkspaceContext";
import type { WorkspaceFile } from "@/types/workspace";

interface Hit {
	key: string;
	kind: "Note" | "File" | "Asset" | "Task" | "Card";
	title: string;
	sub: string;
	to: string;
	// Lower-cased file text, searched after title/subtitle
	body?: string;
}

const MAX_DEPTH = 4;
const MAX_RESULTS = 30;
const MAX_TEXT_BYTES = 256 * 1024;
const MAX_TEXT_FILES = 300;
const TEXT_EXT = /\.(md|markdown|txt|json|csv|toml|ya?ml|html?|css|js|ts|tsx|jsx|rs)$/i;

// Text around the first match, for showing why a result matched
export function snippet(text: string, q: string): string {
	const i = text.toLowerCase().indexOf(q);
	if (i < 0) return "";
	const s = Math.max(0, i - 30);
	return (s > 0 ? "…" : "") + text.slice(s, i + q.length + 60).replace(/\s+/g, " ");
}

// Recursively list every file in the workspace (hidden entries are already skipped by the backend)
async function walk(path: string, dir = "", depth = 0): Promise<WorkspaceFile[]> {
	const entries = await listWorkspaceFiles(path, dir).catch(() => []);
	const nested = await Promise.all(
		entries
			.filter((e) => e.is_dir && depth < MAX_DEPTH)
			.map((e) => walk(path, e.path.replace(/^\/+/, ""), depth + 1)),
	);
	return [...entries.filter((e) => !e.is_dir), ...nested.flat()];
}

const ICONS = { Note: FileText, File, Asset: File, Task: ListTodo, Card: KanbanSquare };

// Header search: matches file names, task and kanban card titles/descriptions
export default function WorkspaceSearch() {
	const { workspace } = useWorkspace();
	const navigate = useNavigate();
	const [query, setQuery] = useState("");
	const [index, setIndex] = useState<Hit[]>([]);
	const [open, setOpen] = useState(false);
	const [active, setActive] = useState(0);
	const box = useRef<HTMLDivElement>(null);

	// Rebuild the index each time the box is focused so results are never stale
	const loadIndex = async () => {
		if (!workspace?.path) return;
		const [files, tasks, columns] = await Promise.all([
			walk(workspace.path),
			getTasks(workspace.path).catch(() => []),
			getKanban(workspace.path).catch(() => []),
		]);
		// ponytail: reads every small text file on focus, add a Rust-side index if workspaces get huge
		const bodies = await Promise.all(
			files.map((f, i) =>
				TEXT_EXT.test(f.name) && f.size <= MAX_TEXT_BYTES && i < MAX_TEXT_FILES
					? readWorkspaceFile(workspace.path, f.path.replace(/^\/+/, "")).catch(() => "")
					: "",
			),
		);
		setIndex([
			...files.map((f, i): Hit => {
				const isNote = /\.(md|markdown)$/i.test(f.name) && /^\/(notes|files)\/[^/]+$/.test(f.path);
				const isAsset = /^\/assets\/[^/]+$/.test(f.path);
				const open = encodeURIComponent(f.path);
				return {
					key: `f:${f.path}`,
					kind: isNote ? "Note" : isAsset ? "Asset" : "File",
					title: f.name,
					sub: f.path,
					body: bodies[i],
					to: `/workspace/${isNote ? "notes" : isAsset ? "assets" : "files"}?open=${open}`,
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
		? index
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
		: [];

	useEffect(() => setActive(0), [query]);

	useEffect(() => {
		const close = (e: MouseEvent) => {
			if (!box.current?.contains(e.target as Node)) setOpen(false);
		};
		document.addEventListener("mousedown", close);
		return () => document.removeEventListener("mousedown", close);
	}, []);

	const go = (h: Hit) => {
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
					value={query}
					onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
					onFocus={() => { setOpen(true); void loadIndex(); }}
					onKeyDown={onKeyDown}
					placeholder="Search workspace…"
					aria-label="Search workspace"
					className="h-9 flex-1 bg-transparent px-2 text-sm outline-none placeholder:text-muted-foreground"
				/>
				{query && (
					<button onClick={() => setQuery("")} aria-label="Clear search" className="text-muted-foreground hover:text-foreground">
						<X className="size-4" />
					</button>
				)}
			</div>

			{open && q && (
				<ul className="absolute top-full left-0 z-40 mt-1 max-h-96 w-full overflow-y-auto border bg-popover shadow-md">
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
											<span className="block truncate text-[11px] text-muted-foreground">{h.sub}</span>
										</span>
										<span className="text-[10px] uppercase tracking-widest text-muted-foreground">{h.kind}</span>
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
