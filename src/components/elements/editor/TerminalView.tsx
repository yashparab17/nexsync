// One terminal: an xterm.js emulator wired to a shell running in a pseudo-terminal on this device. The emulator and its
// add-ons load the first time a terminal is opened.

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { Terminal as XTerm, ITheme } from "@xterm/xterm";
import type { SearchAddon } from "@xterm/addon-search";
import type { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

import { Search, X } from "@/components/animate-icons";
import { Button } from "@/components/ui/button";
import { useEditorPrefs } from "@/lib/editorPrefs";
import { closeTerminal, onTerminalData, onTerminalExit, openTerminal, resizeTerminal, writeTerminal } from "@/lib/tauri";
import { useThemeContext } from "@/store/ThemeContext";

export interface TerminalHandle {
	focus: () => void;
	clear: () => void;
	// Text typed into the shell as if it were pasted
	send: (text: string) => void;
}

interface TerminalViewProps {
	workspacePath: string;
	dir: string;
	// Whether it is on screen; a hidden terminal keeps running but cannot be measured
	visible: boolean;
	onExit: (code: number | null) => void;
	onFailed: (message: string) => void;
}

// The colours of the app, so the terminal matches the editor in both themes
function themeFromTokens(): ITheme {
	const css = getComputedStyle(document.documentElement);
	const v = (name: string) => css.getPropertyValue(name).trim();
	const primary = v("--primary");
	return {
		background: v("--background"),
		foreground: v("--foreground"),
		cursor: primary,
		cursorAccent: v("--background"),
		selectionBackground: `${primary}44`,
		black: v("--input"),
		red: v("--destructive"),
		green: v("--success"),
		yellow: v("--warning"),
		blue: v("--info"),
		magenta: v("--info"),
		cyan: primary,
		white: v("--foreground"),
		brightBlack: v("--muted-foreground"),
		brightRed: v("--destructive"),
		brightGreen: v("--success"),
		brightYellow: v("--warning"),
		brightBlue: v("--info"),
		brightMagenta: v("--info"),
		brightCyan: primary,
		brightWhite: v("--foreground"),
	};
}

const fromBase64 = (data: string) => Uint8Array.from(atob(data), (c) => c.charCodeAt(0));

const TerminalView = forwardRef<TerminalHandle, TerminalViewProps>(function TerminalView({ workspacePath, dir, visible, onExit, onFailed }, ref) {
	const host = useRef<HTMLDivElement>(null);
	const term = useRef<XTerm | null>(null);
	const fit = useRef<FitAddon | null>(null);
	const search = useRef<SearchAddon | null>(null);
	const idRef = useRef<string | null>(null);
	const visibleRef = useRef(visible);
	visibleRef.current = visible;
	const exitRef = useRef(onExit);
	exitRef.current = onExit;
	const failedRef = useRef(onFailed);
	failedRef.current = onFailed;
	const { fontSize } = useEditorPrefs();
	const { isDark } = useThemeContext();
	const [searching, setSearching] = useState(false);
	const [query, setQuery] = useState("");

	useImperativeHandle(ref, () => ({
		focus: () => term.current?.focus(),
		clear: () => term.current?.clear(),
		send: (text) => term.current?.paste(text),
	}));

	useEffect(() => {
		let disposed = false;
		const cleanups: (() => void)[] = [];
		void (async () => {
			try {
				const [{ Terminal }, { FitAddon }, { SearchAddon }, { WebLinksAddon }] = await Promise.all([
					import("@xterm/xterm"),
					import("@xterm/addon-fit"),
					import("@xterm/addon-search"),
					import("@xterm/addon-web-links"),
				]);
				if (disposed || !host.current) return;
				const t = new Terminal({
					fontFamily: getComputedStyle(document.documentElement).getPropertyValue("--font-mono").trim() || "monospace",
					fontSize: 13,
					cursorBlink: true,
					scrollback: 5000,
					allowProposedApi: true,
					theme: themeFromTokens(),
				});
				const fitAddon = new FitAddon();
				const searchAddon = new SearchAddon();
				t.loadAddon(fitAddon);
				t.loadAddon(searchAddon);
				t.loadAddon(
					new WebLinksAddon((_e, uri) => {
						void import("@tauri-apps/plugin-opener").then((m) => m.openUrl(uri)).catch(() => {});
					}),
				);
				t.open(host.current);
				term.current = t;
				fit.current = fitAddon;
				search.current = searchAddon;
				if (visibleRef.current) fitAddon.fit();

				// What the shell prints can arrive before open resolves with its id, so it is held until the id is known
				const early: { id: string; data: string }[] = [];
				const write = (data: string) => t.write(fromBase64(data));
				const offData = await onTerminalData((e) => (idRef.current ? e.id === idRef.current && write(e.data) : early.push(e)));
				const offExit = await onTerminalExit((e) => e.id === idRef.current && exitRef.current(e.code));
				cleanups.push(offData, offExit);
				if (disposed) return;

				const id = await openTerminal(workspacePath, dir, t.cols, t.rows);
				if (disposed) {
					void closeTerminal(id);
					return;
				}
				idRef.current = id;
				if (visibleRef.current) t.focus();
				early.filter((e) => e.id === id).forEach((e) => write(e.data));

				t.onData((data) => void writeTerminal(id, data).catch(() => {}));
				t.onResize(({ cols, rows }) => void resizeTerminal(id, cols, rows).catch(() => {}));

				// Copy and paste as other terminals do: Ctrl+Shift+C and V (Cmd+C with a selection on a Mac); Ctrl+Shift+F searches
				t.attachCustomKeyEventHandler((e) => {
					if (e.type !== "keydown") return true;
					const copy = (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "c") || (e.metaKey && e.key.toLowerCase() === "c" && t.hasSelection());
					if (copy) {
						void navigator.clipboard.writeText(t.getSelection()).catch(() => {});
						return false;
					}
					if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "v") {
						void navigator.clipboard.readText().then((text) => t.paste(text)).catch(() => {});
						return false;
					}
					if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "f") {
						setSearching(true);
						return false;
					}
					return true;
				});

				const resize = new ResizeObserver(() => {
					if (visibleRef.current && host.current && host.current.clientWidth > 0) fitAddon.fit();
				});
				resize.observe(host.current);
				cleanups.push(() => resize.disconnect());
			} catch (err) {
				failedRef.current(err instanceof Error ? err.message : String(err));
			}
		})();
		return () => {
			disposed = true;
			cleanups.forEach((fn) => fn());
			if (idRef.current) void closeTerminal(idRef.current);
			term.current?.dispose();
			term.current = null;
		};
		// A terminal is opened once for its folder; theme and font follow below
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [workspacePath, dir]);

	useEffect(() => {
		if (!term.current) return;
		term.current.options.fontSize = fontSize;
		if (visible) fit.current?.fit();
	}, [fontSize, visible]);

	useEffect(() => {
		// The theme class is applied before this runs, so the tokens already hold the new colours
		if (term.current) term.current.options.theme = themeFromTokens();
	}, [isDark]);

	// A terminal that comes back on screen measures its letters again and sets its own font size again, so it never keeps a
	// size worked out while it was hidden
	useEffect(() => {
		const t = term.current;
		if (!visible || !t) return;
		t.options.fontSize = fontSize + 1;
		t.options.fontSize = fontSize;
		fit.current?.fit();
		t.refresh(0, t.rows - 1);
		t.focus();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [visible]);

	const find = (backwards: boolean) => {
		if (!query) return;
		const opts = { caseSensitive: false };
		if (backwards) search.current?.findPrevious(query, opts);
		else search.current?.findNext(query, opts);
	};

	return (
		<div className="relative h-full w-full bg-background pl-3">
			<div ref={host} className="h-full w-full" />
			{searching && (
				<div role="search" className="absolute top-1 right-3 z-10 flex items-center gap-1 border bg-popover p-1 shadow-md">
					<Search className="ml-1 size-3.5 text-muted-foreground" />
					<input
						autoFocus
						aria-label="Find in terminal"
						value={query}
						placeholder="Find"
						onChange={(e) => {
							setQuery(e.target.value);
							search.current?.findNext(e.target.value, { caseSensitive: false, incremental: true });
						}}
						onKeyDown={(e) => {
							if (e.key === "Enter") find(e.shiftKey);
							else if (e.key === "Escape") {
								setSearching(false);
								search.current?.clearDecorations();
								term.current?.focus();
							}
						}}
						className="h-7 w-44 bg-transparent px-2 font-mono text-sm outline-none focus-visible:shadow-[inset_0_-2px_0_var(--primary)]"
					/>
					<Button
						variant="ghost"
						size="icon-xs"
						aria-label="Close find"
						onPress={() => {
							setSearching(false);
							search.current?.clearDecorations();
							term.current?.focus();
						}}
					>
						<X className="size-3.5" />
					</Button>
				</div>
			)}
		</div>
	);
});

export default TerminalView;
