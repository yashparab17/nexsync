import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { open } from "@tauri-apps/plugin-dialog";
import { APP_VERSION } from "@/lib/version";
import { relaunch } from "@tauri-apps/plugin-process";
import { Loader2 } from "lucide-react";
import { Upload, Check, Moon, Plus, Sun, Trash2, Code2, DownloadCloud, FolderPlus, Globe, HardDrive, Minus, Monitor, Palette, Save, Undo2, User, AlertTriangle } from "@/components/animate-icons";

import { Row, Segmented, SectionCard, SettingsShell } from "@/components/elements/SettingsParts";
import CodeSchemePicker from "@/components/elements/CodeSchemePicker";
import ThemePicker from "@/components/elements/ThemePicker";
import Avatar from "@/components/elements/Avatar";
import ColorSwatches from "@/components/elements/ColorSwatches";
import { ensureLocalColor, setLocalProfile, type Profile } from "@/lib/profile";
import { pictureToIcon } from "@/lib/workspaceIcon";
import ErrorLogCard from "@/components/elements/ErrorLogCard";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter, DialogHeading } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useAppUpdater } from "@/hooks/useAppUpdater";
import { useErrorLog } from "@/hooks/useErrorLog";
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

// Two paths are the same folder if they differ only in slashes, a trailing slash or letter case
const samePath = (a: string, b: string) => {
	const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
	return norm(a) === norm(b);
};

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((item, i) => item === b[i]);

