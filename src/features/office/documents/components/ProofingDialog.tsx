import { SpellCheck } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter, DialogHeading } from "@/components/ui/dialog";
import { proofCheck, type ProofProblem } from "@/lib/tauri";
import { errorText } from "@/lib/utils";

// Spelling and grammar, one problem at a time: what is wrong, what to write instead, and the choice to leave it. A change is made
// wherever the word stands whole in the document; `text` is the document as it reads now and `replace` makes the change.
export default function ProofingDialog({ text, replace, onClose, readOnly }: { text: string; replace: (from: string, to: string) => number; onClose: () => void; readOnly: boolean }) {
	const [problems, setProblems] = useState<ProofProblem[] | null>(null);
	const [ignored, setIgnored] = useState<Set<string>>(new Set());
	const [error, setError] = useState("");
	const [said, setSaid] = useState("");

	useEffect(() => {
		let live = true;
		proofCheck(text)
			.then((p) => live && setProblems(p))
			.catch((e) => live && setError(errorText(e, "The check could not be done.")));
		return () => {
			live = false;
		};
	}, [text]);

	const left = (problems ?? []).filter((p) => !ignored.has(`${p.kind}:${p.text}`));
	const current = left[0];
	const done = (p: ProofProblem) => setIgnored((s) => new Set(s).add(`${p.kind}:${p.text}`));

	return (
		<Dialog isOpen onOpenChange={(o) => !o && onClose()} className="max-w-md">
			<div className="space-y-3 text-sm">
				<DialogHeading icon={<SpellCheck className="size-6" />} title="Spelling & Grammar" />
				{error ? (
					<p role="alert" className="text-destructive">{error}</p>
				) : !problems ? (
					<p className="text-muted-foreground">Checking…</p>
				) : !current ? (
					<p role="status">{problems.length === 0 ? "No problems found." : "That is everything."}</p>
				) : (
					<div className="space-y-3">
						<p className="text-xs text-muted-foreground">
							{current.kind === "spelling" ? "Not in the dictionary" : "Grammar"} · {left.length} left
						</p>
						<p className="border bg-muted/40 px-3 py-2 text-base">
							<span className={current.kind === "spelling" ? "text-destructive underline decoration-wavy" : "text-[#2B579A] underline decoration-double"}>{current.text}</span>
						</p>
						{current.message && <p className="text-muted-foreground">{current.message}</p>}
						{current.suggestions.length > 0 ? (
							<ul aria-label="Suggestions" className="space-y-1">
								{current.suggestions.map((s) => (
									<li key={s}>
										<button
											type="button"
											disabled={readOnly}
											onClick={() => {
												const n = replace(current.text, s);
												setSaid(n > 0 ? `Changed ${n} ${n === 1 ? "place" : "places"}.` : "That text is not found as a whole word.");
												done(current);
											}}
											className="w-full border px-3 py-1.5 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
										>
											{s}
										</button>
									</li>
								))}
							</ul>
						) : (
							<p className="text-muted-foreground">No suggestions.</p>
						)}
						{said && <p role="status" className="text-xs text-muted-foreground">{said}</p>}
						<div className="flex gap-2">
							<Button variant="outline" size="sm" onPress={() => done(current)}>
								Ignore All
							</Button>
						</div>
					</div>
				)}
				<DialogFooter>
					<Button onPress={onClose}>Close</Button>
				</DialogFooter>
			</div>
		</Dialog>
	);
}
