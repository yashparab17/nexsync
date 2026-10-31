import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

import logoBlack from "@/assets/logos/logo-black.svg";
import logoWhite from "@/assets/logos/logo-white.svg";
import { cn } from "@/lib/utils";

// macOS keeps its own traffic-light buttons (the window is configured to draw them over this bar, see
// tauri.macos.conf.json), so the bar only leaves room for them; they also give macOS its native full screen and tiling.
const IS_MAC = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform || navigator.userAgent);

const glyph = { fill: "none", stroke: "currentColor", strokeWidth: 1, className: "size-[10px]", viewBox: "0 0 10 10", "aria-hidden": true } as const;
const Minimize = () => (
	<svg {...glyph}>
		<path d="M0 5.5h10" />
	</svg>
);
const Maximize = () => (
	<svg {...glyph}>
		<rect x="0.5" y="0.5" width="9" height="9" />
	</svg>
);
// Two squares: the window is maximized and this puts it back
const Restore = () => (
	<svg {...glyph}>
		<rect x="0.5" y="2.5" width="7" height="7" />
		<path d="M2.5 2.5v-2h7v7h-2" />
	</svg>
);
const Close = () => (
	<svg {...glyph}>
		<path d="M0.5 0.5l9 9M9.5 0.5l-9 9" />
	</svg>
);

// Window chrome drawn by the app (native decorations are off in tauri.conf.json). Dragging the bar moves the window and
// can snap it to a screen edge or into a tiling layout; double-clicking it maximizes. Tiling window managers on Linux
// manage the size themselves and ignore the buttons, which stay as a fallback.
export default function TitleBar() {
	const [maximized, setMaximized] = useState(false);

	useEffect(() => {
		let off: (() => void) | undefined;
		let gone = false;
		try {
			const win = getCurrentWindow();
			const sync = () => void win.isMaximized().then((m) => !gone && setMaximized(m), () => {});
			sync();
			// A resize covers maximizing, restoring and snapping, whoever did it
			void win.onResized(sync).then((f) => (gone ? f() : (off = f)), () => {});
		} catch {
			// Not running inside the desktop app
		}
		return () => {
			gone = true;
			off?.();
		};
	}, []);

	const controls = [
		{ label: "Minimize", icon: <Minimize />, run: () => getCurrentWindow().minimize() },
		{ label: maximized ? "Restore" : "Maximize", icon: maximized ? <Restore /> : <Maximize />, run: () => getCurrentWindow().toggleMaximize() },
		{ label: "Close", icon: <Close />, run: () => getCurrentWindow().close(), danger: true },
	];

	return (
		<header className="relative z-[60] grid h-10 shrink-0 select-none grid-cols-[minmax(0,1fr)_minmax(0,32rem)_minmax(0,1fr)] items-center">
			{/* The app, then back and forward once a workspace is open */}
			<div data-tauri-drag-region className={cn("flex h-full min-w-0 items-center gap-2", IS_MAC ? "pl-20" : "pl-3")}>
				{!IS_MAC && (
					<>
						<img src={logoBlack} alt="" draggable={false} className="pointer-events-none size-5 dark:hidden" />
						<img src={logoWhite} alt="" draggable={false} className="pointer-events-none hidden size-5 dark:block" />
					</>
				)}
				<span className="pointer-events-none mr-2 text-sm font-semibold">Nexsync</span>
				<div id="titlebar-left" className="flex items-center gap-0.5" />
			</div>
			{/* The search of a workspace sits in the middle column, so it is centred on the window whatever is at either side */}
			<div id="titlebar-center" data-tauri-drag-region className="flex h-full min-w-0 items-center justify-center" />
			<div data-tauri-drag-region className="flex h-full min-w-0 items-center justify-end">
				<div id="titlebar-right" className="flex min-w-0 items-center gap-1 pr-1" />
				{!IS_MAC &&
				controls.map(({ label, icon, run, danger }) => (
					<button
						key={label}
						type="button"
						onClick={run}
						aria-label={label}
						title={label}
						className={cn(
							"flex h-full w-12 items-center justify-center text-muted-foreground outline-none transition-colors focus-visible:bg-muted",
							danger ? "hover:bg-destructive hover:text-white focus-visible:bg-destructive focus-visible:text-white" : "hover:bg-muted hover:text-foreground",
						)}
					>
						{icon}
					</button>
				))}
			</div>
		</header>
	);
}
