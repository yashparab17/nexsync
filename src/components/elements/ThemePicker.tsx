// Choosing the look of each mode: the original, or a Catppuccin flavour. Each option shows its page, panel and accent colours.

import { Check } from "@/components/animate-icons";
import { THEMES, useThemeContext, type DarkThemeId, type LightThemeId } from "@/store/ThemeContext";
import { cn } from "@/lib/utils";

function Group<T extends string>({ label, value, options, onChange, active }: { label: string; value: T; options: readonly { id: T; name: string; swatch: readonly string[] }[]; onChange: (id: T) => void; active: boolean }) {
	return (
		<div role="radiogroup" aria-label={label} className="space-y-2">
			<p className="text-sm font-semibold">
				{label}
				{active && <span className="ml-2 font-mono text-[13px] font-normal text-muted-foreground">in use</span>}
			</p>
			<div className="grid gap-2 sm:grid-cols-2">
				{options.map((o) => (
					<button
						key={o.id}
						type="button"
						role="radio"
						aria-checked={value === o.id}
						onClick={() => onChange(o.id)}
						className={cn("flex items-center gap-3 border p-2 text-left text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring", value === o.id ? "border-primary bg-primary/10" : "hover:bg-muted")}
					>
						<span className="flex h-8 w-14 shrink-0 border" aria-hidden>
							{o.swatch.map((c) => (
								<span key={c} className="flex-1" style={{ background: c }} />
							))}
						</span>
						<span className="min-w-0 flex-1 truncate">{o.name}</span>
						{value === o.id && <Check className="size-4 shrink-0 text-primary" />}
					</button>
				))}
			</div>
		</div>
	);
}

export default function ThemePicker() {
	const { lightTheme, darkTheme, setLightTheme, setDarkTheme, isDark } = useThemeContext();
	return (
		<div className="space-y-4">
			<Group<DarkThemeId> label="Dark theme" value={darkTheme} options={THEMES.dark} onChange={setDarkTheme} active={isDark} />
			<Group<LightThemeId> label="Light theme" value={lightTheme} options={THEMES.light} onChange={setLightTheme} active={!isDark} />
		</div>
	);
}
