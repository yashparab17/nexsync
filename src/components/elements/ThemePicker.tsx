// Choosing the look of each mode from the built-in themes and the ones made here, and making new ones.

import { useState } from "react";
import { Check, Pencil, Plus, Trash2 } from "@/components/animate-icons";

import ThemeEditorDialog from "@/components/dialogs/ThemeEditorDialog";
import { Button } from "@/components/ui/button";
import type { ThemeDef, ThemeMode } from "@/lib/themes";
import { cn } from "@/lib/utils";
import { useThemeContext } from "@/store/ThemeContext";

function Group({ mode, label }: { mode: ThemeMode; label: string }) {
	const { themesFor, lightTheme, darkTheme, setLightTheme, setDarkTheme, deleteCustomTheme, isDark } = useThemeContext();
	const [editing, setEditing] = useState<{ theme?: ThemeDef } | null>(null);
	const value = mode === "dark" ? darkTheme : lightTheme;
	const choose = mode === "dark" ? setDarkTheme : setLightTheme;
	const active = isDark === (mode === "dark");

	return (
		<div role="radiogroup" aria-label={label} className="space-y-2">
			<div className="flex items-center justify-between gap-2">
				<p className="text-sm font-semibold">
					{label}
					{active && <span className="ml-2 font-mono text-[13px] font-normal text-muted-foreground">in use</span>}
				</p>
				<Button variant="outline" size="sm" onPress={() => setEditing({})}>
					<Plus className="size-4" />
					New theme
				</Button>
			</div>
			<div className="grid gap-2 sm:grid-cols-2">
				{themesFor(mode).map((t) => (
					<div key={t.id} className="relative">
						<button
							type="button"
							role="radio"
							aria-checked={value === t.id}
							onClick={() => choose(t.id)}
							className={cn("flex w-full items-center gap-3 border p-2 text-left text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring", t.custom && "pr-16", value === t.id ? "border-primary bg-primary/10" : "hover:bg-muted")}
						>
							<span className="flex h-8 w-14 shrink-0 border" aria-hidden>
								{[t.vars.background, t.vars.card, t.vars.primary, t.vars.foreground].map((c, i) => (
									<span key={i} className="flex-1" style={{ background: c }} />
								))}
							</span>
							<span className="min-w-0 flex-1 truncate">{t.name}</span>
							{value === t.id && !t.custom && <Check className="size-4 shrink-0 text-primary" />}
						</button>
						{t.custom && (
							<span className="absolute top-1/2 right-1 flex -translate-y-1/2 items-center">
								{value === t.id && <Check className="mr-1 size-4 text-primary" />}
								<Button variant="ghost" size="icon-xs" aria-label={`Edit ${t.name}`} onPress={() => setEditing({ theme: t })}>
									<Pencil className="size-3.5" />
								</Button>
								<Button variant="ghost" size="icon-xs" aria-label={`Delete ${t.name}`} onPress={() => deleteCustomTheme(t.id)}>
									<Trash2 className="size-3.5 text-destructive" />
								</Button>
							</span>
						)}
					</div>
				))}
			</div>
			{editing && <ThemeEditorDialog mode={mode} initial={editing.theme} onClose={() => setEditing(null)} />}
		</div>
	);
}

export default function ThemePicker() {
	return (
		<div className="space-y-5">
			<Group mode="dark" label="Dark theme" />
			<Group mode="light" label="Light theme" />
		</div>
	);
}
