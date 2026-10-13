// Building blocks shared by the app settings and the workspace settings, so both pages look and behave the same

import type { ReactNode } from "react";

import { X } from "@/components/animate-icons";
import { Panel } from "@/components/layout/Page";
import Toolbar, { ToolbarTitle } from "@/components/layout/Toolbar";
import { Button } from "@/components/ui/button";
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
	options: { value: T; label: string; icon?: ReactNode; count?: number }[];
	onChange: (value: T) => void;
}) {
	return (
		<div role="group" aria-label={label} className="inline-flex border">
			{options.map((option) => (
				<button
					key={option.value}
					type="button"
					aria-pressed={option.value === value}
					onClick={() => onChange(option.value)}
					className={cn(
						"flex cursor-pointer items-center gap-2 px-3 py-2 text-sm font-medium transition-colors",
						option.value === value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
					)}
				>
					{option.icon}
					{option.label}
					{option.count !== undefined && <span className="font-mono text-xs tabular-nums opacity-70">{option.count}</span>}
				</button>
			))}
		</div>
	);
}

// A titled panel with an icon
export function SectionCard({ id, title, icon, children, className, titleClassName }: { id: string; title: string; icon: ReactNode; children: ReactNode; className?: string; titleClassName?: string }) {
	return (
		<Panel id={id} title={title} icon={icon} titleClassName={titleClassName} className={cn("scroll-mt-3", className)}>
			<div className="space-y-4">{children}</div>
		</Panel>
	);
}

// The frame both Settings screens share, in the popup and as a page: a header that never scrolls away, with the title and
// a Close button, then the sections, and a bar along the bottom while there is something to save
export function SettingsShell({ title, onClose, footer, className, children }: { title: string; onClose: () => void; footer?: ReactNode; className?: string; children: ReactNode }) {
	return (
		<div className={cn("flex min-h-0 flex-col bg-background", className)}>
			<Toolbar>
				<ToolbarTitle name={title} />
				<span className="flex-1" />
				<Button variant="outline" size="sm" onPress={onClose} aria-label="Close settings">
					<X className="size-4" />
					Close
				</Button>
			</Toolbar>
			<div className="flex min-h-0 flex-1">
				<div data-settings-scroll className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain p-2">
					<div className="space-y-3">{children}</div>
				</div>
			</div>
			{footer && <div className="shrink-0 border-t bg-card/40">{footer}</div>}
		</div>
	);
}
