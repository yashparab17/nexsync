import { ArrowLeft } from "lucide-react";
import { useState, type ElementType, type ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface BackstageItem {
	id: string;
	label: string;
	icon?: ElementType;
	panel: ReactNode;
}

// The File tab: a column of choices at the left in the colour of the program, and what the choice shows beside it
export default function Backstage({ items, onBack, accent }: { items: BackstageItem[]; onBack: () => void; accent: string }) {
	const [current, setCurrent] = useState(items[0]?.id);
	const shown = items.find((i) => i.id === current) ?? items[0];
	return (
		<div className="flex h-full min-h-0">
			<nav aria-label="File" className="flex w-56 shrink-0 flex-col py-2 text-white" style={{ background: accent }}>
				<button type="button" onClick={onBack} aria-label="Back to the document" className="mx-3 mb-3 flex size-9 items-center justify-center rounded-full outline-none hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-white">
					<ArrowLeft className="size-5" />
				</button>
				{items.map((i) => {
					const Icon = i.icon;
					return (
						<button key={i.id} type="button" aria-current={i.id === shown?.id} onClick={() => setCurrent(i.id)} className={cn("flex items-center gap-3 px-5 py-2.5 text-left text-[14px] outline-none hover:bg-white/15 focus-visible:bg-white/20", i.id === shown?.id && "bg-black/20")}>
							{Icon && <Icon className="size-4" />}
							{i.label}
						</button>
					);
				})}
			</nav>
			<div className="min-w-0 flex-1 overflow-auto p-8">{shown?.panel}</div>
		</div>
	);
}
