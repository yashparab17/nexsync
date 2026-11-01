import { Pause } from "lucide-react";
import { useEffect } from "react";

import { ChevronLeft, ChevronRight, Play } from "@/components/animate-icons";
import { IconButton } from "@/components/ui/icon-button";
import { colorOf } from "@/lib/collabColor";
import { cn } from "@/lib/utils";
import type { FileVersion } from "@/types/workspace";

const STEP_MS = 900;

interface HistoryScrubberProps {
	// Newest first, as the history lists them
	versions: FileVersion[];
	selected: number | null;
	onSelect: (id: number) => void;
	playing: boolean;
	onPlayingChange: (playing: boolean) => void;
}

// A file's saved versions as a row of marks from the oldest on the left to the newest on the right. Click a mark, step with the arrows
// or play through to watch the file grow; the diff beside it follows. A mark takes its author's colour when the version has one.
export default function HistoryScrubber({ versions, selected, onSelect, playing, onPlayingChange }: HistoryScrubberProps) {
	const ordered = [...versions].reverse();
	const at = ordered.findIndex((v) => v.id === selected);
	const go = (index: number) => ordered[index] && onSelect(ordered[index].id);

	// Plays toward the newest version and stops there
	useEffect(() => {
		if (!playing) return;
		if (at < 0 || at >= ordered.length - 1) return onPlayingChange(false);
		const timer = setTimeout(() => go(at + 1), STEP_MS);
		return () => clearTimeout(timer);
		// eslint-disable-next-line react-hooks/exhaustive-deps -- go only reads the current list
	}, [playing, at, ordered.length]);

	if (ordered.length < 2) return null;
	return (
		<div
			className="flex items-center gap-2"
			role="group"
			aria-label="Scrub through versions"
			onKeyDown={(e) => {
				if (e.key === "ArrowLeft") go(Math.max(0, at - 1));
				else if (e.key === "ArrowRight") go(Math.min(ordered.length - 1, at + 1));
				else return;
				e.preventDefault();
			}}
		>
			<IconButton label="Older version" size="xs" isDisabled={at <= 0} onPress={() => go(at - 1)}>
				<ChevronLeft className="size-4" />
			</IconButton>
			<IconButton
				label={playing ? "Pause" : at >= ordered.length - 1 ? "Play from the start" : "Play"}
				size="xs"
				onPress={() => {
					if (!playing && at >= ordered.length - 1) go(0);
					onPlayingChange(!playing);
				}}
			>
				{playing ? <Pause className="size-4" /> : <Play className="size-4" />}
			</IconButton>
			<IconButton label="Newer version" size="xs" isDisabled={at < 0 || at >= ordered.length - 1} onPress={() => go(at + 1)}>
				<ChevronRight className="size-4" />
			</IconButton>
			<div className="flex h-8 min-w-0 flex-1 items-end gap-px border-b">
				{ordered.map((v, i) => (
					<button
						key={v.id}
						type="button"
						aria-label={`${new Date(v.createdAt).toLocaleString()}${v.label ? `, ${v.label}` : ""}`}
						aria-current={v.id === selected}
						title={`${new Date(v.createdAt).toLocaleString()}${v.label ? ` · ${v.label}` : ""}${v.author ? ` · ${v.author}` : ""}`}
						onClick={() => {
							onPlayingChange(false);
							onSelect(v.id);
						}}
						className="group flex h-full min-w-1 flex-1 items-end justify-center outline-none"
					>
						<span
							className={cn(
								"w-full max-w-3 transition-[height,background-color] group-hover:h-5 group-hover:bg-primary/60 group-focus-visible:h-5 group-focus-visible:bg-primary/60",
								v.id === selected ? "h-7 bg-primary" : i < at ? "h-3 bg-foreground/40" : "h-3 bg-foreground/20",
							)}
							style={v.author && v.id !== selected ? { backgroundColor: colorOf(v.author) } : undefined}
						/>
					</button>
				))}
			</div>
		</div>
	);
}
