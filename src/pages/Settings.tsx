import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { open } from "@tauri-apps/plugin-dialog";
import { getVersion } from "@tauri-apps/api/app";
import { relaunch } from "@tauri-apps/plugin-process";
import {
	ArrowLeft,
	Bug,
	Check,
	Code2,
	DownloadCloud,
	FolderPlus,
	Globe,
	HardDrive,
	Loader2,
	Minus,
	Monitor,
	Moon,
	Palette,
	Plus,
	Save,
	ShieldCheck,
	Sun,
	Trash2,
	Undo2,
	User,
} from "lucide-react";

import ErrorLogCard from "@/components/elements/ErrorLogCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useAppUpdater } from "@/hooks/useAppUpdater";
import { useErrorLog } from "@/hooks/useErrorLog";
import { colorForName } from "@/lib/collabColor";
import {
	DEFAULT_EDITOR_PREFS,
	FONT_SIZE_RANGE,
	TAB_SIZES,
	resetEditorPrefs,
	setEditorPrefs,
	useEditorPrefs,
} from "@/lib/editorPrefs";
import { loadConfig, saveConfig } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { useThemeContext, type ThemePreference } from "@/store/ThemeContext";
import Loading from "@/components/Loading";

const NAME_LIMIT = 40;

const SECTIONS = [
	{ id: "profile", label: "Profile", icon: User },
	{ id: "appearance", label: "Appearance", icon: Palette },
	{ id: "editor", label: "Editor", icon: Code2 },
	{ id: "storage", label: "Storage", icon: HardDrive },
	{ id: "updates", label: "Updates & About", icon: DownloadCloud },
	{ id: "diagnostics", label: "Diagnostics", icon: Bug },
];

// Two paths are the same folder if they differ only in slashes, a trailing slash or letter case
const samePath = (a: string, b: string) => {
	const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
	return norm(a) === norm(b);
};

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((item, i) => item === b[i]);