// App-wide preferences: who you are to collaborators, how the app looks, and where workspaces may live
export default function Settings({ onClose }: { onClose?: () => void } = {}) {
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
	// How this person looks to others; kept on this device and shared into each workspace they open
	const [profile, setProfile] = useState<Profile>(() => ensureLocalColor());
	const picture = useRef<HTMLInputElement>(null);
	const [pictureError, setPictureError] = useState<string | null>(null);
	const changeProfile = (next: Profile) => {
		setProfile(next);
		setLocalProfile(next);
	};
	const [roots, setRoots] = useState<string[]>([]);
	const [newRoot, setNewRoot] = useState("");
	const [rootNote, setRootNote] = useState<string | null>(null);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const [justSaved, setJustSaved] = useState(false);
	const [saveError, setSaveError] = useState<string | null>(null);
	const [leaving, setLeaving] = useState(false);
	const version = APP_VERSION;

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

	// In the popup the parent closes it; as a plain page it goes back
	const close = () => (onClose ? onClose() : navigate(-1));
	const back = () => (dirty ? setLeaving(true) : close());

	return (
		<>
			<SettingsShell
				title="Settings"
				onClose={back}
				className={onClose ? "h-[85vh]" : "h-full"}
				footer={
					(dirty || saving || justSaved || saveError) && (
				<div
					role="region"
					aria-label="Unsaved changes"
					className=""
				>
					<div className="mx-auto flex max-w-3xl flex-wrap items-center gap-3 px-3 py-2">
						<p
							role={saveError ? "alert" : "status"}
							className={cn(
								"min-w-0 flex-1 text-xs",
								saveError ? "text-destructive" : justSaved ? "text-success" : "text-muted-foreground",
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
							{saving ? "Saving…" : "Save Changes"}
						</Button>
					</div>
				</div>
			)
				}
			>
					{loadError && (
						<p role="alert" className="border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
							Could not load your settings: {loadError}
						</p>
					)}

					<SectionCard
						id="profile"
						title="Profile"
						icon={<User className="size-5" />}
					>
						<div className="flex items-stretch gap-4">
							<Avatar name={name} profile={profile} className="h-auto w-16 text-xl" />
							<div className="min-w-0 flex-1 space-y-1">
								<Input
									value={name}
									maxLength={NAME_LIMIT}
									onChange={(e) => setName(e.target.value)}
									placeholder="Your name"
									aria-label="Display name"
									disabled={saved === null}
								/>
								<div className="flex justify-between text-xs text-muted-foreground">
									<span>Empty: your computer's name is used.</span>
									<span className="tabular-nums">
										{name.length}/{NAME_LIMIT}
									</span>
								</div>
							</div>
						</div>
						<div className="space-y-2">
							<p className="text-sm font-medium">Your colour</p>
							<ColorSwatches value={profile.color} onChange={(color) => changeProfile({ ...profile, color: color ?? undefined })} />
							<p className="text-[13px] text-muted-foreground">Colours your avatar and cursor. Change it whenever you like.</p>
						</div>
						<div className="space-y-2">
							<p className="text-sm font-medium">Your picture</p>
							<div className="flex flex-wrap items-center gap-2">
								<input
									ref={picture}
									type="file"
									accept="image/png,image/jpeg,image/webp"
									hidden
									aria-label="Choose a picture"
									onChange={(e) => {
										const f = e.target.files?.[0];
										e.target.value = "";
										if (!f) return;
										setPictureError(null);
										pictureToIcon(f)
											.then((icon) => icon.kind === "image" && changeProfile({ ...profile, image: icon.data }))
											.catch((err) => setPictureError(err instanceof Error ? err.message : String(err)));
									}}
								/>
								<Button variant="outline" size="sm" onPress={() => picture.current?.click()}>
									<Upload className="size-3.5" />
									Choose a Picture
								</Button>
								{profile.image && (
									<Button variant="ghost" size="sm" onPress={() => changeProfile({ ...profile, image: undefined })}>
										Remove
									</Button>
								)}
							</div>
							{pictureError && (
								<p role="alert" className="text-xs text-destructive">
									{pictureError}
								</p>
							)}
							<p className="text-[13px] text-muted-foreground">Shown to members of every workspace, shrunk to a small square.</p>
						</div>
					</SectionCard>

					<SectionCard
						id="network"
						title="Network"
						icon={<Globe className="size-5" />}
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
								<div className="flex items-center justify-between gap-2 border border-warning/30 bg-warning/10 p-2 text-xs text-warning">
									<span>Restart Nexsync to use the new proxy.</span>
									<Button size="sm" variant="outline" onPress={() => void relaunch()}>
										Restart Now
									</Button>
								</div>
							)}
						</div>
					</SectionCard>

					<SectionCard
						id="appearance"
						title="Appearance"
						icon={<Palette className="size-5" />}
					>
						<Row title="Theme" hint="System follows your OS">
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
						<div className="border-t pt-4">
							<ThemePicker />
						</div>
					</SectionCard>

					<SectionCard
						id="editor"
						title="Editor"
						icon={<Code2 className="size-5" />}
					>
						<Row title="Font size">
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
						<Row title="Tab width">
							<Segmented
								label="Tab width"
								value={editorPrefs.tabSize}
								onChange={(tabSize) => setEditorPrefs({ tabSize })}
								options={TAB_SIZES.map((size) => ({ value: size, label: String(size) }))}
							/>
						</Row>
						<Row title="Wrap long lines">
							<input
								type="checkbox"
								aria-label="Wrap long lines"
								checked={editorPrefs.wrap}
								onChange={(e) => setEditorPrefs({ wrap: e.target.checked })}
							/>
						</Row>
						<Row title="Vim keys" hint="Modal editing in the Editor and Markdown notes">
							<input
								type="checkbox"
								aria-label="Vim keys"
								checked={editorPrefs.vim}
								onChange={(e) => setEditorPrefs({ vim: e.target.checked })}
							/>
						</Row>
						<Row title="Relative line numbers" hint="Number lines by distance from the cursor">
							<input
								type="checkbox"
								aria-label="Relative line numbers"
								checked={editorPrefs.relativeNumbers}
								onChange={(e) => setEditorPrefs({ relativeNumbers: e.target.checked })}
							/>
						</Row>
						<Row title="Minimap">
							<input
								type="checkbox"
								aria-label="Minimap"
								checked={editorPrefs.minimap}
								onChange={(e) => setEditorPrefs({ minimap: e.target.checked })}
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
							Reset Editor Settings
						</Button>
					<div className="border-t pt-4">
							<CodeSchemePicker />
						</div>
					</SectionCard>

					<SectionCard
						id="storage"
						title="Storage"
						icon={<HardDrive className="size-5" />}
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
						icon={<DownloadCloud className="size-5" />}
					>
						<Row title="Version">
							<span className="text-sm font-semibold tabular-nums">{version ? `v${version}` : "…"}</span>
						</Row>
						<Row title="Update channel" hint="Beta gets new builds sooner">
							<Segmented
								label="Update channel"
								value={updater.channel}
								onChange={updater.setChannel}
								options={[
									{ value: "stable", label: "Stable" },
									{ value: "beta", label: "Beta" },
								]}
							/>
						</Row>
						<Row
							title="Updates"
							hint="Nothing is checked until you ask"
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
									Check for Updates
								</Button>
							)}
						</Row>
						{(updater.status === "available" || updater.status === "installing") && (
							<div className="space-y-1 border-l-2 border-primary/50 pl-3">
								<p className="text-sm font-semibold">What's new in v{updater.version}</p>
								<p className="max-h-40 overflow-y-auto whitespace-pre-wrap text-xs text-muted-foreground">
									{updater.notes?.trim() || "This release has no notes."}
								</p>
							</div>
						)}
						{updater.status === "up-to-date" && (
							<p role="status" className="flex items-center gap-2 text-xs text-success">
								<Check className="size-3.5" />
								You are on the latest version.
							</p>
						)}
						{updater.status === "error" && <p className="text-xs text-destructive">{updater.error}</p>}
					</SectionCard>

					<ErrorLogCard />
			</SettingsShell>

			{leaving && (
				<Dialog isOpen onOpenChange={(isOpen) => !isOpen && setLeaving(false)}>
					<div className="space-y-4">
						<DialogHeading icon={<AlertTriangle className="size-6" />} tone="warning" title="Leave Without Saving?" description={<>Your changes to the profile or storage folders will be lost.</>} />
						<DialogFooter>
							<Button variant="outline" onPress={() => setLeaving(false)}>
								Keep Editing
							</Button>
							<Button variant="destructive" onPress={close}>
								Discard and Leave
							</Button>
						</DialogFooter>
					</div>
				</Dialog>
			)}
		</>
	);
}
