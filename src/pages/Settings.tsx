import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { open } from "@tauri-apps/plugin-dialog";
import {
	ArrowLeft,
	Check,
	FolderPlus,
	HardDrive,
	Info,
	Plus,
	Save,
	ShieldCheck,
	Trash2,
} from "lucide-react";

import ThemeToggle from "@/components/elements/ThemeToggle";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";

import { useErrorLog } from "@/hooks/useErrorLog";
import { useThemeContext } from "@/store/ThemeContext";
import { loadConfig, saveConfig } from "@/lib/tauri";
import type { NexsyncConfig } from "@/types/workspace";

export default function Settings() {
	const navigate = useNavigate();
	const { isDark } = useThemeContext();
	const logError = useErrorLog();

	const [config, setConfig] = useState<NexsyncConfig>({
		allowed_workspace_roots: [],
	});
	const [loading, setLoading] = useState(true);
	const [newRootInput, setNewRootInput] = useState("");
	const [saving, setSaving] = useState(false);
	const [savedSuccess, setSavedSuccess] = useState(false);

	useEffect(() => {
		async function fetchConfig() {
			try {
				setLoading(true);
				const data = await loadConfig();
				setConfig(data);
			} catch (err) {
				console.error("Failed to load config:", err);
				logError(err, { source: "load_config" });
			} finally {
				setLoading(false);
			}
		}
		fetchConfig();
	}, [logError]);

	const handleAddRoot = (pathToAdd: string) => {
		const trimmed = pathToAdd.trim();
		if (!trimmed) return;
		if (config.allowed_workspace_roots.includes(trimmed)) return;

		setConfig((prev) => ({
			...prev,
			allowed_workspace_roots: [...prev.allowed_workspace_roots, trimmed],
		}));
		setNewRootInput("");
	};

	const handleBrowseFolder = async () => {
		try {
			const selected = await open({
				directory: true,
				multiple: false,
				title: "Select Allowed Workspace Directory",
			});
			if (selected && typeof selected === "string") {
				handleAddRoot(selected);
			}
		} catch (err) {
			console.error("Failed to open directory dialog:", err);
			logError(err, { source: "browse_root_dir" });
		}
	};

	const handleRemoveRoot = (indexToRemove: number) => {
		setConfig((prev) => ({
			...prev,
			allowed_workspace_roots: prev.allowed_workspace_roots.filter(
				(_, i) => i !== indexToRemove,
			),
		}));
	};

	const handleSaveConfig = async () => {
		try {
			setSaving(true);
			await saveConfig(config);
			setSavedSuccess(true);
			setTimeout(() => setSavedSuccess(false), 2500);
		} catch (err) {
			console.error("Failed to save config:", err);
			logError(err, { source: "save_config" });
		} finally {
			setSaving(false);
		}
	};

	return (
		<div className="min-h-screen bg-background p-8">
			<div className="mx-auto max-w-4xl space-y-6">
				{/* Top Navigation */}
				<div className="flex items-center gap-3">
					<Button
						variant="ghost"
						size="icon"
						onPress={() => navigate(-1)}
						aria-label="Back"
					>
						<ArrowLeft className="size-5" />
					</Button>
					<div>
						<h1 className="text-3xl font-bold tracking-tight">
							Application Settings
						</h1>
						<p className="text-sm text-muted-foreground">
							Global preferences, security boundaries, and environment
							configuration.
						</p>
					</div>
				</div>

				{/* Appearance */}
				<Card>
					<CardHeader>
						<CardTitle className="text-base">Appearance</CardTitle>
						<CardDescription>
							Customize your visual theme and interface experience.
						</CardDescription>
					</CardHeader>
					<CardContent className="flex items-center justify-between">
						<div>
							<p className="text-sm font-semibold">Theme Mode</p>
							<p className="text-xs text-muted-foreground">
								Current theme is {isDark ? "Dark (Zinc)" : "Light"}.
							</p>
						</div>
						<div className="flex items-center gap-2">
							<ThemeToggle />
						</div>
					</CardContent>
				</Card>

				{/* Security & Allowed Storage Roots */}
				<Card>
					<CardHeader>
						<CardTitle className="text-base flex items-center gap-2">
							<ShieldCheck className="size-4 text-emerald-400" />
							Allowed Workspace Roots
						</CardTitle>
						<CardDescription>
							Nexsync restricts file system access to these approved parent
							directories to protect against path traversal attacks.
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						{loading ? (
							<p className="text-xs text-muted-foreground animate-pulse">
								Loading allowed paths…
							</p>
						) : (
							<div className="space-y-2">
								{config.allowed_workspace_roots.map((root, index) => (
									<div
										key={root + index}
										className="flex items-center justify-between rounded-md border bg-muted/20 px-3 py-2 text-xs font-mono"
									>
										<div className="flex items-center gap-2 truncate">
											<HardDrive className="size-3.5 shrink-0 text-muted-foreground" />
											<span className="truncate">{root}</span>
										</div>
										<Button
											variant="ghost"
											size="icon-xs"
											onPress={() => handleRemoveRoot(index)}
											aria-label="Remove root"
										>
											<Trash2 className="size-3.5 text-muted-foreground hover:text-destructive" />
										</Button>
									</div>
								))}
							</div>
						)}

						{/* Add Root Control */}
						<div className="flex flex-col gap-2 sm:flex-row">
							<Input
								value={newRootInput}
								onChange={(e) => setNewRootInput(e.target.value)}
								placeholder="Enter directory path (e.g. C:\Users\User\Documents)"
								className="text-xs font-mono"
								onKeyDown={(e) => {
									if (e.key === "Enter") {
										e.preventDefault();
										handleAddRoot(newRootInput);
									}
								}}
							/>
							<div className="flex gap-2">
								<Button
									variant="outline"
									size="sm"
									onPress={() => handleAddRoot(newRootInput)}
									isDisabled={!newRootInput.trim()}
								>
									<Plus className="size-4 mr-1" />
									Add
								</Button>
								<Button
									variant="outline"
									size="sm"
									onPress={handleBrowseFolder}
								>
									<FolderPlus className="size-4 mr-1" />
									Browse
								</Button>
							</div>
						</div>

						<div className="pt-2 flex items-center justify-between">
							<Button
								onPress={handleSaveConfig}
								isDisabled={saving}
								className="gap-2"
							>
								<Save className="size-4" />
								{saving ? "Saving…" : "Save Allowed Roots"}
							</Button>
							{savedSuccess && (
								<span className="flex items-center gap-1.5 text-xs text-emerald-400">
									<Check className="size-4" />
									Config saved successfully
								</span>
							)}
						</div>
					</CardContent>
				</Card>

				{/* About Nexsync */}
				<Card>
					<CardHeader>
						<CardTitle className="text-base flex items-center gap-2">
							<Info className="size-4 text-primary" />
							About Nexsync
						</CardTitle>
					</CardHeader>
					<CardContent className="space-y-2 text-xs text-muted-foreground">
						<p>
							<strong className="text-foreground">Nexsync v0.1.0</strong> —
							Local-first peer-to-peer collaborative workspaces.
						</p>
						<p>
							Engineered with Rust, Tauri, React 19, SQLite, libsodium, and Yjs
							CRDT.
						</p>
					</CardContent>
				</Card>
			</div>
		</div>
	);
}
