import { TextCursorInput } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter, DialogHeading } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { CONTROL_KINDS, placeholderOf, type ControlKind, type ControlSpec } from "@/features/office/documents/lib/documentControls";

// A content control: a field of a form. Its kind, a title for it, and for a list the items to choose from. Choosing a value puts it in the field.
export default function ControlDialog({ spec, text, onApply, onClose }: { spec: ControlSpec | null; text: string; onApply: (spec: ControlSpec, text: string) => void; onClose: () => void }) {
	const [kind, setKind] = useState<ControlKind>(spec?.kind ?? "text");
	const [title, setTitle] = useState(spec?.title ?? "");
	const [items, setItems] = useState((spec?.items ?? []).join("\n"));
	const [value, setValue] = useState(spec ? text : "");
	const [date, setDate] = useState(spec?.kind === "date" ? spec.state.slice(0, 10) : "");
	const [ticked, setTicked] = useState(spec?.kind === "check" ? spec.state === "1" : false);
	const list = items.split("\n").map((i) => i.trim()).filter(Boolean).slice(0, 200);
	const listed = kind === "drop" || kind === "combo";
	const build = (): ControlSpec => ({ kind, title: title.trim().slice(0, 200), tag: spec?.tag ?? "", items: listed ? list : [], state: kind === "check" ? (ticked ? "1" : "0") : kind === "date" ? date : "" });
	return (
		<Dialog isOpen onOpenChange={(o) => !o && onClose()} className="max-w-md">
			<div className="space-y-4 text-sm">
				<DialogHeading icon={<TextCursorInput className="size-6" />} title={spec ? "Content Control" : "Insert a Content Control"} />
				<Field label="Kind" htmlFor="control-kind">
					<select id="control-kind" value={kind} onChange={(e) => setKind(e.target.value as ControlKind)} className="h-9 w-full border bg-background px-2">
						{CONTROL_KINDS.map(([k, label]) => (
							<option key={k} value={k}>
								{label}
							</option>
						))}
					</select>
				</Field>
				<Field label="Title" htmlFor="control-title" hint="Shown when the pointer rests on the field.">
					<Input id="control-title" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
				</Field>
				{listed && (
					<Field label="Items" htmlFor="control-items" hint="One on each line.">
						<textarea id="control-items" value={items} rows={4} onChange={(e) => setItems(e.target.value)} className="w-full border bg-background p-2" />
					</Field>
				)}
				{listed && list.length > 0 && (
					<Field label="Value" htmlFor="control-value">
						<select id="control-value" value={list.includes(value) ? value : ""} onChange={(e) => setValue(e.target.value)} className="h-9 w-full border bg-background px-2">
							<option value="">Choose an item</option>
							{list.map((i) => (
								<option key={i}>{i}</option>
							))}
						</select>
					</Field>
				)}
				{kind === "date" && (
					<Field label="Date" htmlFor="control-date">
						<Input id="control-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
					</Field>
				)}
				{kind === "check" && (
					<label className="flex items-center gap-2">
						<input type="checkbox" checked={ticked} onChange={(e) => setTicked(e.target.checked)} />
						Ticked
					</label>
				)}
				<DialogFooter>
					<Button variant="outline" onPress={onClose}>
						Cancel
					</Button>
					<Button
						onPress={() => {
							const next = build();
							onApply(next, kind === "check" || kind === "date" ? placeholderOf(next) : listed ? (list.includes(value) ? value : placeholderOf(next)) : value || text || placeholderOf(next));
							onClose();
						}}
					>
						{spec ? "Apply" : "Insert"}
					</Button>
				</DialogFooter>
			</div>
		</Dialog>
	);
}