// A row inside a card: what the setting is on the left, its control on the right
function Row({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
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
function Segmented<T extends string | number>({
	label,
	value,
	options,
	onChange,
}: {
	label: string;
	value: T;
	options: { value: T; label: string; icon?: ReactNode }[];
	onChange: (value: T) => void;
}) {
	return (
		<div role="group" aria-label={label} className="inline-flex border">
			{options.map((option) => (
				<Button
					key={option.value}
					size="xs"
					variant={option.value === value ? "secondary" : "ghost"}
					aria-pressed={option.value === value}
					onPress={() => onChange(option.value)}
				>
					{option.icon}
					{option.label}
				</Button>
			))}
		</div>
	);
}

function SectionCard({
	id,
	title,
	description,
	icon,
	children,
}: {
	id: string;
	title: string;
	description: string;
	icon: ReactNode;
	children: ReactNode;
}) {
	return (
		<Card id={id} className="scroll-mt-8">
			<CardHeader>
				<CardTitle className="flex items-center gap-2 text-base">
					{icon}
					{title}
				</CardTitle>
				<CardDescription>{description}</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">{children}</CardContent>
		</Card>
	);
}

// App-wide preferences: who you are to collaborators, how the app looks, and where workspaces may live
export default function Settings() {
	const navigate = useNavigate();
	const { preference, setPreference } = useThemeContext();
	const logError = useErrorLog();
	const updater = useAppUpdater();
	const editorPrefs = useEditorPrefs();

	// What is on disk, and the edits not saved yet
	const [saved, setSaved] = useState<{ name: string; roots: string[]; proxy: string } | null>(null);
	const [proxy, setProxy] = useState("");
	// The proxy is read when the app starts, so a change needs a restart
	const [restartNeeded, setRestartNeeded] = useState(false);
	const [name, setName] = useState("");
	const [roots, setRoots] = useState<string[]>([]);
	const [newRoot, setNewRoot] = useState("");
	const [rootNote, setRootNote] = useState<string | null>(null);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const [justSaved, setJustSaved] = useState(false);
	const [saveError, setSaveError] = useState<string | null>(null);
	const [leaving, setLeaving] = useState(false);
	const [version, setVersion] = useState<string | null>(null);

	useEffect(() => {
		let current = true;
		loadConfig()
			.then((config) => {
				if (!current) return;
				setSaved({ name: config.display_name, roots: config.allowed_workspace_roots, proxy: config.proxy_url ?? "" });
				setName(config.display_name);
				setProxy(config.proxy_url ?? "");
				setRoots(config.allowed_workspace_roots);
			})
			.catch((err) => {
				if (!current) return;
				setLoadError(err instanceof Error ? err.message : String(err));
				logError(err, { source: "load_config" });
			});
		getVersion()
			.then((v) => current && setVersion(v))
			.catch(() => {});
		return () => {
			current = false;
		};
	}, [logError]);

	const dirty = saved !== null && (name.trim() !== saved.name.trim() || proxy.trim() !== saved.proxy.trim() || !sameList(roots, saved.roots));
	const noRoots = saved !== null && roots.length === 0;

	const save = useCallback(async () => {
		if (!saved || !dirty || saving || roots.length === 0) return;
		const next = { name: name.trim(), roots, proxy: proxy.trim() };
		setSaving(true);
		setSaveError(null);
		try {
			await saveConfig({ display_name: next.name, allowed_workspace_roots: next.roots, proxy_url: next.proxy });
			if (next.proxy !== saved.proxy) setRestartNeeded(true);
			setSaved(next);
			setName(next.name);
			setProxy(next.proxy);
			setJustSaved(true);
		} catch (err) {
			// The backend refuses folders such as system directories, and says why
			setSaveError(err instanceof Error ? err.message : String(err));
			logError(err, { source: "save_config" });
		} finally {
			setSaving(false);
		}
	}, [saved, dirty, saving, name, roots, logError]);

	const discard = () => {
		if (!saved) return;
		setName(saved.name);
		setProxy(saved.proxy);
		setRoots(saved.roots);
		setNewRoot("");
		setRootNote(null);
		setSaveError(null);
	};

	// The "Saved" note goes away by itself, or as soon as something else is edited
	useEffect(() => {
		if (!justSaved) return;
		const timer = setTimeout(() => setJustSaved(false), 2500);
		return () => clearTimeout(timer);
	}, [justSaved]);
	useEffect(() => {
		if (dirty) setJustSaved(false);
	}, [dirty]);

	// Ctrl+S saves from anywhere on the page
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
				e.preventDefault();
				void save();
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [save]);

	const addRoot = (path: string) => {
		// Trailing separators are dropped, but "C:\" keeps its own
		const trimmed = path.trim().replace(/([^:])[\\/]+$/, "$1");
		if (!trimmed) return;
		if (roots.some((root) => samePath(root, trimmed))) {
			setRootNote("That folder is already in the list.");
			return;
		}
		setRoots((prev) => [...prev, trimmed]);
		setNewRoot("");
		setRootNote(null);
		setSaveError(null);
	};

	const browse = async () => {
		try {
			const selected = await open({ directory: true, multiple: false, title: "Select allowed workspace folder" });
			if (typeof selected === "string") addRoot(selected);
		} catch (err) {
			logError(err, { source: "browse_root_dir" });
		}
	};

	const back = () => (dirty ? setLeaving(true) : navigate(-1));

	const nameColor = colorForName(name.trim() || "Collaborator");

	return (
		<div className="min-h-full bg-background">
			<div className="mx-auto flex max-w-5xl gap-8 p-8">
				{/* Section list */}
				<aside className="hidden w-44 shrink-0 md:block">
					<nav aria-label="Settings sections" className="sticky top-8 space-y-1">
						{SECTIONS.map(({ id, label, icon: Icon }) => (
							<button
								key={id}
								type="button"
								onClick={() => document.getElementById(id)?.scrollIntoView?.({ behavior: "smooth", block: "start" })}
								className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
							>
								<Icon className="size-4 shrink-0" />
								{label}
							</button>
						))}
					</nav>
				</aside>

				<div className="min-w-0 flex-1 space-y-6">
					<div className="flex items-center gap-3">
						<Button variant="ghost" size="icon" onPress={back} aria-label="Back">
							<ArrowLeft className="size-5" />
						</Button>
						<div>
							<h1 className="text-3xl font-bold tracking-tight">Settings</h1>
							<p className="text-sm text-muted-foreground">
								Preferences for this device. Nothing here is shared with collaborators except your name.
							</p>
						</div>
					</div>

					{loadError && (
						<p role="alert" className="border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
							Could not load your settings: {loadError}
						</p>
					)}

					<SectionCard
						id="profile"
						title="Profile"
						description="How collaborators see you when you join a workspace."
						icon={<User className="size-4 text-primary" />}
					>
						<div className="flex items-center gap-4">
							<div
								aria-hidden
								className="flex size-12 shrink-0 items-center justify-center text-lg font-bold text-white"
								style={{ background: nameColor }}
							>
								{(name.trim() || "C").charAt(0).toUpperCase()}
							</div>
							<div className="min-w-0 flex-1 space-y-1">
								<Input
									value={name}
									maxLength={NAME_LIMIT}
									onChange={(e) => setName(e.target.value)}
									placeholder="Collaborator"
									aria-label="Display name"
									disabled={saved === null}
								/>
								<div className="flex justify-between text-xs text-muted-foreground">
									<span>Leave it empty to appear as “Collaborator”. Your cursor color comes from this name.</span>
									<span className="tabular-nums">
										{name.length}/{NAME_LIMIT}
									</span>
								</div>
							</div>
						</div>
					</SectionCard>

					<SectionCard
						id="network"
						title="Network"
						description="Only needed if your network allows web traffic through a proxy and nothing else."
						icon={<Globe className="size-4 text-primary" />}
					>
						<div className="space-y-1">
							<Input
								value={proxy}
								maxLength={256}
								onChange={(e) => setProxy(e.target.value)}
								placeholder="http://proxy.example.edu:8080"
								aria-label="Proxy address"
								disabled={saved === null}
							/>
							<p className="text-xs text-muted-foreground">
								Leave it empty to connect directly. Addresses with a username or password are not accepted, since they would be stored as plain text.
							</p>
							{restartNeeded && (
								<div className="flex items-center justify-between gap-2 border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-400">
									<span>Restart Nexsync to use the new proxy.</span>
									<Button size="sm" variant="outline" onPress={() => void relaunch()}>
										Restart now
									</Button>
								</div>
							)}
						</div>
					</SectionCard>

					<SectionCard
						id="appearance"
						title="Appearance"
						description="The theme is applied at once and remembered on this device."
						icon={<Palette className="size-4 text-primary" />}
					>
						<Row title="Theme" hint="System follows your operating system, including when it switches at night.">
							<Segmented<ThemePreference>
								label="Theme"
								value={preference}
								onChange={setPreference}
								options={[
									{ value: "light", label: "Light", icon: <Sun className="size-3.5" /> },
									{ value: "dark", label: "Dark", icon: <Moon className="size-3.5" /> },
									{ value: "system", label: "System", icon: <Monitor className="size-3.5" /> },
								]}
							/>
						</Row>
					</SectionCard>

					<SectionCard
						id="editor"
						title="Editor"
						description="How code and Markdown look in the Editor and Notes tabs. Applied at once to open files."
						icon={<Code2 className="size-4 text-primary" />}
					>
						<Row title="Font size" hint={`${FONT_SIZE_RANGE.min} to ${FONT_SIZE_RANGE.max} px`}>
							<Button
								variant="outline"
								size="icon-xs"
								aria-label="Smaller text"
								isDisabled={editorPrefs.fontSize <= FONT_SIZE_RANGE.min}
								onPress={() => setEditorPrefs({ fontSize: editorPrefs.fontSize - 1 })}
							>
								<Minus />
							</Button>
							<span className="w-12 text-center text-sm tabular-nums" aria-live="polite">
								{editorPrefs.fontSize} px
							</span>
							<Button
								variant="outline"
								size="icon-xs"
								aria-label="Larger text"
								isDisabled={editorPrefs.fontSize >= FONT_SIZE_RANGE.max}
								onPress={() => setEditorPrefs({ fontSize: editorPrefs.fontSize + 1 })}
							>
								<Plus />
							</Button>
						</Row>
						<Row title="Tab width" hint="How wide a tab character looks.">
							<Segmented
								label="Tab width"
								value={editorPrefs.tabSize}
								onChange={(tabSize) => setEditorPrefs({ tabSize })}
								options={TAB_SIZES.map((size) => ({ value: size, label: String(size) }))}
							/>
						</Row>
						<Row title="Wrap long lines" hint="Markdown always wraps.">
							<input
								type="checkbox"
								aria-label="Wrap long lines"
								className="size-4 accent-primary"
								checked={editorPrefs.wrap}
								onChange={(e) => setEditorPrefs({ wrap: e.target.checked })}
							/>
						</Row>
						<pre
							aria-label="Editor preview"
							className="overflow-x-auto border bg-muted/20 p-3 font-mono"
							style={{
								fontSize: editorPrefs.fontSize,
								tabSize: editorPrefs.tabSize,
								whiteSpace: editorPrefs.wrap ? "pre-wrap" : "pre",
							}}
						>
							{"function greet(name) {\n\treturn `Hello, ${name}! Welcome to the workspace.`;\n}"}
						</pre>
						<Button
							variant="outline"
							size="xs"
							onPress={resetEditorPrefs}
							isDisabled={JSON.stringify(editorPrefs) === JSON.stringify(DEFAULT_EDITOR_PREFS)}
						>
							<Undo2 />
							Reset editor settings
						</Button>
					</SectionCard>

					<SectionCard
						id="storage"
						title="Storage"
						description="Workspaces can only be created or imported inside these folders. This keeps Nexsync away from the rest of your disk."
						icon={<ShieldCheck className="size-4 text-emerald-400" />}
					>
						{saved === null && !loadError ? (
							<Loading />
						) : (
							<ul className="space-y-2" aria-label="Allowed folders">
								{roots.map((root, index) => (
									<li
										key={root}
										className="flex items-center justify-between border bg-muted/20 px-3 py-2 font-mono text-xs"
									>
										<span className="flex min-w-0 items-center gap-2">
											<HardDrive className="size-3.5 shrink-0 text-muted-foreground" />
											<span className="truncate" title={root}>
												{root}
											</span>
										</span>
										<Button
											variant="ghost"
											size="icon-xs"
											aria-label={`Remove ${root}`}
											onPress={() => setRoots((prev) => prev.filter((_, i) => i !== index))}
										>
											<Trash2 className="size-3.5 text-muted-foreground hover:text-destructive" />
										</Button>
									</li>
								))}
							</ul>
						)}
						{noRoots && (
							<p role="alert" className="text-xs text-destructive">
								Add at least one folder, or you will not be able to create or import workspaces.
							</p>
						)}

						<div className="flex flex-col gap-2 sm:flex-row">
							<Input
								value={newRoot}
								onChange={(e) => {
									setNewRoot(e.target.value);
									setRootNote(null);
								}}
								placeholder="Folder path, e.g. C:\Users\You\Documents"
								aria-label="Folder path"
								className="font-mono text-xs"
								onKeyDown={(e) => {
									if (e.key === "Enter") {
										e.preventDefault();
										addRoot(newRoot);
									}
								}}
							/>
							<div className="flex gap-2">
								<Button variant="outline" size="sm" onPress={() => addRoot(newRoot)} isDisabled={!newRoot.trim()}>
									<Plus className="size-4" />
									Add
								</Button>
								<Button variant="outline" size="sm" onPress={() => void browse()}>
									<FolderPlus className="size-4" />
									Browse
								</Button>
							</div>
						</div>
						{rootNote && <p className="text-xs text-destructive">{rootNote}</p>}
					</SectionCard>

					<SectionCard
						id="updates"
						title="Updates & About"
						description="Nexsync keeps your work on your own computer: no account, no cloud, and no server holding your data."
						icon={<DownloadCloud className="size-4 text-primary" />}
					>
						<Row title="Version" hint="Notes, tasks and code, shared directly between your devices.">
							<span className="text-sm font-semibold tabular-nums">{version ? `v${version}` : "…"}</span>
						</Row>
						<Row
							title="Updates"
							hint="Signed builds come from GitHub Releases. Nothing is checked until you ask."
						>
							{updater.status === "available" || updater.status === "installing" ? (
								<Button size="sm" onPress={updater.installUpdate} isDisabled={updater.status === "installing"}>
									{updater.status === "installing" ? (
										<Loader2 className="size-3.5 animate-spin" />
									) : (
										<DownloadCloud className="size-3.5" />
									)}
									{updater.status === "installing" ? "Installing…" : `Install v${updater.version} & restart`}
								</Button>
							) : (
								<Button
									variant="outline"
									size="sm"
									onPress={updater.checkForUpdate}
									isDisabled={updater.status === "checking"}
								>
									{updater.status === "checking" ? (
										<Loader2 className="size-3.5 animate-spin" />
									) : (
										<DownloadCloud className="size-3.5" />
									)}
									Check for updates
								</Button>
							)}
						</Row>
						{updater.status === "up-to-date" && (
							<p role="status" className="flex items-center gap-1.5 text-xs text-emerald-400">
								<Check className="size-3.5" />
								You are on the latest version.
							</p>
						)}
						{updater.status === "error" && <p className="text-xs text-destructive">{updater.error}</p>}
					</SectionCard>

					<div id="diagnostics" className="scroll-mt-8">
						<ErrorLogCard />
					</div>
				</div>
			</div>

			{/* Appears while there is something to save; the profile and storage sections save together */}
			{(dirty || saving || justSaved || saveError) && (
				<div
					role="region"
					aria-label="Unsaved changes"
					className="sticky bottom-0 border-t bg-background/95 backdrop-blur"
				>
					<div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3 px-8 py-3">
						<p
							role={saveError ? "alert" : "status"}
							className={cn(
								"min-w-0 flex-1 text-xs",
								saveError ? "text-destructive" : justSaved ? "text-emerald-400" : "text-muted-foreground",
							)}
						>
							{saveError
								? `Could not save: ${saveError}`
								: justSaved && !dirty
									? "Settings saved."
									: "You have unsaved changes to your profile or storage folders."}
						</p>
						<Button variant="outline" size="sm" onPress={discard} isDisabled={!dirty || saving}>
							Discard
						</Button>
						<Button size="sm" onPress={() => void save()} isDisabled={!dirty || saving || noRoots}>
							{saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
							{saving ? "Saving…" : "Save changes"}
						</Button>
					</div>
				</div>
			)}

			{leaving && (
				<Dialog isOpen onOpenChange={(isOpen) => !isOpen && setLeaving(false)}>
					<div className="space-y-4">
						<DialogHeader>
							<DialogTitle>Leave without saving?</DialogTitle>
							<DialogDescription>Your changes to the profile or storage folders will be lost.</DialogDescription>
						</DialogHeader>
						<DialogFooter>
							<Button variant="outline" onPress={() => setLeaving(false)}>
								Keep editing
							</Button>
							<Button variant="destructive" onPress={() => navigate(-1)}>
								Discard and leave
							</Button>
						</DialogFooter>
					</div>
				</Dialog>
			)}
		</div>
	);
}
