import { useEffect, useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";

import { AlertTriangle, Check, FolderPlus, FolderUp, Info } from "@/components/animate-icons";
import { ToolbarTabs } from "@/components/layout/Toolbar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogHeading } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ansiPieces } from "@/lib/ansi";
import { useRuns } from "@/features/projects/lib/projectRuns";
import { projectDoctor, projectImport, projectImportPreview, projectScaffold, projectScaffoldPreview, projectTemplates } from "@/lib/tauri";
import { errorText, formatBytes } from "@/lib/utils";
import type { Doctor, ImportPreview, Template } from "@/features/projects/types";

type Mode = "empty" | "template" | "import";

const cleanName = (s: string) => s.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^[-_]+/, "").slice(0, 60);

// Three ways to start a project: an empty folder, a template (the ecosystem's own creator, run for you, with the command shown
// first), or a folder from elsewhere on this computer with a look at what would be shared before it is copied in.
export default function NewProjectDialog({ path, existing, onClose, onCreateEmpty, onDone }: { path: string; existing: string[]; onClose: () => void; onCreateEmpty: (name: string) => Promise<void>; onDone: (name: string) => void }) {
	const [mode, setMode] = useState<Mode>("empty");
	const [name, setName] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const clean = name.trim();
	const taken = existing.some((e) => e.toLowerCase() === clean.toLowerCase());
	const problem = !clean ? "Give the project a name." : taken ? "A project with that name exists." : mode !== "empty" && cleanName(clean) !== clean ? "Use letters, digits, - and _." : null;

	// Templates
	const [templates, setTemplates] = useState<Template[]>([]);
	const [picked, setPicked] = useState<string>("vite");
	const [choices, setChoices] = useState<Record<string, string>>({});
	const [command, setCommand] = useState<string | null>(null);
	const [doctor, setDoctor] = useState<Doctor | null>(null);
	const [creating, setCreating] = useState<string | null>(null);
	const template = templates.find((t) => t.id === picked);
	const options = useMemo(() => (template ? template.fields.map((f) => [f.id, choices[f.id] ?? f.choices[0].value] as [string, string]) : []), [template, choices]);
	const runs = useRuns(creating ?? undefined);
	const run = runs[0];

	useEffect(() => {
		void projectTemplates().then(setTemplates).catch(() => {});
	}, []);
	useEffect(() => {
		setCommand(null);
		if (mode !== "template" || !template || !clean || cleanName(clean) !== clean) return;
		void projectScaffoldPreview(template.id, clean, options).then(setCommand).catch(() => setCommand(null));
	}, [mode, template, clean, options]);
	useEffect(() => {
		setDoctor(null);
		if (mode !== "template" || !template || template.requires.length === 0) return;
		void projectDoctor(path, template.requires.map((r) => ({ name: r, range: "" }))).then(setDoctor).catch(() => {});
	}, [mode, template, path]);

	// Import
	const [source, setSource] = useState<string | null>(null);
	const [preview, setPreview] = useState<ImportPreview | null>(null);
	const [skipKept, setSkipKept] = useState(true);
	const choose = async () => {
		const dir = await open({ directory: true, title: "Choose a folder to import" });
		if (typeof dir !== "string") return;
		setSource(dir);
		setPreview(null);
		setError(null);
		if (!name) setName(cleanName(dir.split(/[\\/]/).filter(Boolean).pop() ?? ""));
		try {
			setPreview(await projectImportPreview(path, dir));
		} catch (err) {
			setError(errorText(err, "Could not look at that folder."));
		}
	};

	const submit = async () => {
		setError(null);
		setBusy(true);
		try {
			if (mode === "empty") {
				await onCreateEmpty(clean);
				onClose();
			} else if (mode === "template" && template) {
				await projectScaffold(path, template.id, clean, options);
				setCreating(clean);
			} else if (mode === "import" && source) {
				await projectImport(path, source, clean, skipKept);
				onDone(clean);
			}
		} catch (err) {
			setError(errorText(err, "That did not work."));
		} finally {
			setBusy(false);
		}
	};

	const groups = [...new Set(templates.map((t) => t.group))];
	const missing = doctor?.tools.filter((t) => t.state === "missing") ?? [];
	const scanned = preview ? preview.scan.secrets.length + preview.scan.hazards.length + preview.scan.held.length : 0;
	const finished = run?.status === "done";
	const ok = finished && run.code === 0 && !run.error;

	return (
		<Dialog isOpen onOpenChange={(o) => !o && !busy && onClose()} className="sm:max-w-2xl">
			<div className="flex flex-col gap-4">
				<DialogHeading icon={mode === "import" ? <FolderUp className="size-6" /> : <FolderPlus className="size-6" />} title="New Project" description="Start empty, from a template, or from a folder you already have." />
				{!creating && <ToolbarTabs label="How to start" value={mode} onChange={(m) => { setMode(m); setError(null); }} tabs={[{ key: "empty", label: "Empty Folder" }, { key: "template", label: "From a Template" }, { key: "import", label: "Import a Folder" }]} />}

				{!creating && (
					<div className="space-y-1">
						<Label htmlFor="project-name">Name</Label>
						<Input id="project-name" autoFocus value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="web-app" />
						{clean && problem && <p className="text-[13px] text-destructive">{problem}</p>}
					</div>
				)}

				{mode === "template" && !creating && template && (
					<div className="space-y-3">
						<div className="grid gap-3 sm:grid-cols-2">
							<div className="space-y-1">
								<Label htmlFor="template">Template</Label>
								<select id="template" value={picked} onChange={(e) => { setPicked(e.target.value); setChoices({}); }} className="h-10 w-full cursor-pointer border bg-input px-2 text-sm">
									{groups.map((g) => (
										<optgroup key={g} label={g}>
											{templates.filter((t) => t.group === g).map((t) => (
												<option key={t.id} value={t.id}>
													{t.label}
												</option>
											))}
										</optgroup>
									))}
								</select>
							</div>
							{template.fields.map((f) => (
								<div key={f.id} className="space-y-1">
									<Label htmlFor={`f-${f.id}`}>{f.label}</Label>
									<select id={`f-${f.id}`} value={choices[f.id] ?? f.choices[0].value} onChange={(e) => setChoices((c) => ({ ...c, [f.id]: e.target.value }))} className="h-10 w-full cursor-pointer border bg-input px-2 text-sm">
										{f.choices.map((c) => (
											<option key={c.value} value={c.value}>
												{c.label}
											</option>
										))}
									</select>
								</div>
							))}
						</div>
						<p className="text-sm text-muted-foreground">{template.about}. Nexsync runs the tool below in the projects folder and adds nothing to what it makes.</p>
						<div>
							<p className="text-[13px] text-muted-foreground">This is the command that will run</p>
							<pre className="bg-muted p-2 font-mono text-[13px] break-all whitespace-pre-wrap">{command ?? "Give the project a name to see the command."}</pre>
						</div>
						{missing.length > 0 && (
							<p className="flex items-start gap-2 text-sm text-warning">
								<AlertTriangle className="mt-0.5 size-4 shrink-0" />
								{missing.map((m) => m.name).join(", ")} {missing.length === 1 ? "was" : "were"} not found on this device, so the command will probably fail. The Projects page's Tools panel says how to install {missing.length === 1 ? "it" : "them"}.
							</p>
						)}
					</div>
				)}

				{mode === "import" && !creating && (
					<div className="space-y-3">
						<div className="flex items-center gap-3">
							<Button variant="outline" onPress={() => void choose()}>
								Choose a Folder
							</Button>
							<span className="min-w-0 flex-1 truncate font-mono text-[13px] text-muted-foreground">{source ?? "No folder chosen"}</span>
						</div>
						{source && !preview && !error && <p className="text-sm text-muted-foreground">Looking...</p>}
						{preview && (
							<div className="space-y-3 text-sm">
								<p>
									<span className="font-semibold">{preview.files.toLocaleString()} files, {formatBytes(preview.bytes)}</span> would be shared with the team.
								</p>
								{preview.left.length > 0 && (
									<div>
										<p className="text-[13px] text-muted-foreground">Kept on each device, not shared</p>
										<ul className="max-h-36 overflow-auto bg-muted/40">
											{preview.left.map((l) => (
												<li key={l.path} className="flex items-center gap-3 px-3 py-1">
													<span className="min-w-0 flex-1 truncate font-mono text-[13px]">
														{l.path}
														{l.folder ? "/" : ""}
													</span>
													<span className="font-mono text-[13px] text-muted-foreground">{l.folder ? `${l.files.toLocaleString()} files, ` : ""}{formatBytes(l.bytes)}</span>
												</li>
											))}
										</ul>
										<label className="mt-2 flex cursor-pointer items-center gap-2">
											<input type="checkbox" checked={skipKept} onChange={(e) => setSkipKept(e.target.checked)} />
											Leave those behind (recommended). Dependencies are installed again here.
										</label>
									</div>
								)}
								{scanned > 0 && (
									<p className="flex items-start gap-2 text-warning">
										<AlertTriangle className="mt-0.5 size-4 shrink-0" />
										{[preview.scan.secrets.length && `${preview.scan.secrets.length} lines look like secrets`, preview.scan.hazards.length && `${preview.scan.hazards.length} names another system cannot hold`, preview.scan.held.length && `${preview.scan.held.length} files over 25 MB stay on this device`].filter(Boolean).join(", ")}. The Projects page lists them once the folder is in.
									</p>
								)}
								<p className="flex items-start gap-2 text-muted-foreground">
									<Info className="mt-0.5 size-4 shrink-0" />
									Git history is not copied (Git support comes later). The folder is copied; the original is not changed.
								</p>
							</div>
						)}
					</div>
				)}

				{creating && (
					<div className="space-y-2">
						<p className="text-sm">
							{!finished ? "Running..." : ok ? <span className="flex items-center gap-2 text-success"><Check className="size-4" />Created.</span> : <span className="text-destructive">It did not finish: {run?.error ?? `code ${run?.code ?? "none"}`}.</span>}
						</p>
						<div role="log" aria-label="Output" className="max-h-64 min-h-32 overflow-auto bg-muted/40 p-3 font-mono text-[13px] leading-5">
							{(run?.lines ?? []).map((l, i) => (
								<div key={i} className="break-all whitespace-pre-wrap">
									{ansiPieces(l.text).map((p, j) => (
										<span key={j} className={p.className}>{p.text}</span>
									))}
								</div>
							))}
						</div>
					</div>
				)}

				{error && (
					<p role="alert" className="bg-destructive/10 p-2 text-sm text-destructive">
						{error}
					</p>
				)}
				<div className="flex justify-end gap-2">
					<Button variant="ghost" isDisabled={busy} onPress={onClose}>
						{creating ? "Close" : "Cancel"}
					</Button>
					{creating ? (
						<Button isDisabled={!ok} onPress={() => onDone(creating)}>
							Open the Project
						</Button>
					) : (
						<Button isDisabled={busy || !!problem || (mode === "import" && !preview) || (mode === "template" && !command)} onPress={() => void submit()}>
							{mode === "template" ? "Run and Create" : mode === "import" ? "Import" : "Create Project"}
						</Button>
					)}
				</div>
			</div>
		</Dialog>
	);
}
