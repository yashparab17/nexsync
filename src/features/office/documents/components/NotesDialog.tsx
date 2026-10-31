import { StickyNote } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter, DialogHeading } from "@/components/ui/dialog";

export interface NoteRow {
	id: number;
	end: boolean;
	text: string;
}

import { NOTE_FORMATS, type NoteFormat, type NoteFormats } from "@/features/office/documents/lib/documentNotes";

// A note's number written in a format (up to 26 in letters, past that the number)
function numberOf(n: number, f: NoteFormat): string {
	if (f === "decimal") return String(n);
	if (f === "lowerLetter" || f === "upperLetter") {
		const l = n >= 1 && n <= 26 ? String.fromCharCode(96 + n) : String(n);
		return f === "upperLetter" ? l.toUpperCase() : l;
	}
	const r = roman(n);
	return f === "upperRoman" ? r.toUpperCase() : r;
}

const roman = (n: number) => ["", "i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x", "xi", "xii", "xiii", "xiv", "xv", "xvi", "xvii", "xviii", "xix", "xx"][n] ?? String(n);

// The footnotes and endnotes in the order of the text, each with its number as the page shows it and its words to change
export default function NotesDialog({ rows, readOnly, formats, onFormats, onEdit, onClose }: { rows: NoteRow[]; readOnly: boolean; formats: NoteFormats; onFormats: (f: NoteFormats) => void; onEdit: (id: number, text: string) => void; onClose: () => void }) {
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
							const label = numberOf(r.end ? ++end : ++foot, r.end ? formats.end : formats.foot);
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
				<p className="text-[13px] text-muted-foreground">Use **bold** and *italic* in a note's words.</p>
				{!readOnly && (
					<div className="flex flex-wrap items-center gap-3">
						<label className="flex items-center gap-2">
							Footnotes
							<select aria-label="Footnote numbers" value={formats.foot} onChange={(e) => onFormats({ ...formats, foot: e.target.value as NoteFormat })} className="h-8 border bg-background px-2">
								{NOTE_FORMATS.map((f) => (
									<option key={f.id} value={f.id}>
										{f.label}
									</option>
								))}
							</select>
						</label>
						<label className="flex items-center gap-2">
							Endnotes
							<select aria-label="Endnote numbers" value={formats.end} onChange={(e) => onFormats({ ...formats, end: e.target.value as NoteFormat })} className="h-8 border bg-background px-2">
								{NOTE_FORMATS.map((f) => (
									<option key={f.id} value={f.id}>
										{f.label}
									</option>
								))}
							</select>
						</label>
					</div>
				)}
				<DialogFooter>
					<Button onPress={onClose}>Close</Button>
				</DialogFooter>
			</div>
		</Dialog>
	);
}
