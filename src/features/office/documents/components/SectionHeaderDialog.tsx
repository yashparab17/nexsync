import { PanelTop } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter, DialogHeading } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { SectionSpec } from "@/features/office/documents/lib/documentSections";

type Text = string | null;

// The headers, footers and page numbers of the section the caret is in. Left empty and kept as "same as before", a section has what the one
// before it has; Remove takes the text away for this section. The first page and the even pages can have their own.
export default function SectionHeaderDialog({ spec, onApply, onClose }: { spec: SectionSpec; onApply: (change: Partial<SectionSpec>) => void; onClose: () => void }) {
	const [text, setText] = useState({ header: spec.header, footer: spec.footer, firstHeader: spec.firstHeader, firstFooter: spec.firstFooter, evenHeader: spec.evenHeader, evenFooter: spec.evenFooter });
	const [num, setNum] = useState<string>(spec.num === null ? "" : String(spec.num));
	const line = (label: string, key: keyof typeof text) => {
		const value: Text = text[key];
		return (
			<Field label={label} htmlFor={`section-${key}`} hint={value === "" ? `This section has no ${label.toLowerCase()}.` : undefined}>
				<div className="flex gap-2">
					<Input id={`section-${key}`} value={value ?? ""} maxLength={200} placeholder="Same as before" onChange={(e) => setText({ ...text, [key]: e.target.value === "" ? null : e.target.value })} className="h-8 flex-1" />
					<Button size="sm" variant="outline" onPress={() => setText({ ...text, [key]: "" })} isDisabled={value === ""}>
						Remove
					</Button>
				</div>
			</Field>
		);
	};
	return (
		<Dialog isOpen onOpenChange={(o) => !o && onClose()} className="max-w-md">
			<div className="space-y-4 text-sm">
				<DialogHeading icon={<PanelTop className="size-6" />} title="Header & Footer of This Section" />
				{line("Header", "header")}
				{line("Footer", "footer")}
				<details className="space-y-3">
					<summary className="cursor-pointer text-muted-foreground">First page and even pages</summary>
					<div className="mt-3 space-y-3">
						{line("First page header", "firstHeader")}
						{line("First page footer", "firstFooter")}
						{line("Even page header", "evenHeader")}
						{line("Even page footer", "evenFooter")}
					</div>
				</details>
				<Field label="Page numbers start at" htmlFor="section-num" hint="Empty keeps what the section has. Type c to carry on from the section before.">
					<Input id="section-num" value={num} maxLength={6} onChange={(e) => setNum(e.target.value)} className="h-8 w-28" />
				</Field>
				<DialogFooter>
					<Button variant="outline" onPress={onClose}>
						Cancel
					</Button>
					<Button
						onPress={() => {
							const n = num.trim().toLowerCase();
							onApply({ ...text, num: n === "c" ? "c" : /^[1-9]\d{0,5}$/.test(n) ? Number(n) : spec.num });
							onClose();
						}}
					>
						Apply
					</Button>
				</DialogFooter>
			</div>
		</Dialog>
	);
}
