import { PanelTop } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter, DialogHeading } from "@/components/ui/dialog";
import type { SectionSpec } from "@/features/office/documents/lib/documentSections";

// The header and footer of the section the caret is in. Left empty and kept as "same as before", a section has what the one before it has;
// Remove takes the text away for this section.
export default function SectionHeaderDialog({ spec, onApply, onClose }: { spec: SectionSpec; onApply: (header: string | null, footer: string | null) => void; onClose: () => void }) {
	const [header, setHeader] = useState(spec.header);
	const [footer, setFooter] = useState(spec.footer);
	const field = (label: string, value: string | null, set: (v: string | null) => void) => (
		<div className="space-y-1">
			<label htmlFor={`section-${label}`} className="font-medium">
				{label}
			</label>
			<div className="flex gap-2">
				<input id={`section-${label}`} value={value ?? ""} maxLength={200} placeholder="Same as before" onChange={(e) => set(e.target.value === "" ? null : e.target.value)} className="h-8 flex-1 border bg-background px-2 outline-none focus-visible:ring-2 focus-visible:ring-ring" />
				<Button size="sm" variant="outline" onPress={() => set("")} isDisabled={value === ""}>
					Remove
				</Button>
			</div>
			{value === "" && <p className="text-[13px] text-muted-foreground">This section has no {label.toLowerCase()}.</p>}
		</div>
	);
	return (
		<Dialog isOpen onOpenChange={(o) => !o && onClose()} className="max-w-md">
			<div className="space-y-4 text-sm">
				<DialogHeading icon={<PanelTop className="size-6" />} title="Header & Footer of This Section" />
				{field("Header", header, setHeader)}
				{field("Footer", footer, setFooter)}
				<DialogFooter>
					<Button variant="outline" onPress={onClose}>
						Cancel
					</Button>
					<Button
						onPress={() => {
							onApply(header, footer);
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
