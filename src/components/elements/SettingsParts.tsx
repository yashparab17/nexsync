// Building blocks shared by the app settings and the workspace settings, so both pages look and behave the same

import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

// A row inside a card: what the setting is on the left, its control on the right
export function Row({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
	return (
		<div className="flex flex-wrap items-center justify-between gap-3">
			<div className="min-w-0">
				<p className="text-sm font-semibold">{title}</p>
				{hint && <p className="text-xs text-muted-foreground">{hint}</p>}
			</div>
			<div className="flex shrink-0 items-center gap-2">{children}</div>
		</div>
	);
}

// A few buttons of which exactly one is chosen
export function Segmented<T extends string | number>({
	label,
	value,
	options,
	onChange,
}: {
	label: string;
	value: T;
	options: { value: T; label: string; icon?: ReactNode }[];
	onChange: (value: T) => void;
}) {
	return (
		<div role="group" aria-label={label} className="inline-flex border">
			{options.map((option) => (
				<Button
					key={option.value}
					size="xs"
					variant={option.value === value ? "secondary" : "ghost"}
					aria-pressed={option.value === value}
					onPress={() => onChange(option.value)}
				>
					{option.icon}
					{option.label}
				</Button>
			))}
		</div>
	);
}

// A titled card with an icon; `id` is what the section list on the left scrolls to
export function SectionCard({
	id,
	title,
	description,
	icon,
	children,
	className,
	titleClassName,
}: {
	id: string;
	title: string;
	description: string;
	icon: ReactNode;
	children: ReactNode;
	className?: string;
	titleClassName?: string;
}) {
	return (
		<Card id={id} className={cn("scroll-mt-8", className)}>
			<CardHeader>
				<CardTitle className={cn("flex items-center gap-2 text-base", titleClassName)}>
					{icon}
					{title}
				</CardTitle>
				<CardDescription>{description}</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">{children}</CardContent>
		</Card>
	);
}

// The list of sections down the left side; each button scrolls its card into view
export function SectionNav({ label, sections }: { label: string; sections: { id: string; label: string; icon: ReactNode }[] }) {
	return (
		<nav aria-label={label} className="sticky top-8 space-y-1">
			{sections.map(({ id, label: text, icon }) => (
				<button
					key={id}
					type="button"
					onClick={() => document.getElementById(id)?.scrollIntoView?.({ behavior: "smooth", block: "start" })}
					className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
				>
					{icon}
					{text}
				</button>
			))}
		</nav>
	);
}
