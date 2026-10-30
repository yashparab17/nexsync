import { StickyNote } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter, DialogHeading } from "@/components/ui/dialog";

export interface NoteRow {
	id: number;
	end: boolean;
	text: string;
}

const roman = (n: number) => ["", "i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x", "xi", "xii", "xiii", "xiv", "xv", "xvi", "xvii", "xviii", "xix", "xx"][n] ?? String(n);

// The footnotes and endnotes in the order of the text, each with its number as the page shows it and its words to change
export default function NotesDialog({ rows, readOnly, onEdit, onClose }: { rows: NoteRow[]; readOnly: boolean; onEdit: (id: number, text: string) => void; onClose: () => void }) {
	const [text, setText] = useState(() => Object.fromEntries(rows.map((r) => [r.id, r.text])));
	let foot = 0;
	let end = 0;
	return (
		<Dialog isOpen onOpenChange={(o) => !o && onClose()} className="max-w-lg">
			<div className="space-y-3 text-sm">
				<DialogHeading icon={<StickyNote className="size-6" />} title="Notes" />
				{rows.length === 0 ? (
					<p role="status">No notes yet. Use Footnote or Endnote on the References tab.</p>
				) : (
					<ul className="max-h-80 space-y-2 overflow-y-auto">
						{rows.map((r) => {
							const label = r.end ? roman(++end) : String(++foot);
							return (
								<li key={r.id} className="flex items-start gap-2">
									<span className="w-10 shrink-0 pt-1 text-right text-muted-foreground">{r.end ? `${label}.` : `${label}.`}</span>
									<textarea
										aria-label={`${r.end ? "Endnote" : "Footnote"} ${label}`}
										value={text[r.id] ?? ""}
										readOnly={readOnly}
										rows={2}
										onChange={(e) => {
											setText({ ...text, [r.id]: e.target.value });
											onEdit(r.id, e.target.value);
										}}
										className="flex-1 border bg-background px-1.5 py-1 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
									/>
								</li>
							);
						})}
					</ul>
				)}
				<DialogFooter>
					<Button onPress={onClose}>Close</Button>
				</DialogFooter>
			</div>
		</Dialog>
	);
}
