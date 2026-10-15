// Small charts drawn with plain markup, coloured from the theme tokens so they follow light and dark. Colours are written
// out as whole class names so Tailwind finds them.

import { useState, type ReactNode } from "react";

import { ChevronLeft, ChevronRight } from "@/components/animate-icons";
import { cn } from "@/lib/utils";

// A set of colours that stay apart on both themes, in the order series are given them
export const SERIES = [
	{ bg: "bg-primary", stroke: "stroke-primary" },
	{ bg: "bg-info", stroke: "stroke-info" },
	{ bg: "bg-success", stroke: "stroke-success" },
	{ bg: "bg-warning", stroke: "stroke-warning" },
	{ bg: "bg-destructive", stroke: "stroke-destructive" },
	{ bg: "bg-chart-3", stroke: "stroke-chart-3" },
	{ bg: "bg-muted-foreground", stroke: "stroke-muted-foreground" },
] as const;

export const Empty = ({ children }: { children: ReactNode }) => <p className="py-6 text-center text-sm text-muted-foreground">{children}</p>;

// A ring split into parts, with a number in the middle
export function Donut({ parts, label, center }: { parts: { label: string; value: number }[]; label: string; center?: ReactNode }) {
	const total = parts.reduce((n, p) => n + p.value, 0);
	let offset = 0;
	return (
		<div className="flex flex-wrap items-center gap-6">
			<div className="relative size-36 shrink-0" role="img" aria-label={label}>
				<svg viewBox="0 0 42 42" className="size-full -rotate-90">
					<circle cx="21" cy="21" r="16" fill="none" strokeWidth="6" pathLength={100} className="stroke-muted" />
					{total > 0 &&
						parts.map((p, i) => {
							const share = (p.value / total) * 100;
							const el = <circle key={p.label} cx="21" cy="21" r="16" fill="none" strokeWidth="6" pathLength={100} strokeDasharray={`${share} ${100 - share}`} strokeDashoffset={-offset} className={SERIES[i % SERIES.length].stroke} />;
							offset += share;
							return el;
						})}
				</svg>
				<div className="absolute inset-0 flex flex-col items-center justify-center text-center">{center}</div>
			</div>
			<ul className="min-w-40 flex-1 space-y-2 text-sm">
				{parts.map((p, i) => (
					<li key={p.label} className="flex items-center gap-2">
						<span className={cn("size-3 shrink-0", SERIES[i % SERIES.length].bg)} aria-hidden />
						<span className="min-w-0 flex-1 truncate">{p.label}</span>
						<span className="font-mono tabular-nums text-muted-foreground">{p.value}</span>
						<span className="w-10 text-right font-mono tabular-nums text-muted-foreground">{total ? Math.round((p.value / total) * 100) : 0}%</span>
					</li>
				))}
			</ul>
		</div>
	);
}

// One bar cut into labelled parts, for a whole that has a few kinds (to do, doing, done)
export function StackBar({ parts, label }: { parts: { label: string; value: number; bg: string }[]; label: string }) {
	const total = parts.reduce((n, p) => n + p.value, 0);
	return (
		<div>
			<div className="flex h-5 w-full overflow-hidden bg-muted" role="img" aria-label={label}>
				{total > 0 &&
					parts.map((p) => p.value > 0 && <span key={p.label} title={`${p.label}: ${p.value}`} className={cn("h-full transition-[width] duration-500", p.bg)} style={{ width: `${(p.value / total) * 100}%` }} />)}
			</div>
			<ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
				{parts.map((p) => (
					<li key={p.label} className="flex items-center gap-2">
						<span className={cn("size-3", p.bg)} aria-hidden />
						<span className="text-muted-foreground">{p.label}</span>
						<span className="font-mono tabular-nums">{p.value}</span>
					</li>
				))}
			</ul>
		</div>
	);
}

