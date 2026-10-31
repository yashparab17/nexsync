import { GitCompareArrows } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter, DialogHeading } from "@/components/ui/dialog";
import { compareLines, type Comparison } from "@/features/office/documents/lib/documentReview";
import { listFileVersions, officeFileLines, officeVersionLines } from "@/lib/tauri";
import type { FileVersion } from "@/types/workspace";

// Compare: the open document against one of its saved versions, or against another document of the workspace, paragraph by paragraph and word by word. What the version had and the
// document no longer has is struck through in red; what the document has and the version did not is underlined in green.
export default function CompareDialog({ workspacePath, rel, others, lines, onClose }: { workspacePath: string; rel: string; others: { name: string; rel: string }[]; lines: () => string[]; onClose: () => void }) {
	const [against, setAgainst] = useState<"version" | "file">("version");
	const [file, setFile] = useState(others[0]?.rel ?? "");
	const [versions, setVersions] = useState<FileVersion[] | null>(null);
	const [id, setId] = useState<number | null>(null);
	const [result, setResult] = useState<Comparison | null>(null);
	const [problem, setProblem] = useState<string | null>(null);
	const ext = useMemo(() => rel.split(".").pop() ?? "docx", [rel]);
	useEffect(() => {
		listFileVersions(workspacePath, rel.replace(/^\/+/, "")).then((v) => (setVersions(v), setId(v[0]?.id ?? null)), () => setProblem("The versions could not be listed."));
	}, [workspacePath, rel]);
	const run = async () => {
		if (against === "version" ? id === null : !file) return;
		try {
			setProblem(null);
			const before = against === "version" ? await officeVersionLines(workspacePath, id as number, ext) : await officeFileLines(workspacePath, file.replace(/^\/+/, ""));
			setResult(compareLines(before, lines()));
		} catch (e) {
			setResult(null);
			setProblem(typeof e === "string" ? e : "The version could not be compared.");
		}
	};
	return (
		<Dialog isOpen onOpenChange={(o) => !o && onClose()} className="max-w-3xl">
			<div className="space-y-3 text-sm">
				<DialogHeading icon={<GitCompareArrows className="size-6" />} title="Compare" />
				{others.length > 0 && (
					<div role="radiogroup" aria-label="Compare with" className="flex gap-4">
						<label className="flex items-center gap-2"><input type="radio" name="against" checked={against === "version"} onChange={() => { setAgainst("version"); setResult(null); }} />A saved version</label>
						<label className="flex items-center gap-2"><input type="radio" name="against" checked={against === "file"} onChange={() => { setAgainst("file"); setResult(null); }} />Another document</label>
					</div>
				)}
				{against === "file" && (
					<div className="flex items-center gap-2">
						<select aria-label="Document" value={file} onChange={(e) => setFile(e.target.value)} className="flex-1 border bg-background p-1.5">
							{others.map((o) => (
								<option key={o.rel} value={o.rel}>{o.name}</option>
							))}
						</select>
						<Button onPress={() => void run()}>Compare</Button>
					</div>
				)}
				{against === "version" && versions && versions.length === 0 && <p>No saved versions yet. One is kept at each save.</p>}
				{against === "version" && versions && versions.length > 0 && (
					<div className="flex items-center gap-2">
						<select aria-label="Version" value={id ?? ""} onChange={(e) => setId(Number(e.target.value))} className="flex-1 border bg-background p-1.5">
							{versions.map((v) => (
								<option key={v.id} value={v.id}>
									{new Date(v.createdAt).toLocaleString()} · {v.label ?? v.source}
									{v.author ? ` · ${v.author}` : ""}
								</option>
							))}
						</select>
						<Button onPress={() => void run()}>Compare</Button>
					</div>
				)}
				{problem && <p role="alert" className="text-destructive">{problem}</p>}
				{result && (
					<>
						<p role="status">
							{result.insertions} {result.insertions === 1 ? "insertion" : "insertions"}, {result.deletions} {result.deletions === 1 ? "deletion" : "deletions"}
							{result.insertions + result.deletions === 0 ? ": the document is the same as that version." : "."}
						</p>
						<div className="max-h-[50vh] space-y-1 overflow-auto border p-3 leading-relaxed">
							{result.rows
								.filter((r) => r.kind !== "same")
								.map((r, i) => (
									<p key={i}>
										{r.pieces.map((p, j) => (p.kind === "same" ? <span key={j}>{p.text}</span> : p.kind === "insertion" ? <ins key={j} className="doc-ins">{p.text}</ins> : <del key={j} className="doc-del">{p.text}</del>))}
									</p>
								))}
						</div>
					</>
				)}
				<DialogFooter>
					<Button variant="outline" onPress={onClose}>
						Close
					</Button>
				</DialogFooter>
			</div>
		</Dialog>
	);
}
