import { Minus, Square, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { cn } from "@/lib/utils";
import { APP_VERSION } from "@/lib/version";

const controls = [
	{ label: "Minimize", icon: Minus, run: () => getCurrentWindow().minimize() },
	{ label: "Maximize", icon: Square, run: () => getCurrentWindow().toggleMaximize() },
	{ label: "Close", icon: X, run: () => getCurrentWindow().close(), danger: true },
];

// Minimal custom window chrome (native decorations are disabled in tauri.conf.json)
export default function TitleBar() {
	return (
		<header className="relative z-[60] flex h-8 shrink-0 select-none items-center border-b bg-background">
			<div data-tauri-drag-region className="flex h-full flex-1 items-center px-3">
				<span data-tauri-drag-region className="text-xs font-semibold text-muted-foreground">
					Nexsync <span className="font-normal normal-case tracking-normal">v{APP_VERSION}</span>
				</span>
			</div>
			{controls.map(({ label, icon: Icon, run, danger }) => (
				<button
					key={label}
					onClick={run}
					aria-label={label}
					className={cn(
						"flex h-full w-11 items-center justify-center text-muted-foreground transition-colors",
						danger ? "hover:bg-destructive hover:text-white" : "hover:bg-muted hover:text-foreground",
					)}
				>
					<Icon className={label === "Maximize" ? "size-3" : "size-3.5"} />
				</button>
			))}
		</header>
	);
}