// Rows with a name (and avatar or icon) on the left and a bar scaled to the biggest; a row can be split into parts
export function BarRows({ rows, empty, lead }: { rows: { label: string; parts: { value: number; bg: string; title: string }[] }[]; empty: string; lead?: (label: string) => ReactNode }) {
	const sums = rows.map((r) => r.parts.reduce((n, p) => n + p.value, 0));
	const max = Math.max(1, ...sums);
	if (rows.length === 0) return <Empty>{empty}</Empty>;
	return (
		<ul className="space-y-3">
			{rows.map((r, i) => (
				<li key={r.label} className="flex items-center gap-3 text-sm">
					{lead?.(r.label)}
					<span className="w-28 shrink-0 truncate" title={r.label}>
						{r.label}
					</span>
					<span className="flex h-4 min-w-0 flex-1 bg-muted">
						{r.parts.map((p) => p.value > 0 && <span key={p.title} title={`${p.title}: ${p.value}`} className={cn("h-full transition-[width] duration-500", p.bg)} style={{ width: `${(p.value / max) * 100}%` }} />)}
					</span>
					<span className="w-8 text-right font-mono tabular-nums text-muted-foreground">{sums[i]}</span>
				</li>
			))}
		</ul>
	);
}

// Columns for a run of days, with a few gridlines so the height means something
export function DayColumns({ days, label, tall }: { days: { day: string; count: number }[]; label: string; tall?: boolean }) {
	const peak = Math.max(1, ...days.map((d) => d.count));
	const top = peak <= 4 ? peak : Math.ceil(peak / 4) * 4;
	const h = tall ? "h-80" : "h-40";
	const ticks = peak <= 4 ? [top, 0] : [top, (top * 3) / 4, top / 2, top / 4, 0];
	return (
		<div role="img" aria-label={label} className="flex gap-2">
			<div className={cn("flex flex-col justify-between text-right font-mono text-[13px] leading-none text-muted-foreground", h)}>
				{ticks.map((t) => (
					<span key={t}>{t}</span>
				))}
			</div>
			<div className="min-w-0 flex-1">
				<div className={cn("relative flex items-end gap-1 border-b", h)}>
					<div className="pointer-events-none absolute inset-0 flex flex-col justify-between" aria-hidden>
						{ticks.slice(0, -1).map((t) => (
							<span key={t} className="border-t border-dashed border-border/60" />
						))}
					</div>
					{days.map((d, i) => (
						<div key={d.day} className="relative flex h-full min-w-0 flex-1 flex-col justify-end" title={`${d.day}: ${d.count}`}>
							<div className={cn("w-full transition-[height] duration-500", i === days.length - 1 ? "bg-primary" : "bg-primary/55")} style={{ height: `${(d.count / top) * 100}%`, minHeight: d.count ? 3 : 0 }} />
						</div>
					))}
				</div>
				<div className="mt-1 flex gap-1 font-mono text-[13px] text-muted-foreground">
					{days.map((d, i) => (
						<span key={d.day} className="min-w-0 flex-1 text-center">
							{i === 0 || i === days.length - 1 || i % 3 === 0 ? d.day.slice(8) : ""}
						</span>
					))}
				</div>
			</div>
		</div>
	);
}

const LEVELS = ["bg-muted", "bg-primary/25", "bg-primary/50", "bg-primary/75", "bg-primary"];

