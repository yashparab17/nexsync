// The dialogs of the References and Mailings tabs: the document's sources (and the reference list built from them) and mail merge.

import { Library, Mail } from "lucide-react";
import { useEffect, useState } from "react";
import type * as Y from "yjs";

import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter, DialogHeading } from "@/components/ui/dialog";
import { bibliography, mailMerge, parseCsv, type CitationStyle, type Source } from "@/features/office/documents/lib/documentReferences";
import { getTasks } from "@/lib/tauri";
import type { documentSchema } from "@/features/office/documents/lib/documentSchema";

type Editor = typeof documentSchema.BlockNoteEditor;

const field = "h-8 w-full border bg-background px-2 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring";

export const STYLE_NAMES: CitationStyle[] = ["APA", "MLA", "Chicago", "IEEE"];

// The sources are kept in the shared document, so everyone who has it open cites from the same list
export function useSources(doc: Y.Doc): { sources: Source[]; style: CitationStyle; setStyle: (s: CitationStyle) => void; add: (s: Omit<Source, "id">) => void; remove: (id: string) => void } {
	const map = doc.getMap<Source | string>("sources");
	const read = () => ({ sources: [...map.entries()].filter(([k]) => k !== "$style").map(([, v]) => v as Source), style: (map.get("$style") as CitationStyle) || "APA" });
	const [state, setState] = useState(read);
	useEffect(() => {
		const f = () => setState(read());
		map.observe(f);
		return () => map.unobserve(f);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [doc]);
	return {
		...state,
		setStyle: (s) => map.set("$style", s),
		add: (s) => {
			const id = `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
			map.set(id, { ...s, id });
		},
		remove: (id) => map.delete(id),
	};
}

export function SourcesDialog({ doc, editor, onClose }: { doc: Y.Doc; editor: Editor; onClose: () => void }) {
	const { sources, style, setStyle, add, remove } = useSources(doc);
	const [draft, setDraft] = useState({ author: "", year: "", title: "", publisher: "" });
	const set = (k: keyof typeof draft) => (e: React.ChangeEvent<HTMLInputElement>) => setDraft({ ...draft, [k]: e.target.value });
	return (
		<Dialog isOpen onOpenChange={(o) => !o && onClose()} className="max-w-lg">
			<div className="space-y-3 text-sm">
				<DialogHeading icon={<Library className="size-6" />} title="Sources" />
				<label className="flex items-center gap-2">
					Style
					<select aria-label="Citation style" value={style} onChange={(e) => setStyle(e.target.value as CitationStyle)} className="h-8 border bg-background px-1">
						{STYLE_NAMES.map((s) => (
							<option key={s}>{s}</option>
						))}
					</select>
				</label>
				<ul className="max-h-40 space-y-1 overflow-auto">
					{sources.length === 0 && <li className="text-muted-foreground">No sources yet.</li>}
					{sources.map((s) => (
						<li key={s.id} className="flex items-center justify-between gap-2">
							<span>
								{s.author} ({s.year}). {s.title}
							</span>
							<button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => remove(s.id)}>
								Remove
							</button>
						</li>
					))}
				</ul>
				<div className="grid grid-cols-2 gap-2">
					<input className={field} aria-label="Author" placeholder="Author (Smith, Jo)" value={draft.author} onChange={set("author")} />
					<input className={field} aria-label="Year" placeholder="Year" value={draft.year} onChange={set("year")} />
					<input className={field} aria-label="Title" placeholder="Title" value={draft.title} onChange={set("title")} />
					<input className={field} aria-label="Publisher" placeholder="Publisher" value={draft.publisher} onChange={set("publisher")} />
				</div>
				<DialogFooter>
					<Button
						variant="outline"
						isDisabled={!draft.author.trim() || !draft.title.trim()}
						onPress={() => {
							add({ author: draft.author.trim(), year: draft.year.trim() || "n.d.", title: draft.title.trim(), publisher: draft.publisher.trim() });
							setDraft({ author: "", year: "", title: "", publisher: "" });
						}}
					>
						Add Source
					</Button>
					<Button
						isDisabled={sources.length === 0}
						onPress={() => {
							const at = editor.getTextCursorPosition().block;
							editor.insertBlocks([{ type: "heading", props: { level: 1 }, content: style === "MLA" ? "Works Cited" : style === "APA" ? "References" : "Bibliography" }, ...bibliography(sources, style).map((t) => ({ type: "paragraph", content: t }))] as never, at, "after");
							onClose();
						}}
					>
						Insert Reference List
					</Button>
					<Button variant="outline" onPress={onClose}>
						Close
					</Button>
				</DialogFooter>
			</div>
		</Dialog>
	);
}

export function MergeDialog({ editor, workspacePath, onClose }: { editor: Editor; workspacePath?: string; onClose: () => void }) {
	const [csv, setCsv] = useState("");
	const [problem, setProblem] = useState<string | null>(null);
	const rows = parseCsv(csv);
	return (
		<Dialog isOpen onOpenChange={(o) => !o && onClose()} className="max-w-lg">
			<div className="space-y-3 text-sm">
				<DialogHeading icon={<Mail className="size-6" />} title="Merge from Data" />
				<p>Write {"{{field}}"} where a value goes, then paste the rows as CSV with the field names on the first line. The merged copies are added after the document, each on its own page.</p>
				<textarea aria-label="Data" rows={6} value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={"name,city\nAna,Paris"} className="w-full border bg-background p-2 font-mono text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring" />
				{workspacePath && (
					<Button
						variant="outline"
						onPress={async () => {
							try {
								const tasks = await getTasks(workspacePath);
								setCsv(JSON.stringify(tasks.map((t) => ({ title: t.title, status: t.status, priority: t.priority, due: t.due_date ?? "", assignee: t.assignee_id ?? "", tags: t.tags.join(", ") }))));
								setProblem(null);
							} catch {
								setProblem("The tasks could not be read.");
							}
						}}
					>
						Use the workspace's tasks
					</Button>
				)}
				{problem && <p role="alert" className="text-destructive">{problem}</p>}
				<p className="text-muted-foreground">{rows.length === 0 ? "No rows yet." : `${rows.length} ${rows.length === 1 ? "copy" : "copies"}: ${Object.keys(rows[0]).join(", ")}`}</p>
				<DialogFooter>
					<Button
						isDisabled={rows.length === 0}
						onPress={() => {
							const blocks = editor.document as never[];
							const out = mailMerge(blocks, rows);
							editor.insertBlocks(out.map((b, i) => (i === 0 ? { ...b, props: { ...b.props, pageBreakBefore: true } } : b)) as never, blocks[blocks.length - 1], "after");
							onClose();
						}}
					>
						Merge
					</Button>
					<Button variant="outline" onPress={onClose}>
						Close
					</Button>
				</DialogFooter>
			</div>
		</Dialog>
	);
}
