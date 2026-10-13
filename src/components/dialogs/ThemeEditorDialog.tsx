// Making or changing a custom theme: a name, a starting point, the eighteen colours (each a picker and a field), and the same
// colours as CSS that can be copied out or pasted in. A sample shows the result as it is edited.

import { useMemo, useState } from "react";
import { Palette } from "@/components/animate-icons";

import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter, DialogHeading } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BUILTIN_THEMES, MAX_THEME_NAME, TOKENS, isColor, textToVars, themeEntries, themeWarnings, varsToText, type ThemeDef, type ThemeMode, type ThemeVars } from "@/lib/themes";
import { cn } from "@/lib/utils";
import { useThemeContext } from "@/store/ThemeContext";

const newId = () => `custom-${Math.random().toString(36).slice(2, 10).padEnd(8, "0")}`;
const isHex6 = (v: string) => /^#[0-9a-f]{6}$/i.test(v);

// What the colours look like together: a page with a sidebar, a panel, text, buttons and the four status colours
function Sample({ mode, vars }: { mode: ThemeMode; vars: ThemeVars }) {
	const style = Object.fromEntries(themeEntries({ mode, vars }).map(([k, v]) => [`--${k}`, v])) as React.CSSProperties;
	return (
		<div style={style} className="flex h-44 overflow-hidden border bg-background text-foreground" aria-label="Sample of the theme" role="img">
			<div className="flex w-24 shrink-0 flex-col gap-1 border-r bg-sidebar p-2 text-[13px]">
				<span className="bg-primary/15 px-1.5 py-0.5 text-primary">Notes</span>
				<span className="px-1.5 py-0.5 text-muted-foreground">Files</span>
				<span className="px-1.5 py-0.5 text-muted-foreground">Tasks</span>
			</div>
			<div className="flex min-w-0 flex-1 flex-col gap-2 p-2">
				<div className="border bg-card p-2">
					<p className="text-sm font-semibold">A panel</p>
					<p className="text-[13px] text-muted-foreground">Hints and secondary text</p>
					<div className="mt-2 flex gap-1.5">
						<span className="border bg-primary px-2 py-0.5 text-[13px] text-primary-foreground">Save</span>
						<span className="border bg-secondary px-2 py-0.5 text-[13px]">Cancel</span>
						<span className="border border-input bg-background px-2 py-0.5 font-mono text-[13px] text-muted-foreground">field</span>
					</div>
				</div>
				<div className="flex flex-wrap gap-x-3 text-[13px]">
					<span className="text-success">Done</span>
					<span className="text-warning">Due soon</span>
					<span className="text-info">Note</span>
					<span className="text-destructive">Error</span>
				</div>
			</div>
		</div>
	);
}

