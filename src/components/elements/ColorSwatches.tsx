// A row of the colours a person or a workspace may take, with the one in use marked. `null` is none chosen (grey).

import { Check } from "@/components/animate-icons";
import { PALETTE } from "@/lib/collabColor";
import { cn } from "@/lib/utils";

export default function ColorSwatches({ value, onChange, label = "Colour" }: { value: string | null | undefined; onChange: (color: string | null) => void; label?: string }) {
	return (
		<div role="group" aria-label={label} className="flex flex-wrap items-center gap-2">
			{PALETTE.map((c) => (
				<button
					key={c}
					type="button"
					aria-label={`Use ${c}`}
					aria-pressed={value === c}
					onClick={() => onChange(c)}
					style={{ background: c }}
					className={cn("flex size-6 cursor-pointer items-center justify-center rounded-full text-white outline-none focus-visible:ring-2 focus-visible:ring-foreground/40", value === c && "ring-2 ring-foreground")}
				>
					{value === c && <Check className="size-3.5" />}
				</button>
			))}
			{value && (
				<button type="button" onClick={() => onChange(null)} className="h-6 cursor-pointer px-2 font-mono text-[13px] text-muted-foreground outline-none hover:text-foreground focus-visible:text-foreground">
					None
				</button>
			)}
		</div>
	);
}
