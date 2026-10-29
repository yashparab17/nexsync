import { GitCompareArrows } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter, DialogHeading } from "@/components/ui/dialog";
import { compareLines, type Comparison } from "@/features/office/documents/lib/documentReview";
import { listFileVersions, officeVersionLines } from "@/lib/tauri";
import type { FileVersion } from "@/types/workspace";

// Compare: the open document against one of its saved versions, paragraph by paragraph and word by word. What the version had and the
// document no longer has is struck through in red; what the document has and the version did not is underlined in green.
export default function CompareDialog({ workspacePath, rel, lines, onClose }: { workspacePath: string; rel: string; lines: () => string[]; onClose: () => void }) {
	const [versions, setVersions] = useState<FileVersion[] | null>(null);
	const [id, setId] = useState<number | null>(null);
	const [result, setResult] = useState<Comparison | null>(null);
	const [problem, setProblem] = useState<string | null>(null);
	const ext = useMemo(() => rel.split(".").pop() ?? "docx", [rel]);
	useEffect(() => {
		listFileVersions(workspacePath, rel.replace(/^\/+/, "")).then((v) => (setVersions(v), setId(v[0]?.id ?? null)), () => setProblem("The versions could not be listed."));
	}, [workspacePath, rel]);
	const run = async () => {
		if (id === null) return;
		try {
			setProblem(null);
			setResult(compareLines(await officeVersionLines(workspacePath, id, ext), lines()));
		} catch (e) {
			setResult(null);
			setProblem(typeof e === "string" ? e : "The version could not be compared.");
		}
	};
	return (
		<Dialog isOpen onOpenChange={(o) => !o && onClose()} className="max-w-3xl">
			<div className="space-y-3 text-sm">
				<DialogHeading icon={<GitCompareArrows className="size-6" />} title="Compare with a Saved Version" />
				{versions && versions.length === 0 && <p>This file has no saved versions yet. A version is kept each time the file is saved or updated.</p>}
				{versions && versions.length > 0 && (
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
