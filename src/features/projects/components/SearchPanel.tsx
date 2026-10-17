import { useMemo, useState } from "react";

import { Search } from "@/components/animate-icons";
import { Panel } from "@/components/layout/Page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { projectReplace, projectSearch } from "@/lib/tauri";
import { cn, errorText } from "@/lib/utils";
import type { Found, SearchMatch } from "@/features/projects/types";

// The matches grouped by file, in the order found
export function byFile(matches: SearchMatch[]): { path: string; matches: SearchMatch[] }[] {
	const out: { path: string; matches: SearchMatch[] }[] = [];
	for (const m of matches) {
		const last = out[out.length - 1];
		if (last?.path === m.path) last.matches.push(m);
		else out.push({ path: m.path, matches: [m] });
	}
	return out;
}

// Search and replace across the files a project shares. Nothing is replaced until you tick the files and press the button.
export default function SearchPanel({ path, project, canReplace, onOpen }: { path: string; project: string; canReplace: boolean; onOpen: (rel: string, line: number) => void }) {
	const [query, setQuery] = useState("");
	const [replacement, setReplacement] = useState("");
	const [regex, setRegex] = useState(false);
	const [matchCase, setMatchCase] = useState(false);
	const [found, setFound] = useState<Found | null>(null);
	const [skipped, setSkipped] = useState<Set<string>>(new Set());
	const [busy, setBusy] = useState(false);
	const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
	const [replacing, setReplacing] = useState(false);

	const groups = useMemo(() => byFile(found?.matches ?? []), [found]);
	const chosen = groups.filter((g) => !skipped.has(g.path));

	const look = () => {
		if (!query) return;
		setBusy(true);
		setNotice(null);
		setSkipped(new Set());
		projectSearch(path, project, query, regex, matchCase)
			.then(setFound)
			.catch((e) => {
				setFound(null);
				setNotice({ ok: false, text: errorText(e, "The search did not run.") });
			})
			.finally(() => setBusy(false));
	};

	const replaceChosen = () => {
		setBusy(true);
		projectReplace(path, project, query, regex, matchCase, replacement, chosen.map((g) => g.path))
			.then((n) => {
				setNotice({ ok: true, text: `Replaced ${n} ${n === 1 ? "match" : "matches"} in ${chosen.length} ${chosen.length === 1 ? "file" : "files"}.` });
				setFound(null);
				setReplacing(false);
			})
			.catch((e) => setNotice({ ok: false, text: errorText(e, "Nothing was replaced.") }))
			.finally(() => setBusy(false));
	};

	return (
		<div className="space-y-4">
			<form
				className="flex flex-wrap items-center gap-2"
				onSubmit={(e) => {
					e.preventDefault();
					look();
				}}
			>
				<Input aria-label="Look for" autoFocus placeholder="Look for" value={query} onChange={(e) => setQuery(e.target.value)} className="min-w-52 flex-1" />
				<Button type="button" variant={matchCase ? "default" : "outline"} size="sm" aria-pressed={matchCase} aria-label="Match the case" onPress={() => setMatchCase(!matchCase)}>
					Aa
				</Button>
				<Button type="button" variant={regex ? "default" : "outline"} size="sm" aria-pressed={regex} aria-label="A pattern (regular expression)" onPress={() => setRegex(!regex)}>
					.*
				</Button>
				<Button type="submit" size="sm" isDisabled={!query || busy}>
					<Search className="size-4" />
					Search
				</Button>
			</form>
			{canReplace && (
				<div className="flex flex-wrap items-center gap-2">
					<Input aria-label="Replace with" placeholder="Replace with" value={replacement} onChange={(e) => setReplacement(e.target.value)} className="min-w-52 flex-1" />
					{regex && <span className="text-[13px] text-muted-foreground">$1 stands for the first group</span>}
				</div>
			)}
			{notice && (
				<p role={notice.ok ? "status" : "alert"} className={notice.ok ? "bg-success/10 p-2 text-sm text-success" : "bg-destructive/10 p-2 text-sm text-destructive"}>
					{notice.text}
				</p>
			)}
			{found && (
				<Panel
					title="Matches"
					hint={`${found.matches.length}${found.truncated ? "+" : ""} in ${found.files} ${found.files === 1 ? "file" : "files"}`}
					flush={groups.length > 0}
					right={
						canReplace &&
						groups.length > 0 &&
						(replacing ? (
							<>
								<Button size="xs" isDisabled={busy || chosen.length === 0} onPress={replaceChosen}>
									Replace in {chosen.length} {chosen.length === 1 ? "File" : "Files"}
								</Button>
								<Button variant="ghost" size="xs" onPress={() => setReplacing(false)}>
									Cancel
								</Button>
							</>
						) : (
							<Button variant="outline" size="xs" onPress={() => setReplacing(true)}>
								Replace…
							</Button>
						))
					}
				>
					{groups.length === 0 ? (
						<p className="text-sm text-muted-foreground">No match. Files that stay on this device (dependencies, build output, .env) are not searched.</p>
					) : (
						<ul className="divide-y">
							{found.truncated && <li className="px-4 py-2 text-[13px] text-warning">Only the first 1,000 matches are listed. A replace still changes every match in the files you choose.</li>}
							{groups.map((g) => (
								<li key={g.path} className="px-4 py-2">
									<div className="flex items-center gap-2">
										{replacing && <input type="checkbox" aria-label={`Replace in ${g.path}`} checked={!skipped.has(g.path)} onChange={(e) => setSkipped((s) => { const n = new Set(s); if (e.target.checked) n.delete(g.path); else n.add(g.path); return n; })} />}
										<span className="min-w-0 flex-1 truncate font-mono text-sm">{g.path}</span>
										<span className="font-mono text-[13px] text-muted-foreground">{g.matches.length}</span>
									</div>
									<ul className={cn("mt-1", skipped.has(g.path) && replacing && "opacity-50")}>
										{g.matches.slice(0, 50).map((m, i) => (
											<li key={i}>
												<button type="button" onClick={() => onOpen(g.path, m.line)} className="flex w-full items-baseline gap-3 px-1 py-0.5 text-left outline-none hover:bg-muted focus-visible:bg-muted">
													<span className="w-10 shrink-0 text-right font-mono text-[13px] text-muted-foreground">{m.line}</span>
													<span className="min-w-0 flex-1 truncate font-mono text-[13px]">
														{m.text.slice(0, m.start)}
														<mark className="bg-warning/30 text-foreground">{m.text.slice(m.start, m.end)}</mark>
														{m.text.slice(m.end)}
													</span>
												</button>
											</li>
										))}
										{g.matches.length > 50 && <li className="px-1 text-[13px] text-muted-foreground">and {g.matches.length - 50} more in this file</li>}
									</ul>
								</li>
							))}
						</ul>
					)}
				</Panel>
			)}
		</div>
	);
}
