// The Terminal tab: any number of shells side by side in a list, like VS Code's integrated terminal. They keep running
// while the panel is hidden or another tab is showing; closing one ends its shell.

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";

import { Plus, RefreshCw, Terminal, Trash2, X } from "@/components/animate-icons";
import TerminalView, { type TerminalHandle } from "./TerminalView";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Instance {
	key: number;
	title: string;
	// How it ended, once it has; a failure to start has a message instead
	ended: { code: number | null } | { error: string } | null;
	// Changes when it is restarted, so a new shell replaces the old view
	run: number;
}

// What the panel header needs to offer a switcher between terminals
export interface TerminalSummary {
	items: { key: number; title: string; ended: boolean }[];
	active: number | null;
}

export interface TerminalPanelHandle {
	newTerminal: () => void;
	select: (key: number) => void;
	close: (key: number) => void;
	// Text for the shell in front, typed as if pasted
	send: (text: string) => void;
}

interface TerminalPanelProps {
	workspacePath: string;
	dir: string;
	// Whether the Terminal tab is on screen
	visible: boolean;
	// Told whenever terminals open, close or change, so the panel header can switch between them
	onSummary?: (summary: TerminalSummary) => void;
}

const TerminalPanel = forwardRef<TerminalPanelHandle, TerminalPanelProps>(function TerminalPanel({ workspacePath, dir, visible, onSummary }, ref) {
	const [items, setItems] = useState<Instance[]>([]);
	const [active, setActive] = useState<number | null>(null);
	const counter = useRef(0);
	const views = useRef(new Map<number, TerminalHandle | null>());

	const create = useCallback(() => {
		const key = ++counter.current;
		setItems((prev) => [...prev, { key, title: `Terminal ${key}`, ended: null, run: 0 }]);
		setActive(key);
	}, []);

	// The first shell starts when the panel is first looked at, not when the Editor opens
	useEffect(() => {
		if (visible && counter.current === 0) create();
	}, [visible, create]);

	const summaryRef = useRef(onSummary);
	summaryRef.current = onSummary;
	useEffect(() => {
		summaryRef.current?.({ items: items.map((i) => ({ key: i.key, title: i.title, ended: !!i.ended })), active });
	}, [items, active]);

	useImperativeHandle(ref, () => ({
		newTerminal: create,
		select: setActive,
		close: (key) => close(key),
		send: (text) => active !== null && views.current.get(active)?.send(text),
	}));

	const close = (key: number) => {
		setItems((prev) => {
			const next = prev.filter((i) => i.key !== key);
			if (active === key) setActive(next[Math.max(0, prev.findIndex((i) => i.key === key) - 1)]?.key ?? null);
			return next;
		});
		views.current.delete(key);
	};

	const patch = (key: number, change: Partial<Instance>) => setItems((prev) => prev.map((i) => (i.key === key ? { ...i, ...change } : i)));

	const current = items.find((i) => i.key === active);

	// Ctrl+PageDown and Ctrl+PageUp move to the next and previous terminal, as in VS Code
	const onKeyDownCapture = (e: React.KeyboardEvent) => {
		if (!e.ctrlKey || e.altKey || e.metaKey || (e.key !== "PageDown" && e.key !== "PageUp") || items.length < 2) return;
		e.preventDefault();
		e.stopPropagation();
		const at = items.findIndex((i) => i.key === active);
		setActive(items[(at + (e.key === "PageDown" ? 1 : -1) + items.length) % items.length].key);
	};

	return (
		<div className="flex h-full min-h-0" onKeyDownCapture={onKeyDownCapture}>
			<div className="relative min-w-0 flex-1">
				{items.length === 0 && (
					<div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
						<p>No terminals are open.</p>
						<Button size="sm" onPress={create}>
							<Plus className="size-4" />
							New terminal
						</Button>
					</div>
				)}
				{items.map((item) => (
					<div key={`${item.key}-${item.run}`} inert={item.key !== active || !visible} className={cn("absolute inset-0", (item.key !== active || !visible) && "pointer-events-none invisible")}>
						<TerminalView
							ref={(handle) => void views.current.set(item.key, handle)}
							workspacePath={workspacePath}
							dir={dir}
							visible={visible && item.key === active}
							onExit={(code) => patch(item.key, { ended: { code } })}
							onFailed={(error) => patch(item.key, { ended: { error } })}
						/>
						{item.ended && (
							<div role="status" className="absolute inset-x-0 bottom-0 flex items-center gap-3 border-t bg-card px-4 py-2 text-sm">
								<span className={cn("min-w-0 flex-1 truncate", "error" in item.ended ? "text-destructive" : "text-muted-foreground")}>
									{"error" in item.ended ? item.ended.error : `The shell ended${item.ended.code === null ? "" : ` with exit code ${item.ended.code}`}.`}
								</span>
								<Button size="sm" variant="outline" onPress={() => patch(item.key, { ended: null, run: item.run + 1 })}>
									<RefreshCw className="size-3.5" />
									Restart
								</Button>
							</div>
						)}
					</div>
				))}
			</div>

			{/* The list of terminals, on the right as in VS Code */}
			<div role="tablist" aria-label="Terminals" aria-orientation="vertical" className="flex w-44 shrink-0 flex-col border-l bg-card/40">
				<div className="flex h-8 shrink-0 items-center justify-end gap-0.5 border-b px-1">
					<Button variant="ghost" size="icon-xs" aria-label="New terminal" onPress={create}>
						<Plus className="size-4" />
					</Button>
					<Button variant="ghost" size="icon-xs" aria-label="Clear terminal" isDisabled={!current} onPress={() => active !== null && views.current.get(active)?.clear()}>
						<Trash2 className="size-4" />
					</Button>
				</div>
				<div className="min-h-0 flex-1 overflow-y-auto">
					{items.map((item) => (
						<div key={item.key} className={cn("group flex items-center border-l-2", item.key === active ? "border-l-primary bg-background" : "border-l-transparent hover:bg-muted/50")}>
							<button
								type="button"
								role="tab"
								aria-selected={item.key === active}
								onClick={() => setActive(item.key)}
								className="flex min-w-0 flex-1 items-center gap-2 px-3 py-1.5 text-left text-sm outline-none focus-visible:bg-muted"
							>
								<Terminal className={cn("size-4 shrink-0", item.ended ? "text-muted-foreground" : "text-success")} />
								<span className="truncate">{item.title}</span>
							</button>
							<button
								type="button"
								aria-label={`Kill ${item.title}`}
								onClick={() => close(item.key)}
								className="mr-1 flex size-5 items-center justify-center text-muted-foreground opacity-0 outline-none group-hover:opacity-100 hover:text-foreground focus-visible:opacity-100"
							>
								<X className="size-3.5" />
							</button>
						</div>
					))}
				</div>
			</div>
		</div>
	);
});

export default TerminalPanel;
