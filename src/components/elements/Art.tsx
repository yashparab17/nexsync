// The illustrations (unDraw, recoloured to theme tokens by scripts/recolour-art.py): loaded the first time one is shown and drawn
// inline, so their colours follow whichever theme is on. Purely decorative, so hidden from screen readers.

import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

const files = import.meta.glob("../../assets/art/*.svg", { query: "?raw", import: "default" }) as Record<string, () => Promise<string>>;

export type ArtName = "tasks" | "kanban" | "files" | "assets" | "trash" | "notes" | "editor" | "recent" | "insights" | "members" | "welcome" | "search";

export default function Art({ name, className }: { name: ArtName; className?: string }) {
	const [svg, setSvg] = useState("");
	useEffect(() => {
		let live = true;
		void files[`../../assets/art/${name}.svg`]?.().then((s) => live && setSvg(s));
		return () => {
			live = false;
		};
	}, [name]);
	return <div aria-hidden className={cn("pointer-events-none select-none [&>svg]:h-full [&>svg]:w-full", className)} dangerouslySetInnerHTML={{ __html: svg }} />;
}
