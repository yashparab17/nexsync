import { useEffect, useState, useMemo, useCallback } from "react";
import {
	Copy,
	Check,
	FileText,
	Film,
	Headphones,
	Image as ImageIcon,
	LayoutGrid,
	List,
	Loader2,
	Pencil,
	Search,
	Sparkles,
	Trash2,
	Upload,
	UploadCloud,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
	Dialog,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import AssetPreviewModal from "@/components/dialogs/workspace/AssetPreviewModal";
import AssetUploadDialog from "@/components/dialogs/workspace/AssetUploadDialog";
import { useErrorLog } from "@/hooks/useErrorLog";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import { formatBytes } from "@/lib/utils";
import {
	deleteWorkspaceItem,
	listWorkspaceFiles,
	readWorkspaceBinaryFile,
	renameWorkspaceItem,
	writeWorkspaceBinaryFile,
} from "@/lib/tauri";
import { useWorkspace } from "@/store/workspace/WorkspaceContext";
import { useP2P } from "@/store/p2p/P2PContext";
import type {
	AssetCategory,
	AssetItem,
	WorkspaceFile,
} from "@/types/workspace";

// Determine category from filename
function getAssetCategory(fileName: string): AssetCategory {
	const ext = fileName.split(".").pop()?.toLowerCase() || "";
	if (["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico"].includes(ext)) {
		return "image";
	}
	if (["mp4", "webm", "mov", "mkv", "avi"].includes(ext)) {
		return "video";
	}
	if (["mp3", "wav", "ogg", "m4a", "aac", "flac"].includes(ext)) {
		return "audio";
	}
	if (["pdf", "doc", "docx", "txt", "md", "json", "csv", "xlsx"].includes(ext)) {
		return "document";
	}
	return "other";
}

export default function WorkspaceAssets() {
	const { workspace, refreshStats, addActivityEvent } = useWorkspace();
	const { placeholders, downloadFileOnDemand, lastSyncedFile } = useP2P();
	const logError = useErrorLog();

	// State
	const [assets, setAssets] = useState<AssetItem[]>([]);
	const [loading, setLoading] = useState(true);
	const [searchQuery, setSearchQuery] = useState("");
	const [selectedCategory, setSelectedCategory] =
		useState<AssetCategory>("all");
	const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

	// Thumbnails cache for images (base64 URLs)
	const [thumbnails, setThumbnails] = useState<Record<string, string>>({});

	// Dialog states
	const [isUploadOpen, setIsUploadOpen] = useState(false);
	const [previewAsset, setPreviewAsset] = useState<AssetItem | null>(null);
	const [assetToDelete, setAssetToDelete] = useState<AssetItem | null>(null);
	const [assetToRename, setAssetToRename] = useState<AssetItem | null>(null);
	const [newName, setNewName] = useState("");
	const [isRenaming, setIsRenaming] = useState(false);
	const [isDeleting, setIsDeleting] = useState(false);

	// Drag and drop overlay
	const [isDraggingOver, setIsDraggingOver] = useState(false);
	const { copiedKey, copy } = useCopyToClipboard(1800);

	// Fetch assets from workspace/assets directory and merge remote placeholders (>10MB)
	const loadAssets = useCallback(async () => {
		if (!workspace?.path) return;
		setLoading(true);

		try {
			const files: WorkspaceFile[] = await listWorkspaceFiles(
				workspace.path,
				"assets",
			);
			const assetItems: AssetItem[] = files
				.filter((f) => !f.is_dir)
				.map((f) => ({
					...f,
					category: getAssetCategory(f.name),
					syncStatus: "synced",
				}));

			// Merge in any remote placeholders (>10MB) not yet downloaded
			for (const p of placeholders) {
				const cleanPath = p.relPath.startsWith("/") ? p.relPath.slice(1) : p.relPath;
				if (!assetItems.some((a) => a.path.includes(p.name))) {
					assetItems.push({
						name: p.name,
						path: `/${cleanPath}`,
						is_dir: false,
						size: p.size,
						modified_at: new Date().toISOString(),
						category: getAssetCategory(p.name),
						syncStatus: "remote_placeholder",
					});
				}
			}

			setAssets(assetItems);

			// Preload thumbnails for image assets
			const imageFiles = assetItems.filter((a) => a.category === "image" && a.syncStatus === "synced");
			for (const img of imageFiles) {
				const cleanPath =
					img.path.startsWith("/") ? img.path.slice(1) : img.path;
				readWorkspaceBinaryFile(workspace.path, cleanPath)
					.then((b64) => {
						const ext = img.name.split(".").pop()?.toLowerCase() || "png";
						const mime = ext === "svg" ? "image/svg+xml" : `image/${ext}`;
						setThumbnails((prev) => ({
							...prev,
							[img.name]: `data:${mime};base64,${b64}`,
						}));
					})
					.catch(() => console.debug("Thumbnail load skipped for", img.name));
			}
		} catch (err) {
			console.error("Failed to load assets:", err);
			logError(err, { source: "assets_load", workspace: workspace.path });
		} finally {
			setLoading(false);
		}
	}, [workspace?.path, placeholders, logError]);

	useEffect(() => {
		loadAssets();
	}, [loadAssets]);

	// Reload when a collaborator's changes arrive
	useEffect(() => {
		if (lastSyncedFile) void loadAssets();
	}, [lastSyncedFile]);

	// Filtered assets
	const filteredAssets = useMemo(() => {
		return assets.filter((asset) => {
			const matchesCategory =
				selectedCategory === "all" || asset.category === selectedCategory;
			const matchesSearch = asset.name
				.toLowerCase()
				.includes(searchQuery.toLowerCase());
			return matchesCategory && matchesSearch;
		});
	}, [assets, selectedCategory, searchQuery]);

	// Category counts
	const categoryCounts = useMemo(() => {
		return {
			all: assets.length,
			image: assets.filter((a) => a.category === "image").length,
			video: assets.filter((a) => a.category === "video").length,
			audio: assets.filter((a) => a.category === "audio").length,
			document: assets.filter((a) => a.category === "document").length,
			other: assets.filter((a) => a.category === "other").length,
		};
	}, [assets]);

	// Copy markdown snippet
	const handleCopyMarkdown = (e: React.MouseEvent, asset: AssetItem) => {
		e.stopPropagation();
		const cleanPath =
			asset.path.startsWith("/") ? asset.path.slice(1) : asset.path;
		const snippet =
			asset.category === "image" ?
				`![${asset.name}](${cleanPath})`
			:	`[${asset.name}](${cleanPath})`;

		copy(snippet, asset.name);
	};

	// Rename item
	const handleRenameConfirm = async () => {
		if (!assetToRename || !workspace?.path || !newName.trim()) return;

		setIsRenaming(true);
		try {
			const cleanOldRelPath =
				assetToRename.path.startsWith("/") ?
					assetToRename.path.slice(1)
				:	assetToRename.path;

			// Ensure extension is retained if omitted
			const oldExt = assetToRename.name.includes(".") ?
				`.${assetToRename.name.split(".").pop()}`
			:	"";
			const targetName =
				newName.includes(".") ? newName.trim() : `${newName.trim()}${oldExt}`;

			await renameWorkspaceItem(
				workspace.path,
				cleanOldRelPath,
				targetName,
			);
			addActivityEvent(
				"renamed_asset",
				`Renamed asset ${assetToRename.name} to ${targetName}`,
				`assets/${targetName}`,
				"asset",
			);
			setAssetToRename(null);
			setNewName("");
			await loadAssets();
			await refreshStats();
		} catch (err) {
			console.error("Failed to rename asset:", err);
			logError(err, { source: "asset_rename" });
		} finally {
			setIsRenaming(false);
		}
	};

	// Delete item
	const handleDeleteConfirm = async () => {
		if (!assetToDelete || !workspace?.path) return;

		setIsDeleting(true);
		try {
			const cleanRelPath =
				assetToDelete.path.startsWith("/") ?
					assetToDelete.path.slice(1)
				:	assetToDelete.path;

			await deleteWorkspaceItem(workspace.path, cleanRelPath);
			addActivityEvent(
				"deleted_asset",
				`Deleted asset ${assetToDelete.name}`,
				cleanRelPath,
				"asset",
			);
			setAssetToDelete(null);
			await loadAssets();
			await refreshStats();
		} catch (err) {
			console.error("Failed to delete asset:", err);
			logError(err, { source: "asset_delete" });
		} finally {
			setIsDeleting(false);
		}
	};

	// Download a remote placeholder on demand from a connected peer
	const handleLazyDownload = async (asset: AssetItem) => {
		try {
			await downloadFileOnDemand(asset.path);
			await loadAssets();
			if (previewAsset?.name === asset.name) {
				setPreviewAsset((prev) =>
					prev ? { ...prev, syncStatus: "synced" } : null,
				);
			}
		} catch (err) {
			console.error("Failed to download lazy file on demand:", err);
		}
	};

	// Add remote simulated peer placeholder for testing lazy loading
	const handleAddPlaceholderDemo = () => {
		const placeholder: AssetItem = {
			name: `peer_mock_diagram_${Date.now().toString().slice(-4)}.png`,
			path: `/assets/peer_mock_diagram_${Date.now().toString().slice(-4)}.png`,
			is_dir: false,
			size: 2450000,
			modified_at: new Date().toISOString(),
			category: "image",
			syncStatus: "remote_placeholder",
		};
		setAssets((prev) => [placeholder, ...prev]);
	};

	// Drop handler for page-level drop
	const handlePageDrop = async (e: React.DragEvent) => {
		e.preventDefault();
		setIsDraggingOver(false);
		if (!workspace?.path || !e.dataTransfer.files || e.dataTransfer.files.length === 0)
			return;

		for (const file of Array.from(e.dataTransfer.files)) {
			try {
				const base64Data = await new Promise<string>((resolve, reject) => {
					const reader = new FileReader();
					reader.onload = () => {
						const result = reader.result as string;
						resolve(result.includes(",") ? result.split(",")[1] : result);
					};
					reader.onerror = reject;
					reader.readAsDataURL(file);
				});
				const sanitizedName = file.name.replace(/[^\w.-]/g, "_");
				await writeWorkspaceBinaryFile(
					workspace.path,
					`assets/${sanitizedName}`,
					base64Data,
				);
			} catch (err) {
				console.error("Drop upload failed for file:", file.name, err);
			}
		}
		await loadAssets();
		await refreshStats();
	};

	return (
		<div
			onDragOver={(e) => {
				e.preventDefault();
				setIsDraggingOver(true);
			}}
			onDragLeave={() => setIsDraggingOver(false)}
			onDrop={handlePageDrop}
			className="space-y-6 relative min-h-[calc(100vh-8rem)]"
		>
			{/* Drag & Drop Window Overlay */}
			{isDraggingOver && (
				<div className="absolute inset-0 z-50 bg-primary/20 backdrop-blur-sm border-2 border-dashed border-primary rounded-xl flex flex-col items-center justify-center pointer-events-none animate-in fade-in duration-150">
					<UploadCloud className="size-16 text-primary animate-bounce mb-3" />
					<h3 className="text-xl font-bold text-foreground">
						Drop files to upload directly to assets/
					</h3>
					<p className="text-sm text-muted-foreground mt-1">
						Images, audio, video, and documents will be saved in your workspace
					</p>
				</div>
			)}

			{/* Page Header */}
			<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
				<div>
					<h1 className="text-2xl font-bold tracking-tight">Workspace Assets</h1>
					<p className="mt-1 text-sm text-muted-foreground">
						Store and manage images, media, and binary files in your local{" "}
						<code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono text-foreground">
							assets/
						</code>{" "}
						folder.
					</p>
				</div>

				<div className="flex items-center gap-2">
					<Button
						variant="outline"
						size="sm"
						onPress={handleAddPlaceholderDemo}
						className="gap-1.5 text-xs text-muted-foreground hover:text-foreground"
					>
						<Sparkles className="size-3.5 text-amber-500" />
						Simulate Peer Asset
					</Button>
					<Button
						onPress={() => setIsUploadOpen(true)}
						className="gap-2 text-xs"
					>
						<Upload className="size-4" />
						Upload Asset
					</Button>
				</div>
			</div>

			{/* Toolbar: Search, Categories, View Toggle */}
			<div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-2 border-b border-border/60">
				{/* Category Filter Tabs */}
				<div className="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0">
					{[
						{ key: "all", label: "All", count: categoryCounts.all },
						{ key: "image", label: "Images", count: categoryCounts.image },
						{ key: "video", label: "Video", count: categoryCounts.video },
						{ key: "audio", label: "Audio", count: categoryCounts.audio },
						{
							key: "document",
							label: "Documents",
							count: categoryCounts.document,
						},
						{ key: "other", label: "Other", count: categoryCounts.other },
					].map((tab) => (
						<button
							key={tab.key}
							onClick={() => setSelectedCategory(tab.key as AssetCategory)}
							className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors flex items-center gap-1.5 cursor-pointer ${
								selectedCategory === tab.key ?
									"bg-primary text-primary-foreground font-semibold shadow-sm"
								:	"bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground"
							}`}
						>
							{tab.label}
							<span
								className={`text-[10px] px-1.5 py-0.2 rounded-full ${
									selectedCategory === tab.key ?
										"bg-primary-foreground/20 text-primary-foreground"
									:	"bg-background/80 text-muted-foreground"
								}`}
							>
								{tab.count}
							</span>
						</button>
					))}
				</div>

				{/* Search & View Switcher */}
				<div className="flex items-center gap-3">
					<div className="relative w-full md:w-64">
						<Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
						<Input
							placeholder="Search assets…"
							value={searchQuery}
							onChange={(e) => setSearchQuery(e.target.value)}
							className="pl-8 h-8 text-xs bg-muted/40"
						/>
					</div>

					<div className="flex items-center border border-border rounded-lg p-0.5 bg-muted/30">
						<button
							onClick={() => setViewMode("grid")}
							title="Grid View"
							className={`p-1.5 rounded-md transition-all cursor-pointer ${
								viewMode === "grid" ?
									"bg-background text-foreground shadow-sm"
								:	"text-muted-foreground hover:text-foreground"
							}`}
						>
							<LayoutGrid className="size-4" />
						</button>
						<button
							onClick={() => setViewMode("list")}
							title="List View"
							className={`p-1.5 rounded-md transition-all cursor-pointer ${
								viewMode === "list" ?
									"bg-background text-foreground shadow-sm"
								:	"text-muted-foreground hover:text-foreground"
							}`}
						>
							<List className="size-4" />
						</button>
					</div>
				</div>
			</div>

			{/* Asset Content List / Grid */}
			{loading ?
				<div className="flex flex-col items-center justify-center py-24 text-muted-foreground gap-3">
					<Loader2 className="size-8 animate-spin text-primary" />
					<p className="text-xs font-mono">Loading workspace assets…</p>
				</div>
			: filteredAssets.length === 0 ?
				<div className="flex flex-col items-center justify-center py-20 border border-dashed border-border rounded-xl text-center p-8 bg-card/20">
					<div className="p-4 rounded-full bg-muted/60 text-muted-foreground mb-3">
						<ImageIcon className="size-8" />
					</div>
					<h3 className="font-semibold text-base text-foreground">
						{searchQuery ?
							"No matching assets found"
						:	"No assets in this category"}
					</h3>
					<p className="text-xs text-muted-foreground max-w-sm mt-1">
						{searchQuery ?
							"Try refining your search query or switching categories."
						:	"Upload images, media, or documents to link them directly into your notes and code files."}
					</p>
					{!searchQuery && (
						<Button
							size="sm"
							onPress={() => setIsUploadOpen(true)}
							className="mt-4 gap-2 text-xs"
						>
							<UploadCloud className="size-4" />
							Upload First Asset
						</Button>
					)}
				</div>
			: viewMode === "grid" ?
				/* Grid View */
				<div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
					{filteredAssets.map((asset) => {
						const isImage = asset.category === "image";
						const isVideo = asset.category === "video";
						const isAudio = asset.category === "audio";
						const thumbnail = thumbnails[asset.name];
						const isRemote = asset.syncStatus === "remote_placeholder";

						return (
							<Card
								key={asset.name}
								onClick={() => setPreviewAsset(asset)}
								className="group relative overflow-hidden cursor-pointer border-border hover:border-primary/60 hover:shadow-lg transition-all duration-200 bg-card/60 flex flex-col"
							>
								{/* Thumbnail Header Area */}
								<div className="relative h-36 bg-black/40 flex items-center justify-center overflow-hidden border-b border-border/40">
									{isRemote ?
										<div className="flex flex-col items-center gap-2 text-amber-500/80 p-4 text-center">
											<Sparkles className="size-7" />
											<span className="text-[11px] font-medium uppercase tracking-wider">
												Peer Placeholder
											</span>
										</div>
									: isImage && thumbnail ?
										<img
											src={thumbnail}
											alt={asset.name}
											className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
										/>
									: isImage ?
										<ImageIcon className="size-10 text-muted-foreground group-hover:text-primary transition-colors" />
									: isVideo ?
										<div className="flex flex-col items-center gap-1.5 text-muted-foreground group-hover:text-primary transition-colors">
											<Film className="size-10" />
											<span className="text-[10px] font-mono">VIDEO</span>
										</div>
									: isAudio ?
										<div className="flex flex-col items-center gap-1.5 text-muted-foreground group-hover:text-primary transition-colors">
											<Headphones className="size-10" />
											<span className="text-[10px] font-mono">AUDIO</span>
										</div>
									:	<FileText className="size-10 text-muted-foreground group-hover:text-primary transition-colors" />}

									{/* Status Badge */}
									<div className="absolute top-2 left-2">
										{isRemote ?
											<span className="bg-amber-500/90 text-black text-[10px] font-bold px-2 py-0.5 rounded-full shadow-sm">
												Remote
											</span>
										:	<span className="bg-black/60 backdrop-blur text-white text-[10px] font-mono px-2 py-0.5 rounded-full border border-white/10">
												{asset.name.split(".").pop()?.toUpperCase()}
											</span>
										}
									</div>

									{/* Quick Action Overlay on Hover */}
									<div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
										<button
											onClick={(e) => handleCopyMarkdown(e, asset)}
											title="Copy Markdown Embed Link"
											className="p-1.5 rounded-md bg-background/80 hover:bg-background text-foreground border border-border/60 shadow-sm cursor-pointer transition-all"
										>
											{copiedKey === asset.name ?
												<Check className="size-3.5 text-emerald-400" />
											:	<Copy className="size-3.5" />}
										</button>
										<button
											onClick={(e) => {
												e.stopPropagation();
												setAssetToRename(asset);
												setNewName(asset.name);
											}}
											title="Rename"
											className="p-1.5 rounded-md bg-background/80 hover:bg-background text-foreground border border-border/60 shadow-sm cursor-pointer transition-all"
										>
											<Pencil className="size-3.5" />
										</button>
										<button
											onClick={(e) => {
												e.stopPropagation();
												setAssetToDelete(asset);
											}}
											title="Delete"
											className="p-1.5 rounded-md bg-background/80 hover:bg-destructive text-foreground hover:text-destructive-foreground border border-border/60 shadow-sm cursor-pointer transition-all"
										>
											<Trash2 className="size-3.5" />
										</button>
									</div>
								</div>

								{/* Info Area */}
								<CardContent className="p-3 flex-1 flex flex-col justify-between">
									<div>
										<p
											className="font-medium text-xs text-foreground truncate"
											title={asset.name}
										>
											{asset.name}
										</p>
										<p className="text-[11px] text-muted-foreground mt-0.5">
											{formatBytes(asset.size)}
										</p>
									</div>

									<div className="flex items-center justify-between pt-2 mt-2 border-t border-border/40 text-[10px] text-muted-foreground">
										<span>
											{new Date(asset.modified_at).toLocaleDateString(
												undefined,
												{
													month: "short",
													day: "numeric",
												},
											)}
										</span>
										<span className="font-mono uppercase text-[9px] bg-muted px-1.5 py-0.5 rounded text-foreground/80">
											{asset.category}
										</span>
									</div>
								</CardContent>
							</Card>
						);
					})}
				</div>
			:	/* List View */
				<div className="border border-border rounded-xl overflow-hidden bg-card/60">
					<table className="w-full text-left text-xs">
						<thead className="bg-muted/50 border-b border-border text-muted-foreground uppercase text-[10px] tracking-wider">
							<tr>
								<th className="py-3 px-4">Name</th>
								<th className="py-3 px-4">Category</th>
								<th className="py-3 px-4">Size</th>
								<th className="py-3 px-4">Status</th>
								<th className="py-3 px-4">Modified</th>
								<th className="py-3 px-4 text-right">Actions</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-border/60">
							{filteredAssets.map((asset) => {
								const isRemote =
									asset.syncStatus === "remote_placeholder";

								return (
									<tr
										key={asset.name}
										onClick={() => setPreviewAsset(asset)}
										className="hover:bg-muted/40 cursor-pointer transition-colors group"
									>
										<td className="py-3 px-4 font-medium text-foreground flex items-center gap-3">
											<div className="p-1.5 rounded bg-muted text-muted-foreground group-hover:text-primary">
												{asset.category === "image" ?
													<ImageIcon className="size-4" />
												: asset.category === "video" ?
													<Film className="size-4" />
												: asset.category === "audio" ?
													<Headphones className="size-4" />
												:	<FileText className="size-4" />}
											</div>
											<span className="truncate max-w-xs">{asset.name}</span>
										</td>
										<td className="py-3 px-4">
											<span className="font-mono text-[11px] bg-muted px-2 py-0.5 rounded text-foreground/80 capitalize">
												{asset.category}
											</span>
										</td>
										<td className="py-3 px-4 font-mono text-muted-foreground">
											{formatBytes(asset.size)}
										</td>
										<td className="py-3 px-4">
											{isRemote ?
												<span className="text-amber-500 font-medium flex items-center gap-1">
													○ Peer Placeholder
												</span>
											:	<span className="text-emerald-500 font-medium flex items-center gap-1">
													● Local
												</span>
											}
										</td>
										<td className="py-3 px-4 text-muted-foreground">
											{new Date(asset.modified_at).toLocaleDateString(
												undefined,
												{
													month: "short",
													day: "numeric",
													year: "numeric",
												},
											)}
										</td>
										<td className="py-3 px-4 text-right">
											<div className="flex items-center justify-end gap-1.5">
												<button
													onClick={(e) => handleCopyMarkdown(e, asset)}
													className="h-7 px-2 text-[11px] rounded-md bg-muted/60 hover:bg-muted text-foreground flex items-center gap-1 cursor-pointer transition-all border border-border/40"
												>
													{copiedKey === asset.name ?
														<Check className="size-3 text-emerald-400" />
													:	<Copy className="size-3" />}
													{copiedKey === asset.name ? "Copied" : "Copy"}
												</button>
												<button
													onClick={(e) => {
														e.stopPropagation();
														setAssetToRename(asset);
														setNewName(asset.name);
													}}
													className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground cursor-pointer transition-all"
												>
													<Pencil className="size-3.5" />
												</button>
												<button
													onClick={(e) => {
														e.stopPropagation();
														setAssetToDelete(asset);
													}}
													className="p-1.5 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive cursor-pointer transition-all"
												>
													<Trash2 className="size-3.5" />
												</button>
											</div>
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</div>
			}

			{/* Asset Upload Modal */}
			{isUploadOpen && workspace?.path && (
				<AssetUploadDialog
					workspacePath={workspace.path}
					isOpen={isUploadOpen}
					onClose={() => setIsUploadOpen(false)}
					onUploaded={async () => {
						await loadAssets();
						await refreshStats();
						addActivityEvent(
							"uploaded_asset",
							"Uploaded new assets to workspace",
							"assets",
							"asset",
						);
					}}
				/>
			)}

			{/* Asset Preview Modal */}
			{previewAsset && workspace?.path && (
				<AssetPreviewModal
					asset={previewAsset}
					workspacePath={workspace.path}
					isOpen={!!previewAsset}
					onClose={() => setPreviewAsset(null)}
					onDownloadLazy={handleLazyDownload}
				/>
			)}

			{/* Rename Dialog */}
			{assetToRename && (
				<Dialog
					isOpen={!!assetToRename}
					onOpenChange={(open) => !open && setAssetToRename(null)}
					className="max-w-sm p-5 bg-card border-border"
				>
					<div className="space-y-4">
						<DialogHeader>
							<DialogTitle>Rename Asset</DialogTitle>
							<DialogDescription>
								Provide a new name for{" "}
								<span className="font-semibold text-foreground">
									{assetToRename.name}
								</span>
							</DialogDescription>
						</DialogHeader>

						<div className="space-y-3 my-2">
							<Label htmlFor="rename-input">New File Name</Label>
							<Input
								id="rename-input"
								value={newName}
								onChange={(e) => setNewName(e.target.value)}
								autoFocus
							/>
						</div>

						<DialogFooter className="gap-2">
							<Button
								variant="outline"
								onPress={() => setAssetToRename(null)}
								isDisabled={isRenaming}
							>
								Cancel
							</Button>
							<Button
								onPress={handleRenameConfirm}
								isDisabled={!newName.trim() || isRenaming}
							>
								{isRenaming ? "Renaming…" : "Rename"}
							</Button>
						</DialogFooter>
					</div>
				</Dialog>
			)}

			{/* Delete Confirmation Dialog */}
			{assetToDelete && (
				<Dialog
					isOpen={!!assetToDelete}
					onOpenChange={(open) => !open && setAssetToDelete(null)}
					className="max-w-sm p-5 bg-card border-border"
				>
					<div className="space-y-4">
						<DialogHeader>
							<DialogTitle>Delete Asset</DialogTitle>
							<DialogDescription>
								Are you sure you want to permanently delete{" "}
								<span className="font-semibold text-foreground">
									{assetToDelete.name}
								</span>{" "}
								from the disk? This action cannot be undone.
							</DialogDescription>
						</DialogHeader>

						<DialogFooter className="gap-2">
							<Button
								variant="outline"
								onPress={() => setAssetToDelete(null)}
								isDisabled={isDeleting}
							>
								Cancel
							</Button>
							<Button
								variant="destructive"
								onPress={handleDeleteConfirm}
								isDisabled={isDeleting}
							>
								{isDeleting ? "Deleting…" : "Delete"}
							</Button>
						</DialogFooter>
					</div>
				</Dialog>
			)}
		</div>
	);
}
