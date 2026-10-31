import { useState } from "react";

import type { StyleDef, TableLook } from "@/features/office/documents/lib/documentStyles";

const field = "h-7 w-full border bg-background px-1.5 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring";

// A new style from the look at the caret: a style of paragraphs (which can be based on another, and then follows it) or of letters (put on the selected words)
export function NewStyleForm({ styles, current, onSubmit }: { styles: StyleDef[]; current: string; onSubmit: (name: string, kind: "paragraph" | "character", basedOn: string) => void }) {
	const [name, setName] = useState("");
	const [kind, setKind] = useState<"paragraph" | "character">("paragraph");
	const [basedOn, setBasedOn] = useState(current);
	const paragraphs = styles.filter((s) => (s.kind ?? "paragraph") === "paragraph");
	return (
		<form
			className="flex w-72 flex-col gap-2 p-2 text-[13px]"
			onSubmit={(e) => {
				e.preventDefault();
				if (name.trim()) onSubmit(name.trim(), kind, kind === "paragraph" ? basedOn : "");
				setName("");
			}}
		>
			<input autoFocus aria-label="Name" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} className={field} />
			<label className="flex items-center gap-2">
				<span className="w-16 shrink-0">Style of</span>
				<select aria-label="Style of" value={kind} onChange={(e) => setKind(e.target.value as "paragraph" | "character")} className={field}>
					<option value="paragraph">Paragraphs</option>
					<option value="character">Selected words</option>
				</select>
			</label>
			{kind === "paragraph" && (
				<label className="flex items-center gap-2">
					<span className="w-16 shrink-0">Based on</span>
					<select aria-label="Based on" value={basedOn} onChange={(e) => setBasedOn(e.target.value)} className={field}>
						<option value="">Normal</option>
						<option value="Heading1">Heading 1</option>
						<option value="Heading2">Heading 2</option>
						<option value="Heading3">Heading 3</option>
						{paragraphs.map((s) => (
							<option key={s.id} value={s.id}>
								{s.name}
							</option>
						))}
					</select>
				</label>
			)}
			<button type="submit" className="h-7 self-end bg-[var(--office)] px-3 text-white">
				Create
			</button>
		</form>
	);
}

// A new style of tables: the fill of the header row and of every second row, and whether the header is bold
export function NewTableStyleForm({ onSubmit }: { onSubmit: (name: string, look: TableLook) => void }) {
	const [name, setName] = useState("");
	const [header, setHeader] = useState("#d9e2f3");
	const [band, setBand] = useState("#f2f2f2");
	const [bold, setBold] = useState(true);
	return (
		<form
			className="flex w-64 flex-col gap-2 p-2 text-[13px]"
			onSubmit={(e) => {
				e.preventDefault();
				if (name.trim()) onSubmit(name.trim(), { headerFill: header, headerColor: "", headerBold: bold, bandFill: band, fill: "" });
				setName("");
			}}
		>
			<input autoFocus aria-label="Name" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} className={field} />
			<label className="flex items-center gap-2">
				<span className="w-24 shrink-0">Header row</span>
				<input type="color" aria-label="Header row fill" value={header} onChange={(e) => setHeader(e.target.value)} className="h-7 w-12" />
			</label>
			<label className="flex items-center gap-2">
				<span className="w-24 shrink-0">Every 2nd row</span>
				<input type="color" aria-label="Every second row fill" value={band} onChange={(e) => setBand(e.target.value)} className="h-7 w-12" />
			</label>
			<label className="flex items-center gap-2">
				<input type="checkbox" checked={bold} onChange={(e) => setBold(e.target.checked)} />
				Bold header text
			</label>
			<button type="submit" className="h-7 self-end bg-[var(--office)] px-3 text-white">
				Create
			</button>
		</form>
	);
}
