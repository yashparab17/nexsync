import { useEffect, useState } from "react";

import { Plus } from "@/components/animate-icons";
import { Panel } from "@/components/layout/Page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { projectGenerate, projectGenerators } from "@/lib/tauri";
import { cn, errorText } from "@/lib/utils";
import type { Generator, Planned } from "@/types/projects";

// The team's scaffolds (nexsync.generators.json in the project): ask for a name or two, show the files, write them. It only
// writes new files and never replaces one. Hidden when the project has none.
export default function GeneratorsPanel({ path, project, onCreated }: { path: string; project: string; onCreated: (firstPath: string) => void }) {
	const [list, setList] = useState<Generator[] | null>(null);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [open, setOpen] = useState<string | null>(null);
	const [values, setValues] = useState<Record<string, string>>({});
	const [planned, setPlanned] = useState<Planned[] | null>(null);
	const [problem, setProblem] = useState<string | null>(null);

	useEffect(() => {
		projectGenerators(path, project)
			.then((r) => {
				setList(r.generators);
				setLoadError(r.error);
			})
			.catch(() => setList([]));
	}, [path, project]);

	const current = list?.find((g) => g.id === open) ?? null;
	const key = JSON.stringify(values);
	// The files that would be written, asked again as the names are typed
	useEffect(() => {
		if (!current) return setPlanned(null);
		let live = true;
		projectGenerate(path, project, current.id, values, true)
			.then((p) => live && (setPlanned(p), setProblem(null)))
			.catch((e) => live && (setPlanned(null), setProblem(errorText(e, ""))));
		return () => {
			live = false;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps -- key stands for the values
	}, [path, project, current?.id, key]);

	if (!list || (list.length === 0 && !loadError)) return null;

	const pick = (g: Generator) => {
		setOpen(open === g.id ? null : g.id);
		setValues(Object.fromEntries(g.inputs.map((i) => [i.id, i.default])));
		setProblem(null);
	};
	const create = () => {
		if (!current) return;
		projectGenerate(path, project, current.id, values, false)
			.then((p) => {
				setOpen(null);
				if (p[0]) onCreated(p[0].path);
			})
			.catch((e) => setProblem(errorText(e, "Nothing was written.")));
	};

	return (
		<Panel title="Generators" hint={String(list.length)} icon={<Plus />} flush={list.length > 0}>
			{loadError && (
				<p role="alert" className="m-4 bg-destructive/10 p-2 text-sm text-destructive">
					{loadError}
				</p>
			)}
			<ul className="divide-y">
				{list.map((g) => (
					<li key={g.id} className="px-4 py-3">
						<div className="flex items-center gap-3">
							<span className="min-w-0 flex-1">
								<span className="block truncate text-sm font-medium">{g.label || g.id}</span>
								{g.description && <span className="block truncate text-[13px] text-muted-foreground">{g.description}</span>}
							</span>
							<Button variant={open === g.id ? "ghost" : "outline"} size="xs" onPress={() => pick(g)}>
								{open === g.id ? "Close" : "Use"}
							</Button>
						</div>
						{open === g.id && (
							<form
								className="mt-3 space-y-2"
								onSubmit={(e) => {
									e.preventDefault();
									create();
								}}
							>
								{g.inputs.map((i, n) => (
									<label key={i.id} className="flex items-center gap-3 text-sm">
										<span className="w-28 shrink-0 text-muted-foreground">{i.label || i.id}</span>
										<Input autoFocus={n === 0} autoComplete="off" value={values[i.id] ?? ""} onChange={(e) => setValues({ ...values, [i.id]: e.target.value })} className="min-w-40 flex-1" />
									</label>
								))}
								{planned && (
									<ul className="bg-muted/40 p-2 font-mono text-[13px]">
										{planned.map((p) => (
											<li key={p.path} className={cn(p.exists && "text-destructive")}>
												{p.path}
												{p.exists && " (already there)"}
											</li>
										))}
									</ul>
								)}
								{problem && <p className="text-[13px] text-destructive">{problem}</p>}
								<Button type="submit" size="sm" isDisabled={!planned || planned.some((p) => p.exists)}>
									Create {planned ? `${planned.length} ${planned.length === 1 ? "File" : "Files"}` : ""}
								</Button>
							</form>
						)}
					</li>
				))}
			</ul>
		</Panel>
	);
}
