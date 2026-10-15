// Making or changing a set of code colours: a name, a starting point, ten colours (each a picker and a field), the same as CSS,
// and a sample of code that shows the result as it is edited.

import { useState } from "react";
import { Palette } from "@/components/animate-icons";

import CodeSample from "@/components/elements/CodeSample";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter, DialogHeading } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { SectionTitle } from "@/components/layout/Page";
import { Label } from "@/components/ui/label";
import { BUILTIN_SCHEMES, MAX_SCHEME_NAME, SYNTAX_TOKENS, syntaxToText, textToSyntax, type CodeSchemeDef, type SyntaxVars } from "@/lib/codeSchemes";
import { isColor, type ThemeMode } from "@/lib/themes";
import { cn } from "@/lib/utils";
import { useThemeContext } from "@/store/ThemeContext";

const newId = () => `code-${Math.random().toString(36).slice(2, 10).padEnd(8, "0")}`;
const isHex6 = (v: string) => /^#[0-9a-f]{6}$/i.test(v);

export default function CodeSchemeEditorDialog({ mode, initial, onClose }: { mode: ThemeMode; initial?: CodeSchemeDef; onClose: () => void }) {
	const { saveCustomScheme, setCodeScheme } = useThemeContext();
	const starts = BUILTIN_SCHEMES.filter((s) => s.mode === mode);
	const [name, setName] = useState(initial?.name ?? "");
	const [vars, setVars] = useState<SyntaxVars>(initial?.vars ?? starts[0].vars);
	const [text, setText] = useState(() => syntaxToText(initial?.vars ?? starts[0].vars));
	const [skipped, setSkipped] = useState(0);
	const [typing, setTyping] = useState<Record<string, string>>({});

	const apply = (next: SyntaxVars) => {
		setVars(next);
		setText(syntaxToText(next));
		setSkipped(0);
	};
	const canSave = name.trim().length > 0 && SYNTAX_TOKENS.every((t) => isColor(vars[t.key]));

	const save = () => {
		const def: CodeSchemeDef = { id: initial?.id ?? newId(), name: name.trim().slice(0, MAX_SCHEME_NAME), mode, vars, custom: true };
		saveCustomScheme(def);
		if (!initial) setCodeScheme(mode, def.id);
		onClose();
	};

	return (
		<Dialog isOpen onOpenChange={(o) => !o && onClose()} className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
			<div className="space-y-6">
				<DialogHeading icon={<Palette className="size-6" />} title={initial ? "Edit Code Colours" : "New Code Colours"} />

				<section className="space-y-2">
					<SectionTitle title="Name" />
					<div className="grid gap-4 sm:grid-cols-2">
						<div>
							<Label htmlFor="scheme-name">Name</Label>
							<Input id="scheme-name" value={name} maxLength={MAX_SCHEME_NAME} onChange={(e) => setName(e.target.value)} placeholder="My colours" className="mt-1" autoFocus />
						</div>
						<div>
							<Label htmlFor="scheme-start">Start from</Label>
							<select id="scheme-start" defaultValue="" onChange={(e) => e.target.value && apply(starts.find((s) => s.id === e.target.value)!.vars)} className="mt-1 h-10 w-full border border-input bg-input px-2 text-sm">
								<option value="">{initial ? "Keep these colours" : starts[0].name}</option>
								{starts.map((s) => (
									<option key={s.id} value={s.id}>
										{s.name}
									</option>
								))}
							</select>
						</div>
					</div>
				</section>

				<section className="space-y-2">
					<SectionTitle title="Preview" />
					<CodeSample vars={vars} />
				</section>

				<section className="space-y-2">
					<SectionTitle title="Colours" />
					<div className="frame grid gap-px bg-[var(--rule)] sm:grid-cols-2">
						{SYNTAX_TOKENS.map((t) => {
							const value = typing[t.key] ?? vars[t.key];
							const ok = isColor(value);
							return (
								<div key={t.key} className="flex items-center gap-3 bg-popover p-3">
									{isHex6(vars[t.key]) ? (
										<input type="color" aria-label={`${t.label} colour`} value={vars[t.key].toLowerCase()} onChange={(e) => apply({ ...vars, [t.key]: e.target.value })} className="h-8 w-8 shrink-0 cursor-pointer bg-transparent p-0" />
									) : (
										<span aria-hidden className="h-8 w-8 shrink-0" style={{ background: ok ? value : "transparent" }} />
									)}
									<div className="min-w-0 flex-1">
										<p className="truncate text-sm font-semibold">{t.label}</p>
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
												setText(syntaxToText({ ...vars, [t.key]: v }));
											}
										}}
										onBlur={() => setTyping((p) => Object.fromEntries(Object.entries(p).filter(([k]) => k !== t.key)))}
										className={cn("h-8 w-28 bg-input px-2 font-mono text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-primary/40", !ok && "ring-1 ring-destructive")}
									/>
								</div>
							);
						})}
					</div>
				</section>

				<section className="space-y-2">
					<SectionTitle title="As CSS" />
					<textarea
						id="scheme-css"
						aria-label="As CSS"
						value={text}
						spellCheck={false}
						onChange={(e) => {
							setText(e.target.value);
							const r = textToSyntax(e.target.value, vars);
							setVars(r.vars);
							setSkipped(r.skipped);
						}}
						rows={6}
						className="w-full resize-y bg-input p-3 font-mono text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
					/>
					<p className={cn("text-[13px]", skipped ? "text-warning" : "text-muted-foreground")}>
						{skipped ? `${skipped} ${skipped === 1 ? "line was" : "lines were"} not used: names must be ones listed above and values hex, rgb(), hsl() or oklch() colours.` : "One --syn-name: value; per line. Paste a whole scheme here to import it."}
					</p>
				</section>

				<DialogFooter>
					<Button variant="outline" onPress={onClose}>
						Cancel
					</Button>
					<Button isDisabled={!canSave} onPress={save}>
						Save Colours
					</Button>
				</DialogFooter>
			</div>
		</Dialog>
	);
}
