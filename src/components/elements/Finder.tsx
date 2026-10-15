// A Telescope-style finder: a search box over a fuzzy-filtered list, with an optional preview of the highlighted item.
// The caller owns what the items are and what choosing one does; the finder owns typing, matching and keys.

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";

import { Dialog } from "@/components/ui/dialog";
import { fuzzyFilter } from "@/lib/fuzzy";
import { cn } from "@/lib/utils";

export interface FinderItem {
	id: string;
	label: string;
	// A second, quieter line or column, such as the folder a file is in
	detail?: string;
	// Shown at the right edge, such as a keyboard shortcut
	hint?: string;
	icon?: ReactNode;
	// A heading this item sits under when nothing is typed
	group?: string;
}

interface FinderProps {
	open: boolean;
	onClose: () => void;
	// What is typed; the caller decides what a leading character such as > or : means
	query: string;
	onQueryChange: (query: string) => void;
	// The part of the query used for matching; defaults to all of it
	filterText?: string;
	placeholder: string;
	label: string;
	items: FinderItem[];
	// Choosing the highlighted item; `alt` is Ctrl or Cmd+Enter, which callers use for "open to the side"
	onChoose: (item: FinderItem, alt: boolean) => void;
	renderPreview?: (item: FinderItem) => ReactNode;
	// Shown instead of the list when nothing matches
	empty?: ReactNode;
	// Replaces the list entirely, for a mode with its own meaning such as "go to line"
	message?: ReactNode;
	footer?: ReactNode;
	// Ctrl or Cmd+Enter when nothing matches, for "make one from what I typed"
	onSubmitEmpty?: () => void;
}

// The label with the letters that matched in bold
function Highlighted({ text, indexes }: { text: string; indexes: Set<number> }) {
	if (indexes.size === 0) return <>{text}</>;
	return (
		<>
			{[...text].map((ch, i) =>
				indexes.has(i) ? (
					<span key={i} className="font-semibold text-primary">
						{ch}
					</span>
				) : (
					ch
				),
			)}
		</>
	);
}

export default function Finder({ open, onClose, query, onQueryChange, filterText, placeholder, label, items, onChoose, renderPreview, empty, message, footer, onSubmitEmpty }: FinderProps) {
	const listId = useId();
	const [index, setIndex] = useState(0);
	const listRef = useRef<HTMLUListElement>(null);

	const shown = useMemo(() => fuzzyFilter(items, filterText ?? query, (item) => item.label + " " + (item.detail ?? "")), [items, filterText, query]);
	const filtering = (filterText ?? query).trim() !== "";

	// A new search starts at the top
	useEffect(() => setIndex(0), [query, open]);
	// Keep the highlighted row in view as the arrows move it
	useEffect(() => {
		listRef.current?.querySelector<HTMLElement>(`[data-index="${index}"]`)?.scrollIntoView({ block: "nearest" });
	}, [index]);

	const current = shown[index]?.item;
	// Items without an icon keep the icon's column, so labels line up
	const anyIcon = items.some((item) => item.icon);

	const move = (step: number) => setIndex((i) => Math.min(Math.max(i + step, 0), Math.max(shown.length - 1, 0)));

	const onKeyDown = (e: React.KeyboardEvent) => {
		const ctrl = e.ctrlKey || e.metaKey;
		if (e.key === "ArrowDown" || (ctrl && (e.key === "j" || e.key === "n"))) {
			e.preventDefault();
			move(1);
		} else if (e.key === "ArrowUp" || (ctrl && (e.key === "k" || e.key === "p"))) {
			e.preventDefault();
			move(-1);
		} else if (e.key === "Enter" && current && !message) {
			e.preventDefault();
			onChoose(current, ctrl);
		} else if (e.key === "Enter" && ctrl && !current && !message) {
			e.preventDefault();
			onSubmitEmpty?.();
		}
	};

	const rows: ReactNode[] = [];
	let lastGroup: string | undefined;
	shown.forEach(({ item, match }, i) => {
		if (!filtering && item.group && item.group !== lastGroup) {
			lastGroup = item.group;
			rows.push(
				<li key={`group-${item.group}`} role="presentation" className="px-3 pt-3 pb-1 font-mono text-xs text-muted-foreground">
					{item.group}
				</li>,
			);
		}
		// Matches are positions in "label detail"; only the ones inside the label are highlighted
		const inLabel = new Set(match.indexes.filter((n) => n < item.label.length));
		rows.push(
			<li
				key={item.id}
				id={`${listId}-${i}`}
				data-index={i}
				role="option"
				aria-selected={i === index}
				onMouseMove={() => i !== index && setIndex(i)}
				onClick={() => onChoose(item, false)}
				className={cn("flex cursor-pointer items-center gap-3 px-3 py-2 text-sm", i === index ? "bg-primary/10 shadow-[inset_2px_0_0_var(--primary)]" : "hover:bg-muted/50")}
			>
				{anyIcon && <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">{item.icon}</span>}
				<span className="min-w-0 flex-1 truncate">
					<Highlighted text={item.label} indexes={inLabel} />
					{item.detail && <span className="ml-2 font-mono text-xs text-muted-foreground">{item.detail}</span>}
				</span>
				{item.hint && <kbd className="shrink-0 border bg-card px-2 py-0.5 font-mono text-xs text-muted-foreground">{item.hint}</kbd>}
			</li>,
		);
	});

	return (
		<Dialog isOpen={open} onOpenChange={(next) => !next && onClose()} showCloseButton={false} className={cn("top-[18%] translate-y-0 gap-0 overflow-hidden p-0", renderPreview ? "sm:max-w-5xl" : "sm:max-w-2xl")}>
			<div className="flex flex-col">
				<input
					autoFocus
					role="combobox"
					aria-label={label}
					aria-expanded
					aria-controls={listId}
					aria-activedescendant={current ? `${listId}-${index}` : undefined}
					aria-autocomplete="list"
					value={query}
					onChange={(e) => onQueryChange(e.target.value)}
					onKeyDown={onKeyDown}
					placeholder={placeholder}
					spellCheck={false}
					autoComplete="off"
					className="h-12 border-0 border-b bg-transparent px-4 font-mono text-xs outline-none transition-shadow placeholder:text-muted-foreground focus-visible:shadow-[inset_0_-2px_0_var(--primary)]"
				/>
				<div className={cn("grid min-h-0", renderPreview ? "grid-cols-[minmax(0,1fr)_minmax(0,1fr)]" : "grid-cols-1")} style={{ height: "min(26rem, 60vh)" }}>
					{message ? (
						<div className="p-4 text-sm text-muted-foreground">{message}</div>
					) : shown.length === 0 ? (
						<div className="p-4 text-sm text-muted-foreground">{empty ?? "No matches."}</div>
					) : (
						<ul ref={listRef} id={listId} role="listbox" aria-label={label} className="min-h-0 overflow-y-auto py-1">
							{rows}
						</ul>
					)}
					{renderPreview && <div className="hidden min-h-0 overflow-hidden border-l bg-card/40 md:block">{current && !message ? renderPreview(current) : null}</div>}
				</div>
				{footer && <div className="flex items-center gap-4 border-t px-4 py-2 font-mono text-xs text-muted-foreground">{footer}</div>}
			</div>
		</Dialog>
	);
}
