import { Accessibility } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter, DialogHeading } from "@/components/ui/dialog";
import { accessibilityProblems } from "@/features/office/documents/lib/documentAccessibility";
import type { BlockLike } from "@/features/office/documents/lib/documentFind";

// What would make the document hard to read with a screen reader, one finding at a time with what to do about it; Go There puts the caret in
// the block. `blocks` reads the document as it is now, so Check Again sees what was fixed.
export default function AccessibilityDialog({ blocks, goTo, onClose }: { blocks: () => BlockLike[]; goTo: (blockId: string) => void; onClose: () => void }) {
	const [problems, setProblems] = useState(() => accessibilityProblems(blocks()));
	return (
		<Dialog isOpen onOpenChange={(o) => !o && onClose()} className="max-w-lg">
			<div className="space-y-3 text-sm">
				<DialogHeading icon={<Accessibility className="size-6" />} title="Accessibility Check" />
				{problems.length === 0 ? (
					<p role="status">No problems found. This checks pictures, headings, tables, links and blank lines; it does not check colour contrast or reading order.</p>
				) : (
					<>
						<p role="status" className="text-muted-foreground">
							{problems.length} {problems.length === 1 ? "thing" : "things"} to look at.
						</p>
						<ul className="max-h-80 space-y-2 overflow-y-auto">
							{problems.map((p, i) => (
								<li key={`${p.blockId}:${p.kind}:${i}`} className="flex items-start gap-3 border p-2">
									<div className="min-w-0 flex-1">
										<p>{p.message}</p>
										<p className="text-[13px] text-muted-foreground">{p.how}</p>
									</div>
									<Button size="sm" onPress={() => goTo(p.blockId)}>
										Go There
									</Button>
								</li>
							))}
						</ul>
					</>
				)}
				<DialogFooter>
					<Button onPress={() => setProblems(accessibilityProblems(blocks()))}>Check Again</Button>
					<Button onPress={onClose}>Close</Button>
				</DialogFooter>
			</div>
		</Dialog>
	);
}
