// The chrome the three office editors share: a coloured title bar, a strip of tabs with a File tab, a ribbon of labelled groups with
// big and small buttons, menus, colour pickers and galleries, and a coloured status bar. It is laid out the way the desktop office
// programs are, because people already know where things are in them.

import { ChevronDown, ChevronUp } from "lucide-react";
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ElementType, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";

export type Accent = "word" | "excel" | "powerpoint";

export const ACCENTS: Record<Accent, { color: string; dark: string; letter: string; app: string }> = {
	word: { color: "#2B579A", dark: "#1E3F73", letter: "W", app: "Documents" },
	excel: { color: "#217346", dark: "#185A36", letter: "S", app: "Sheets" },
	powerpoint: { color: "#B7472A", dark: "#8E3620", letter: "P", app: "Slides" },
};

const AccentContext = createContext<Accent>("word");

export interface RibbonTab {
	id: string;
	label: string;
}

// The whole window of an editor: title bar, tabs, the ribbon of the open tab, the work area and the status bar
export function OfficeFrame({
	accent,
	name,
	state,
	quick,
	people,
	actions,
	tabs,
	tab,
	onTab,
	file,
	ribbon,
	status,
	children,
}: {
	accent: Accent;
	// The document's name and a word on how it is (Saved, Read-only)
	name: string;
	state?: string;
	// Buttons at the left of the title bar (save, undo, redo)
	quick?: ReactNode;
	people?: ReactNode;
	actions?: ReactNode;
	tabs: RibbonTab[];
	tab: string;
	onTab: (id: string) => void;
	// What the File tab shows over the work area, when it is open
	file?: ReactNode;
	ribbon: ReactNode;
	status?: ReactNode;
	children: ReactNode;
}) {
	const a = ACCENTS[accent];
	const [collapsed, setCollapsed] = useState(false);
	const [peek, setPeek] = useState(false);
	const showBody = tab !== "file" && (!collapsed || peek);
	return (
		<AccentContext.Provider value={accent}>
			<div className="flex h-full min-h-0 flex-col bg-background" style={{ "--office": a.color, "--office-dark": a.dark } as CSSProperties}>
				<div className="flex h-9 shrink-0 items-center gap-2 px-2 text-white" style={{ background: a.color }}>
					<span aria-hidden className="flex size-6 items-center justify-center rounded-sm bg-white/95 text-sm font-bold" style={{ color: a.color }}>
						{a.letter}
					</span>
					<div role="toolbar" aria-label="Quick access" className="flex items-center gap-0.5 [&_button]:text-white [&_button:hover]:bg-white/20 [&_button:disabled]:opacity-40">
						{quick}
					</div>
					<div className="flex min-w-0 flex-1 items-center justify-center gap-2 text-[13px]">
						<span className="truncate font-medium">{name}</span>
						{state && <span className="shrink-0 text-white/70">· {state}</span>}
					</div>
					<div className="flex shrink-0 items-center gap-2 [&_button]:text-white [&_button:hover]:bg-white/20">{people}</div>
					<div className="flex shrink-0 items-center gap-1 [&_button]:text-white [&_button:hover]:bg-white/20">{actions}</div>
				</div>
				<div role="tablist" aria-label="Ribbon tabs" className="flex h-8 shrink-0 items-end gap-0.5 border-b bg-background px-1">
					<button
						type="button"
						role="tab"
						aria-selected={tab === "file"}
						onClick={() => onTab("file")}
						className={cn("mb-0.5 h-7 px-4 text-[13px] font-medium text-white outline-none focus-visible:ring-2 focus-visible:ring-ring", tab === "file" ? "brightness-90" : "hover:brightness-110")}
						style={{ background: a.color }}
					>
						File
					</button>
					{tabs.map((t) => (
						<button
							key={t.id}
							type="button"
							role="tab"
							aria-selected={tab === t.id}
							onClick={() => {
								onTab(t.id);
								if (collapsed) setPeek(true);
							}}
							className={cn("h-8 px-3.5 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring", tab === t.id ? "-mb-px border-x border-t bg-[#f3f2f1] font-medium dark:bg-neutral-800" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground")}
							style={tab === t.id ? { color: a.color, boxShadow: `inset 0 2px 0 ${a.color}` } : undefined}
						>
							{t.label}
						</button>
					))}
					<span className="flex-1" />
					<button
						type="button"
						aria-label={collapsed ? "Pin the ribbon" : "Collapse the ribbon"}
						title={collapsed ? "Pin the ribbon" : "Collapse the ribbon"}
						onClick={() => {
							setCollapsed((c) => !c);
							setPeek(false);
						}}
						className="mb-1 flex size-6 items-center justify-center text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
					>
						{collapsed ? <ChevronDown className="size-4" /> : <ChevronUp className="size-4" />}
					</button>
				</div>
				{showBody && (
					<div role="tabpanel" className="relative z-30 flex h-[96px] shrink-0 items-stretch overflow-x-auto border-b bg-[#f3f2f1] px-1 py-1 dark:bg-neutral-800" onMouseDown={(e) => { if (!(e.target as HTMLElement).closest("input,select,textarea")) e.preventDefault(); }} onMouseLeave={() => collapsed && setPeek(false)}>
						{ribbon}
					</div>
				)}
				<div className="relative min-h-0 flex-1">
					{children}
					{tab === "file" && <div className="absolute inset-0 z-40 overflow-auto bg-background">{file}</div>}
				</div>
				<div className="flex h-6 shrink-0 items-center gap-4 px-3 text-xs text-white" style={{ background: a.color }}>
					{status}
				</div>
			</div>
		</AccentContext.Provider>
	);
}

// A set of controls under one label, with a rule after it
export function Group({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
	return (
		<div role="group" aria-label={label} className="flex shrink-0 flex-col border-r border-black/10 px-1.5 last:border-r-0 dark:border-white/10">
			<div className={cn("flex min-h-0 flex-1 items-center gap-1", className)}>{children}</div>
			<div className="pb-0.5 text-center text-[11px] leading-3 text-muted-foreground">{label}</div>
		</div>
	);
}

// Two or three rows of small controls in a column
export function Rows({ children, className }: { children: ReactNode; className?: string }) {
	return <div className={cn("flex flex-col justify-center gap-0.5", className)}>{children}</div>;
}
export function Row({ children, className }: { children: ReactNode; className?: string }) {
	return <div className={cn("flex items-center gap-0.5", className)}>{children}</div>;
}
export const Sep = () => <span aria-hidden className="mx-0.5 h-5 w-px self-center bg-black/15 dark:bg-white/15" />;

interface ButtonProps {
	icon: ElementType;
	label?: string;
	title?: string;
	active?: boolean;
	disabled?: boolean;
	onPress?: () => void;
	// Opens a menu instead of acting (a small arrow is drawn)
	menu?: ReactNode;
	// A coloured bar under the icon (font colour, highlight, fill)
	bar?: string;
}

const hoverCls = "hover:bg-black/8 dark:hover:bg-white/10 disabled:opacity-40 disabled:hover:bg-transparent";

// A large button: the icon above the words
export function Big({ icon: Icon, label, title, active, disabled, onPress, menu }: ButtonProps) {
	const accent = useContext(AccentContext);
	const body = (open: () => void, isOpen: boolean) => (
		<button
			type="button"
			title={title ?? label}
			aria-label={label}
			aria-pressed={active}
			aria-haspopup={menu ? "menu" : undefined}
			aria-expanded={menu ? isOpen : undefined}
			disabled={disabled}
			onClick={() => (menu ? open() : onPress?.())}
			className={cn("flex h-[66px] w-[54px] flex-col items-center justify-start gap-0.5 rounded-sm px-0.5 pt-1.5 text-[11px] leading-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring", hoverCls, (active || isOpen) && "bg-black/10 dark:bg-white/15")}
		>
			<Icon className="size-7" strokeWidth={1.4} style={{ color: ACCENTS[accent].color }} aria-hidden />
			<span className="line-clamp-2 text-center">{label}</span>
			{menu && <ChevronDown className="-mt-0.5 size-3 opacity-60" aria-hidden />}
		</button>
	);
	return menu ? <Popover trigger={body}>{menu}</Popover> : body(() => {}, false);
}

// A small button: an icon, with words beside it when `label` is given
export function Small({ icon: Icon, label, title, active, disabled, onPress, menu, bar }: ButtonProps) {
	const body = (open: () => void, isOpen: boolean) => (
		<button
			type="button"
			title={title ?? label}
			aria-label={title ?? label}
			aria-pressed={active}
			aria-haspopup={menu ? "menu" : undefined}
			aria-expanded={menu ? isOpen : undefined}
			disabled={disabled}
			onClick={() => (menu ? open() : onPress?.())}
			className={cn("flex h-6 items-center gap-1 rounded-sm px-1 text-[12px] outline-none focus-visible:ring-2 focus-visible:ring-ring", !label && "min-w-6 justify-center", hoverCls, (active || isOpen) && "bg-black/10 dark:bg-white/15")}
		>
			<span className="relative flex flex-col items-center">
				<Icon className="size-4" strokeWidth={1.7} aria-hidden />
				{bar !== undefined && <span className="absolute -bottom-1 h-[3px] w-4" style={{ background: bar ? `#${bar}` : "transparent", outline: bar ? undefined : "1px solid currentColor" }} />}
			</span>
			{label && <span>{label}</span>}
			{menu && <ChevronDown className="size-3 opacity-60" aria-hidden />}
		</button>
	);
	return menu ? <Popover trigger={body}>{menu}</Popover> : body(() => {}, false);
}

// A drop-down of choices, as a native list so it works with the keyboard and a screen reader
export function Choice({ label, value, options, onChange, width = 120, disabled }: { label: string; value: string; options: { value: string; label: string; style?: CSSProperties }[]; onChange: (v: string) => void; width?: number; disabled?: boolean }) {
	return (
		<select
			aria-label={label}
			title={label}
			value={value}
			disabled={disabled}
			onChange={(e) => onChange(e.target.value)}
			style={{ width }}
			className="h-6 cursor-pointer rounded-sm border border-black/20 bg-background px-1 text-[12px] outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 dark:border-white/20"
		>
			{!options.some((o) => o.value === value) && <option value={value}>{value}</option>}
			{options.map((o) => (
				<option key={o.value} value={o.value} style={o.style}>
					{o.label}
				</option>
			))}
		</select>
	);
}

// What opens under a button: a panel that closes on a click outside, on Escape, and after a choice (`close` is passed down)
const PopoverContext = createContext<() => void>(() => {});
export const useClosePopover = () => useContext(PopoverContext);

export function Popover({ trigger, children, align = "left" }: { trigger: (open: () => void, isOpen: boolean) => ReactNode; children: ReactNode; align?: "left" | "right" }) {
	const [open, setOpen] = useState(false);
	const root = useRef<HTMLSpanElement>(null);
	const panel = useRef<HTMLDivElement>(null);
	const [at, setAt] = useState({ left: 0, top: 0 });
	// The panel is drawn over everything (the ribbon scrolls and would cut it off), below the button, kept inside the window
	useLayoutEffect(() => {
		if (!open || !root.current) return;
		const r = root.current.getBoundingClientRect();
		const w = panel.current?.offsetWidth ?? 0;
		const left = align === "right" ? r.right - w : r.left;
		setAt({ left: Math.max(4, Math.min(left, window.innerWidth - w - 4)), top: r.bottom + 2 });
	}, [open, align]);
	useEffect(() => {
		if (!open) return;
		const down = (e: MouseEvent) => !root.current?.contains(e.target as Node) && !panel.current?.contains(e.target as Node) && setOpen(false);
		const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
		document.addEventListener("mousedown", down);
		document.addEventListener("keydown", key);
		return () => {
			document.removeEventListener("mousedown", down);
			document.removeEventListener("keydown", key);
		};
	}, [open]);
	return (
		<span ref={root} className="relative inline-flex">
			{trigger(() => setOpen((o) => !o), open)}
			{open &&
				createPortal(
					<PopoverContext.Provider value={() => setOpen(false)}>
						<div ref={panel} role="menu" style={{ position: "fixed", left: at.left, top: at.top }} className="z-[60] min-w-44 border bg-popover p-1 text-popover-foreground shadow-lg">
							{children}
						</div>
					</PopoverContext.Provider>,
					document.body,
				)}
		</span>
	);
}

// One line of a menu
export function MenuItem({ icon: Icon, label, hint, checked, disabled, onPress }: { icon?: ElementType; label: string; hint?: string; checked?: boolean; disabled?: boolean; onPress: () => void }) {
	const close = useClosePopover();
	return (
		<button
			type="button"
			role="menuitem"
			aria-checked={checked}
			disabled={disabled}
			onClick={() => {
				onPress();
				close();
			}}
			className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-[13px] outline-none hover:bg-muted focus-visible:bg-muted disabled:opacity-40"
		>
			<span className="flex size-4 shrink-0 items-center justify-center">{Icon ? <Icon className="size-4" /> : checked ? "✓" : null}</span>
			<span className="flex-1">{label}</span>
			{hint && <span className="text-xs text-muted-foreground">{hint}</span>}
		</button>
	);
}
export const MenuRule = () => <div role="separator" className="my-1 h-px bg-border" />;
export const MenuTitle = ({ children }: { children: ReactNode }) => <div className="px-2 pt-1 pb-0.5 text-[11px] font-medium text-muted-foreground">{children}</div>;

// A colour button: the icon with the colour in a bar under it, and a palette that opens beside it
export function ColorButton({ icon, title, color, colors, none, onPick }: { icon: ElementType; title: string; color: string; colors: readonly string[]; none: string; onPick: (hex: string) => void }) {
	return (
		<span className="inline-flex">
			<Small icon={icon} title={title} bar={color} onPress={() => onPick(color)} />
			<Popover trigger={(open, isOpen) => <button type="button" aria-label={`${title}: more colours`} aria-expanded={isOpen} onClick={open} className="flex h-6 w-3.5 items-center justify-center rounded-sm outline-none hover:bg-black/8 focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-white/10"><ChevronDown className="size-3 opacity-60" /></button>}>
				<Palette colors={colors} none={none} onPick={onPick} />
			</Popover>
		</span>
	);
}

export function Palette({ colors, none, onPick }: { colors: readonly string[]; none: string; onPick: (hex: string) => void }) {
	const close = useClosePopover();
	return (
		<div className="w-[178px]">
			<div className="grid grid-cols-7 gap-1 p-1">
				{colors.map((c) => (
					<button key={c} type="button" role="menuitem" aria-label={`#${c}`} title={`#${c}`} onClick={() => { onPick(c); close(); }} className="size-5 border border-black/20 outline-none hover:scale-110 focus-visible:ring-2 focus-visible:ring-ring" style={{ background: `#${c}` }} />
				))}
			</div>
			<MenuItem label={none} onPress={() => onPick("")} />
			<label className="flex cursor-pointer items-center gap-2 px-2 py-1.5 text-[13px] hover:bg-muted">
				<span className="size-4 border" style={{ background: "conic-gradient(red, yellow, lime, aqua, blue, magenta, red)" }} />
				More Colors…
				<input type="color" aria-label="Pick a colour" className="sr-only" onChange={(e) => onPick(e.target.value.slice(1).toUpperCase())} />
			</label>
		</div>
	);
}

// A strip of looks to choose from, each drawn as it will look
export function Gallery({ label, items, current, onPick, width = 72, className }: { label: string; items: { id: string; label: string; preview: ReactNode }[]; current?: string; onPick: (id: string) => void; width?: number; className?: string }) {
	return (
		<div role="listbox" aria-label={label} className={cn("flex h-[62px] items-stretch gap-1 overflow-x-auto border border-black/15 bg-background p-1 dark:border-white/15", className)}>
			{items.map((i) => (
				<button
					key={i.id}
					type="button"
					role="option"
					aria-selected={current === i.id}
					title={i.label}
					onClick={() => onPick(i.id)}
					style={{ width }}
					className={cn("flex shrink-0 flex-col items-start justify-between overflow-hidden border border-transparent px-1.5 py-1 text-left outline-none hover:border-black/30 focus-visible:ring-2 focus-visible:ring-ring dark:hover:border-white/30", current === i.id && "border-[var(--office)] bg-black/5 dark:bg-white/10")}
				>
					<span className="w-full truncate leading-none">{i.preview}</span>
					<span className="w-full truncate text-[10px] text-muted-foreground">{i.label}</span>
				</button>
			))}
		</div>
	);
}

// The page of an Insert › Table drop-down: move over the squares to choose the size, click to insert
export function GridPicker({ rows = 8, cols = 10, onPick }: { rows?: number; cols?: number; onPick: (rows: number, cols: number) => void }) {
	const close = useClosePopover();
	const [at, setAt] = useState<[number, number]>([0, 0]);
	return (
		<div className="p-1">
			<div className="mb-1 text-[12px] text-muted-foreground">{at[0] ? `${at[0]} × ${at[1]} Table` : "Insert Table"}</div>
			<div className="grid gap-px" style={{ gridTemplateColumns: `repeat(${cols}, 16px)` }} onMouseLeave={() => setAt([0, 0])}>
				{Array.from({ length: rows * cols }, (_, i) => {
					const r = Math.floor(i / cols) + 1;
					const c = (i % cols) + 1;
					return (
						<button
							key={i}
							type="button"
							role="menuitem"
							aria-label={`${r} by ${c}`}
							onMouseEnter={() => setAt([r, c])}
							onFocus={() => setAt([r, c])}
							onClick={() => {
								onPick(r, c);
								close();
							}}
							className={cn("size-4 border outline-none", r <= at[0] && c <= at[1] ? "border-[var(--office)] bg-[var(--office)]/25" : "border-black/25")}
						/>
					);
				})}
			</div>
		</div>
	);
}

// A name for a number at the right of the status bar, and the zoom slider
export function ZoomBar({ value, onChange, min = 50, max = 200 }: { value: number; onChange: (v: number) => void; min?: number; max?: number }) {
	return (
		<span className="ml-auto flex items-center gap-2">
			<button type="button" aria-label="Zoom out" onClick={() => onChange(Math.max(min, value - 10))} className="px-1 text-base leading-none outline-none hover:bg-white/20 focus-visible:ring-1 focus-visible:ring-white">
				−
			</button>
			<input type="range" aria-label="Zoom" min={min} max={max} step={5} value={value} onChange={(e) => onChange(Number(e.target.value))} className="h-1 w-28 accent-white" />
			<button type="button" aria-label="Zoom in" onClick={() => onChange(Math.min(max, value + 10))} className="px-1 text-base leading-none outline-none hover:bg-white/20 focus-visible:ring-1 focus-visible:ring-white">
				+
			</button>
			<button type="button" onClick={() => onChange(100)} className="w-10 text-right outline-none hover:underline focus-visible:ring-1 focus-visible:ring-white" title="Back to 100%">
				{value}%
			</button>
		</span>
	);
}
