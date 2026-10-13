// Choosing the look: built-in themes come as pairs (a light and a dark one, applied together), and the ones made here are per mode.

import { useState } from "react";
import { Check, Pencil, Plus, Trash2 } from "@/components/animate-icons";

import ThemeEditorDialog from "@/components/dialogs/ThemeEditorDialog";
import { Button } from "@/components/ui/button";
import { BUILTIN_THEMES, THEME_FAMILIES, type ThemeDef, type ThemeMode } from "@/lib/themes";
import { cn } from "@/lib/utils";
import { useThemeContext } from "@/store/ThemeContext";

const find = (id: string, mode: ThemeMode) => BUILTIN_THEMES.find((t) => t.id === id && t.mode === mode)!;

// The four colours of a theme side by side
const Swatch = ({ t }: { t: ThemeDef }) => (
	<span className="flex h-8 w-12 shrink-0 frame" aria-hidden>
		{[t.vars.background, t.vars.card, t.vars.primary, t.vars.foreground].map((c, i) => (
			<span key={i} className="flex-1" style={{ background: c }} />
		))}
	</span>
);

function Families() {
	const { lightTheme, darkTheme, setLightTheme, setDarkTheme } = useThemeContext();
	return (
		<div role="radiogroup" aria-label="Theme" className="grid gap-2 sm:grid-cols-2">
			{THEME_FAMILIES.map((f) => {
				const on = lightTheme === f.light && darkTheme === f.dark;
				return (
					<button
						key={f.id}
						type="button"
						role="radio"
						aria-checked={on}
						onClick={() => {
							setLightTheme(f.light);
							setDarkTheme(f.dark);
						}}
						className={cn("frame flex w-full items-center gap-3 p-2 text-left text-sm transition-colors", on ? "bg-primary/10" : "hover:bg-muted")}
					>
						<span className="flex gap-1">
							<Swatch t={find(f.light, "light")} />
							<Swatch t={find(f.dark, "dark")} />
						</span>
						<span className="min-w-0 flex-1 truncate">{f.name}</span>
						{on && <Check className="size-4 shrink-0 text-primary" />}
					</button>
				);
			})}
		</div>
	);
}

// The themes made here for one mode, with a button to make another
function Custom({ mode, label }: { mode: ThemeMode; label: string }) {
	const { themesFor, lightTheme, darkTheme, setLightTheme, setDarkTheme, deleteCustomTheme } = useThemeContext();
	const [editing, setEditing] = useState<{ theme?: ThemeDef } | null>(null);
	const value = mode === "dark" ? darkTheme : lightTheme;
	const choose = mode === "dark" ? setDarkTheme : setLightTheme;
	const mine = themesFor(mode).filter((t) => t.custom);
	return (
		<div role="radiogroup" aria-label={label} className="space-y-2">
			<div className="flex items-center justify-between gap-2">
				<p className="text-sm font-semibold">{label}</p>
				<Button variant="outline" size="sm" onPress={() => setEditing({})}>
					<Plus className="size-4" />
					New Theme
				</Button>
			</div>
			{mine.length > 0 && (
				<div className="grid gap-2 sm:grid-cols-2">
					{mine.map((t) => (
						<div key={t.id} className="relative">
							<button type="button" role="radio" aria-checked={value === t.id} onClick={() => choose(t.id)} className={cn("frame flex w-full items-center gap-3 p-2 pr-16 text-left text-sm transition-colors", value === t.id ? "bg-primary/10" : "hover:bg-muted")}>
								<Swatch t={t} />
								<span className="min-w-0 flex-1 truncate">{t.name}</span>
							</button>
							<span className="absolute top-1/2 right-1 flex -translate-y-1/2 items-center">
								{value === t.id && <Check className="mr-1 size-4 text-primary" />}
								<Button variant="ghost" size="icon-xs" aria-label={`Edit ${t.name}`} onPress={() => setEditing({ theme: t })}>
									<Pencil className="size-3.5" />
								</Button>
								<Button variant="ghost" size="icon-xs" aria-label={`Delete ${t.name}`} onPress={() => deleteCustomTheme(t.id)}>
									<Trash2 className="size-3.5 text-destructive" />
								</Button>
							</span>
						</div>
					))}
				</div>
			)}
			{editing && <ThemeEditorDialog mode={mode} initial={editing.theme} onClose={() => setEditing(null)} />}
		</div>
	);
}

export default function ThemePicker() {
	return (
		<div className="space-y-5">
			<Families />
			<Custom mode="light" label="Your Light Themes" />
			<Custom mode="dark" label="Your Dark Themes" />
		</div>
	);
}
