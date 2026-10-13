// A right-click menu: opened at the pointer, closed by a click elsewhere or Escape, and usable with the arrow keys.

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

export type MenuEntry =
	| "separator"
	| {
			label: string;
			icon?: ReactNode;
			shortcut?: string;
			danger?: boolean;
			disabled?: boolean;
			onSelect: () => void;
	  };

interface OpenMenu {
	x: number;
	y: number;
	entries: MenuEntry[];
}

// `open` is called from an onContextMenu handler; `menu` goes anywhere in the tree
export function useContextMenu() {
	const [state, setState] = useState<OpenMenu | null>(null);
	const open = useCallback((e: { clientX: number; clientY: number; preventDefault: () => void }, entries: MenuEntry[]) => {
		e.preventDefault();
		setState({ x: e.clientX, y: e.clientY, entries });
	}, []);
	const close = useCallback(() => setState(null), []);
	return { open, menu: state ? <ContextMenu {...state} onClose={close} /> : null };
}

function ContextMenu({ x, y, entries, onClose }: OpenMenu & { onClose: () => void }) {
	const ref = useRef<HTMLDivElement>(null);
	const [at, setAt] = useState({ x, y });

	// Keep the menu inside the window
	useEffect(() => {
		const box = ref.current?.getBoundingClientRect();
		if (!box) return;
		setAt({ x: Math.min(x, window.innerWidth - box.width - 8), y: Math.min(y, window.innerHeight - box.height - 8) });
		ref.current?.querySelector<HTMLElement>("[role=menuitem]:not([aria-disabled=true])")?.focus();
	}, [x, y]);

	useEffect(() => {
		const away = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && onClose();
		const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
		window.addEventListener("pointerdown", away, true);
		window.addEventListener("keydown", esc);
		window.addEventListener("blur", onClose);
		return () => {
			window.removeEventListener("pointerdown", away, true);
			window.removeEventListener("keydown", esc);
			window.removeEventListener("blur", onClose);
		};
	}, [onClose]);

	const onKeyDown = (e: React.KeyboardEvent) => {
		if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
		e.preventDefault();
		const items = Array.from(ref.current?.querySelectorAll<HTMLElement>("[role=menuitem]:not([aria-disabled=true])") ?? []);
		const next = items.indexOf(document.activeElement as HTMLElement) + (e.key === "ArrowDown" ? 1 : -1);
		items[(next + items.length) % items.length]?.focus();
	};

	return (
		<div ref={ref} role="menu" onKeyDown={onKeyDown} style={{ left: at.x, top: at.y }} className="fixed z-[80] min-w-52 border bg-popover p-1 text-sm text-popover-foreground ring-1 ring-foreground/10">
			{entries.map((entry, i) =>
				entry === "separator" ? (
					<div key={i} role="separator" className="my-1 border-t" />
				) : (
					<button
						key={i}
						type="button"
						role="menuitem"
						aria-disabled={entry.disabled || undefined}
						onClick={() => {
							if (entry.disabled) return;
							onClose();
							entry.onSelect();
						}}
						className={cn("flex w-full items-center gap-3 px-3 py-1.5 text-left outline-none hover:bg-muted focus-visible:bg-muted", entry.danger && "text-destructive", entry.disabled && "opacity-50")}
					>
						{entry.icon && <span className="shrink-0">{entry.icon}</span>}
						<span className="flex-1">{entry.label}</span>
						{entry.shortcut && <kbd className="font-mono text-xs text-muted-foreground">{entry.shortcut}</kbd>}
					</button>
				),
			)}
		</div>
	);
}
