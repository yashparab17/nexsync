import { useState } from "react";

import { ExternalLink, Play, RefreshCw } from "@/components/animate-icons";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const WIDTHS = [
	{ key: "fit", label: "Fit", width: null },
	{ key: "phone", label: "Phone", width: 390 },
	{ key: "tablet", label: "Tablet", width: 768 },
	{ key: "laptop", label: "Laptop", width: 1280 },
] as const;

// The running app, in a frame: pick the port, the page and a width. Only this device's own addresses can be framed (the app's
// content policy allows nothing else), and the frame cannot reach the app: it is another origin.
export default function PreviewPane({ ports, running, startLabel, onStart, onOpenUrl }: { ports: number[]; running: boolean; startLabel: string | null; onStart: () => void; onOpenUrl: (url: string) => void }) {
	const [port, setPort] = useState<number | null>(null);
	const [path, setPath] = useState("/");
	const [size, setSize] = useState<(typeof WIDTHS)[number]["key"]>("fit");
	const [reload, setReload] = useState(0);
	const active = port !== null && ports.includes(port) ? port : ports[0];
	const clean = path.startsWith("/") ? path : `/${path}`;
	const url = active ? `http://localhost:${active}${clean}` : null;
	const width = WIDTHS.find((w) => w.key === size)?.width ?? null;

	if (!url) {
		return (
			<div className="flex flex-col items-start gap-3 text-sm text-muted-foreground">
				<p>{running ? "The task is starting. The preview appears when it says which port it uses." : "Nothing is serving this project yet. Start its dev server and the app shows here, and a change a teammate saves reloads it, because their edit arrives as a file change on this device."}</p>
				{startLabel && !running && (
					<Button onPress={onStart}>
						<Play className="size-4" />
						{startLabel}
					</Button>
				)}
			</div>
		);
	}

	return (
		<div className="flex min-h-0 flex-1 flex-col gap-3">
			<div className="flex flex-wrap items-center gap-2">
				{ports.length > 1 && (
					<select aria-label="Port" value={active} onChange={(e) => setPort(Number(e.target.value))} className="h-8 cursor-pointer border bg-input px-2 font-mono text-[13px]">
						{ports.map((p) => (
							<option key={p} value={p}>
								localhost:{p}
							</option>
						))}
					</select>
				)}
				{ports.length === 1 && <span className="font-mono text-[13px] text-muted-foreground">localhost:{active}</span>}
				<input
					aria-label="Page"
					value={path}
					onChange={(e) => setPath(e.target.value)}
					onKeyDown={(e) => e.key === "Enter" && setReload((n) => n + 1)}
					spellCheck={false}
					className="h-8 min-w-32 flex-1 border bg-input px-2 font-mono text-[13px]"
				/>
				<div role="group" aria-label="Width" className="flex items-center">
					{WIDTHS.map((w) => (
						<button key={w.key} type="button" aria-pressed={size === w.key} onClick={() => setSize(w.key)} className={cn("h-8 px-3 text-sm outline-none focus-visible:bg-muted", size === w.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")}>
							{w.label}
						</button>
					))}
				</div>
				<Button variant="ghost" size="icon-sm" aria-label="Reload" onPress={() => setReload((n) => n + 1)}>
					<RefreshCw className="size-4" />
				</Button>
				<Button variant="ghost" size="icon-sm" aria-label="Open in the browser" onPress={() => onOpenUrl(url)}>
					<ExternalLink className="size-4" />
				</Button>
			</div>
			<div className="flex min-h-96 flex-1 justify-center overflow-auto bg-muted/40">
				<iframe
					key={`${url}#${reload}`}
					title="Preview of the running app"
					src={url}
					sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
					style={width ? { width } : undefined}
					className={cn("h-full min-h-96 bg-white", !width && "w-full")}
				/>
			</div>
		</div>
	);
}
