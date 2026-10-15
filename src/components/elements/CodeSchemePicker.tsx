// Choosing the colours of code for each mode: follow the theme, a ready-made scheme, or one made here.

import { useState } from "react";
import { Pencil, Plus, Trash2 } from "@/components/animate-icons";

import CodeSample from "@/components/elements/CodeSample";
import CodeSchemeEditorDialog from "@/components/dialogs/CodeSchemeEditorDialog";
import { Button } from "@/components/ui/button";
import { AUTO_SCHEME, type CodeSchemeDef } from "@/lib/codeSchemes";
import type { ThemeMode } from "@/lib/themes";
import { useThemeContext } from "@/store/ThemeContext";

function Group({ mode, label }: { mode: ThemeMode; label: string }) {
	const { codeSchemeFor, codeSchemesFor, setCodeScheme, deleteCustomScheme, isDark } = useThemeContext();
	const [editing, setEditing] = useState<{ scheme?: CodeSchemeDef } | null>(null);
	const schemes = codeSchemesFor(mode);
	const value = codeSchemeFor(mode);
	const chosen = schemes.find((s) => s.id === value);
	const active = isDark === (mode === "dark");

	return (
		<div className="space-y-2">
			<div className="flex flex-wrap items-center gap-2">
				<label htmlFor={`code-${mode}`} className="mr-auto text-sm font-semibold">
					{label}
				</label>
				<select id={`code-${mode}`} value={value} onChange={(e) => setCodeScheme(mode, e.target.value)} className="h-8 border border-input bg-input px-2 text-sm outline-none focus-visible:border-ring">
					<option value={AUTO_SCHEME}>Match the theme</option>
					<optgroup label="Ready-made">
						{schemes.filter((s) => !s.custom).map((s) => (
							<option key={s.id} value={s.id}>
								{s.name}
							</option>
						))}
					</optgroup>
					{schemes.some((s) => s.custom) && (
						<optgroup label="Yours">
							{schemes.filter((s) => s.custom).map((s) => (
								<option key={s.id} value={s.id}>
									{s.name}
								</option>
							))}
						</optgroup>
					)}
				</select>
				{chosen?.custom && (
					<>
						<Button variant="ghost" size="icon-xs" aria-label={`Edit ${chosen.name}`} onPress={() => setEditing({ scheme: chosen })}>
							<Pencil className="size-3.5" />
						</Button>
						<Button variant="ghost" size="icon-xs" aria-label={`Delete ${chosen.name}`} onPress={() => deleteCustomScheme(chosen.id)}>
							<Trash2 className="size-3.5 text-destructive" />
						</Button>
					</>
				)}
				<Button variant="outline" size="sm" onPress={() => setEditing({})}>
					<Plus className="size-4" />
					New
				</Button>
			</div>
			{chosen ? <CodeSample vars={chosen.vars} /> : active ? <CodeSample /> : <p className="text-[13px] text-muted-foreground">Uses the colours of the {mode} theme you pick above.</p>}
			{editing && <CodeSchemeEditorDialog mode={mode} initial={editing.scheme} onClose={() => setEditing(null)} />}
		</div>
	);
}

export default function CodeSchemePicker() {
	return (
		<div className="space-y-4">
			<Group mode="dark" label="Code colours, dark" />
			<Group mode="light" label="Code colours, light" />
		</div>
	);
}