// A calendar of squares, a column per week, darker for busier days
export function Heatmap({ days, label }: { days: { day: string; count: number }[]; label: string }) {
	const peak = Math.max(1, ...days.map((d) => d.count));
	// Start on the weekday the first day falls on, so every row is the same weekday
	const lead = days.length ? new Date(`${days[0].day}T00:00:00`).getDay() : 0;
	const cells: ({ day: string; count: number } | null)[] = [...Array(lead).fill(null), ...days];
	return (
		<div>
			<div role="img" aria-label={label} className="grid grid-flow-col grid-rows-7 gap-1 overflow-x-auto pb-1" style={{ gridAutoColumns: "1.125rem", gridTemplateRows: "repeat(7, 1.125rem)" }}>
				{cells.map((d, i) => (
					<span
						key={d?.day ?? `pad${i}`}
						title={d ? `${d.day}: ${d.count}` : undefined}
						className={cn("size-[1.125rem]", d ? LEVELS[d.count === 0 ? 0 : Math.max(1, Math.ceil((d.count / peak) * 4))] : "")}
					/>
				))}
			</div>
			<div className="mt-2 flex items-center justify-end gap-2 font-mono text-[13px] text-muted-foreground">
				less
				{LEVELS.map((l) => (
					<span key={l} className={cn("size-3.5", l)} aria-hidden />
				))}
				more
			</div>
		</div>
	);
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const pad2 = (n: number) => String(n).padStart(2, "0");

// One month at a time, a square per day with its number and shade, paged with the arrows
export function MonthCalendar({ days, label }: { days: { day: string; count: number }[]; label: string }) {
	const counts = new Map(days.map((d) => [d.day, d.count]));
	const first = days.length ? new Date(`${days[0].day}T00:00:00`) : new Date();
	const today = new Date();
	const [shown, setShown] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
	const y = shown.getFullYear();
	const m = shown.getMonth();
	const length = new Date(y, m + 1, 0).getDate();
	const cells = [...Array(shown.getDay()).fill(null), ...Array.from({ length }, (_, i) => `${y}-${pad2(m + 1)}-${pad2(i + 1)}`)];
	const total = cells.reduce((n, d) => n + (d ? (counts.get(d) ?? 0) : 0), 0);
	const peak = Math.max(1, ...cells.map((d) => (d ? (counts.get(d) ?? 0) : 0)));
	const page = (by: number) => setShown(new Date(y, m + by, 1));
	const todayKey = `${today.getFullYear()}-${pad2(today.getMonth() + 1)}-${pad2(today.getDate())}`;
	const step = "flex size-8 cursor-pointer items-center justify-center text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:bg-muted disabled:pointer-events-none disabled:opacity-40";
	return (
		<div className="mx-auto max-w-md">
			<div className="mb-2 flex items-center gap-1">
				<button type="button" aria-label="Previous month" className={step} onClick={() => page(-1)} disabled={new Date(y, m, 1) <= new Date(first.getFullYear(), first.getMonth(), 1)}>
					<ChevronLeft className="size-4" />
				</button>
				<p className="flex-1 text-center text-sm font-medium">
					{shown.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
					<span className="ml-2 font-mono text-[13px] font-normal text-muted-foreground">{total}</span>
				</p>
				<button type="button" aria-label="Next month" className={step} onClick={() => page(1)} disabled={new Date(y, m + 1, 1) > today}>
					<ChevronRight className="size-4" />
				</button>
			</div>
			<div role="img" aria-label={label} className="grid grid-cols-7 gap-1">
				{WEEKDAYS.map((w) => (
					<span key={w} className="pb-1 text-center font-mono text-[13px] text-muted-foreground">{w}</span>
				))}
				{cells.map((d, i) => {
					const n = d ? (counts.get(d) ?? 0) : 0;
					return d ? (
						<span key={d} title={`${d}: ${n}`} className={cn("flex aspect-square items-start justify-between p-1 font-mono text-[13px] tabular-nums", LEVELS[n === 0 ? 0 : Math.max(1, Math.ceil((n / peak) * 4))], n > peak / 2 && n > 0 ? "text-primary-foreground" : "text-muted-foreground", d === todayKey && "outline outline-2 -outline-offset-2 outline-primary")}>
							{i - shown.getDay() + 1}
						</span>
					) : (
						<span key={`pad${i}`} />
					);
				})}
			</div>
		</div>
	);
}

// A big number with a label and an optional tiny trend line
export function Stat({ label, value, trend }: { label: string; value: number; trend?: number[] }) {
	const max = Math.max(1, ...(trend ?? []));
	return (
		<div className="frame flex items-end justify-between gap-3 bg-muted/40 p-4">
			<div>
				<p className="text-4xl font-semibold tabular-nums">{value}</p>
				<p className="font-mono text-[13px] text-muted-foreground">{label}</p>
			</div>
			{trend && (
				<svg viewBox={`0 0 ${trend.length * 6} 24`} className="h-8 w-20 shrink-0 text-primary" aria-hidden preserveAspectRatio="none">
					{trend.map((n, i) => (
						<rect key={i} x={i * 6 + 1} y={24 - (n / max) * 22 - (n ? 1 : 0)} width="4" height={(n / max) * 22 + (n ? 1 : 0)} fill="currentColor" opacity={i === trend.length - 1 ? 1 : 0.5} />
					))}
				</svg>
			)}
		</div>
	);
}