export default function ThemeEditorDialog({ mode, initial, onClose }: { mode: ThemeMode; initial?: ThemeDef; onClose: () => void }) {
	const { saveCustomTheme, setLightTheme, setDarkTheme } = useThemeContext();
	const starts = BUILTIN_THEMES.filter((t) => t.mode === mode);
	const [name, setName] = useState(initial?.name ?? "");
	const [vars, setVars] = useState<ThemeVars>(initial?.vars ?? starts[0].vars);
	const [text, setText] = useState(() => varsToText(initial?.vars ?? starts[0].vars));
	const [skipped, setSkipped] = useState(0);

	const apply = (next: ThemeVars) => {
		setVars(next);
		setText(varsToText(next));
		setSkipped(0);
	};
	const setColor = (key: keyof ThemeVars, value: string) => apply({ ...vars, [key]: value });
	// A colour being typed is kept as it is until it is a real colour, so half a hex code never breaks the sample
	const [typing, setTyping] = useState<Record<string, string>>({});

	const bad = useMemo(() => TOKENS.filter((t) => !isColor(vars[t.key])).length, [vars]);
	const canSave = name.trim().length > 0 && bad === 0;

	const save = () => {
		const def: ThemeDef = { id: initial?.id ?? newId(), name: name.trim().slice(0, MAX_THEME_NAME), mode, vars, custom: true };
		saveCustomTheme(def);
		// A theme just made is the one to look at
		if (!initial) (mode === "dark" ? setDarkTheme : setLightTheme)(def.id);
		onClose();
	};

	return (
		<Dialog isOpen onOpenChange={(o) => !o && onClose()} className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
			<div className="space-y-4">
				<DialogHeading icon={<Palette className="size-6" />} title={initial ? "Edit theme" : "New theme"} />

				<div className="grid gap-3 sm:grid-cols-2">
					<div>
						<Label htmlFor="theme-name">Name</Label>
						<Input id="theme-name" value={name} maxLength={MAX_THEME_NAME} onChange={(e) => setName(e.target.value)} placeholder="My theme" className="mt-1" autoFocus />
					</div>
					<div>
						<Label htmlFor="theme-start">Start from</Label>
						<select id="theme-start" defaultValue="" onChange={(e) => e.target.value && apply(starts.find((s) => s.id === e.target.value)!.vars)} className="mt-1 h-10 w-full border border-input bg-background px-2 text-sm">
							<option value="">{initial ? "Keep these colours" : starts[0].name}</option>
							{starts.map((s) => (
								<option key={s.id} value={s.id}>
									{s.name}
								</option>
							))}
						</select>
					</div>
				</div>

				<Sample mode={mode} vars={vars} />
				{themeWarnings(vars).length > 0 && (
					<ul role="status" className="space-y-0.5 bg-warning/10 p-2 text-sm text-warning">
						{themeWarnings(vars).map((w) => (
							<li key={w}>{w}</li>
						))}
					</ul>
				)}

				<div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
					{TOKENS.map((t) => {
						const value = typing[t.key] ?? vars[t.key];
						const ok = isColor(value);
						return (
							<div key={t.key} className="flex items-center gap-2">
								{isHex6(vars[t.key]) ? (
									<input type="color" aria-label={`${t.label} colour`} value={vars[t.key].toLowerCase()} onChange={(e) => setColor(t.key, e.target.value)} className="h-8 w-9 shrink-0 cursor-pointer border bg-transparent p-0.5" />
								) : (
									<span aria-hidden className="h-8 w-9 shrink-0 border" style={{ background: ok ? value : "transparent" }} />
								)}
								<div className="min-w-0 flex-1">
									<p className="truncate text-sm font-semibold" title={t.hint}>
										{t.label}
									</p>
									<p className="truncate text-[13px] text-muted-foreground">{t.hint}</p>
								</div>
								<input
									aria-label={`${t.label} value`}
									value={value}
									spellCheck={false}
									onChange={(e) => {
										const v = e.target.value.trim();
										setTyping((p) => ({ ...p, [t.key]: e.target.value }));
										if (isColor(v)) {
											setVars((prev) => ({ ...prev, [t.key]: v }));
											setText(varsToText({ ...vars, [t.key]: v }));
										}
									}}
									onBlur={() => setTyping((p) => Object.fromEntries(Object.entries(p).filter(([k]) => k !== t.key)))}
									className={cn("h-8 w-28 border bg-background px-2 font-mono text-[13px] outline-none focus-visible:border-ring", !ok && "border-destructive")}
								/>
							</div>
						);
					})}
				</div>

				<div>
					<Label htmlFor="theme-css">As CSS</Label>
					<textarea
						id="theme-css"
						value={text}
						spellCheck={false}
						onChange={(e) => {
							setText(e.target.value);
							const r = textToVars(e.target.value, vars);
							setVars(r.vars);
							setSkipped(r.skipped);
						}}
						rows={8}
						className="mt-1 w-full resize-y border border-input bg-background p-2 font-mono text-[13px] outline-none focus-visible:border-ring"
					/>
					<p className={cn("mt-1 text-[13px]", skipped ? "text-warning" : "text-muted-foreground")}>
						{skipped ? `${skipped} ${skipped === 1 ? "line was" : "lines were"} not used: names must be ones listed above and values hex, rgb(), hsl() or oklch() colours.` : "One --name: value; per line. Paste a whole theme here to import it."}
					</p>
				</div>

				<DialogFooter>
					<Button variant="outline" onPress={onClose}>
						Cancel
					</Button>
					<Button isDisabled={!canSave} onPress={save}>
						Save Theme
					</Button>
				</DialogFooter>
			</div>
		</Dialog>
	);
}
