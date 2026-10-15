import { useState } from "react";

import { Check, KeyRound, Trash2 } from "@/components/animate-icons";
import { Panel } from "@/components/layout/Page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { projectEnvClear, projectEnvSet } from "@/lib/tauri";
import { errorText } from "@/lib/utils";
import type { EnvState } from "@/types/projects";

const WHERE = { missing: "Not set on this device", file: "Set, in .env on this device", credential: "Set, in this system's credential store" } as const;

// The variables a project needs: what each is for (shared) and whether this device has a value (never shared). A value goes into
// .env, which never leaves the device, or into the operating system's credential store; the page never gets it back.
export default function EnvPanel({ path, project, vars, canEdit, onChanged }: { path: string; project: string; vars: EnvState[]; canEdit: boolean; onChanged: () => void }) {
	const [editing, setEditing] = useState<string | null>(null);
	const [value, setValue] = useState("");
	const [store, setStore] = useState<"file" | "credential">("file");
	const [error, setError] = useState<string | null>(null);

	const done = () => {
		setEditing(null);
		setValue("");
		setError(null);
		onChanged();
	};
	const run = (what: () => Promise<void>) => what().then(done).catch((e) => setError(errorText(e, "That did not work.")));
	const missing = vars.filter((v) => v.state === "missing").length;

	return (
		<Panel title="Environment Variables" icon={<KeyRound />} hint={vars.length ? `${vars.length - missing} of ${vars.length} set` : undefined} flush={vars.length > 0}>
			{vars.length === 0 ? (
				<p className="text-sm text-muted-foreground">No .env.example in this project. Its names, and what each is for, would be listed here. Values stay on each device, in .env or the credential store.</p>
			) : (
				<ul className="divide-y">
					{vars.map((v) => (
						<li key={v.name} className="px-4 py-3">
							<div className="flex items-center gap-3">
								<span className="min-w-0 flex-1">
									<span className="block font-mono text-sm">{v.name}</span>
									<span className="block text-[13px] text-muted-foreground">{v.description ? `${v.description}. ` : ""}{WHERE[v.state]}</span>
								</span>
								{v.state !== "missing" && <Check className="size-4 shrink-0 text-success" aria-label="Set" />}
								{canEdit && editing !== v.name && (
									<>
										<Button variant="outline" size="xs" onPress={() => { setEditing(v.name); setValue(""); setError(null); }}>
											{v.state === "missing" ? "Set" : "Change"}
										</Button>
										{v.state !== "missing" && (
											<Button variant="ghost" size="icon-xs" aria-label={`Remove ${v.name} from this device`} onPress={() => void run(() => projectEnvClear(path, project, v.name))}>
												<Trash2 className="size-3.5" />
											</Button>
										)}
									</>
								)}
							</div>
							{editing === v.name && (
								<form
									className="mt-2 flex flex-wrap items-center gap-2"
									onSubmit={(e) => {
										e.preventDefault();
										void run(() => projectEnvSet(path, project, v.name, value, store));
									}}
								>
									<Input type="password" autoFocus autoComplete="off" aria-label={`Value of ${v.name}`} value={value} onChange={(e) => setValue(e.target.value)} className="min-w-40 flex-1" />
									<select aria-label="Where to keep it" value={store} onChange={(e) => setStore(e.target.value as "file" | "credential")} className="h-8 cursor-pointer border bg-input px-2 text-sm">
										<option value="file">In .env</option>
										<option value="credential">In the credential store</option>
									</select>
									<Button type="submit" size="sm" isDisabled={!value}>
										Save
									</Button>
									<Button variant="ghost" size="sm" onPress={() => setEditing(null)}>
										Cancel
									</Button>
								</form>
							)}
						</li>
					))}
				</ul>
			)}
			{error && (
				<p role="alert" className="m-4 bg-destructive/10 p-2 text-sm text-destructive">
					{error}
				</p>
			)}
		</Panel>
	);
}
