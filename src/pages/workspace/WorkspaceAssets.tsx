import { useEffect, useState, useMemo, useCallback } from "react";
import { Copy, Check, Search, Trash2, FileText, Film, Headphones, Image as ImageIcon, LayoutGrid, List, History, Pencil, Sparkles, Upload, UploadCloud } from "@/components/animate-icons";
import { fileToBase64, useUploadScale } from "@/lib/assets/uploadScale";
import { cn } from "@/lib/utils";

import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter, DialogHeading } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import AssetPreviewModal from "@/components/dialogs/workspace/AssetPreviewModal";
import FileHistoryDialog from "@/components/dialogs/workspace/FileHistoryDialog";
import AssetUploadDialog from "@/components/dialogs/workspace/AssetUploadDialog";
import { useErrorLog } from "@/hooks/useErrorLog";
import { useOpenParam } from "@/hooks/useOpenParam";
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
import { useP2P, useIsViewer } from "@/store/p2p/P2PContext";
import type {
	AssetCategory,
	AssetItem,
	WorkspaceFile,
} from "@/types/workspace";
import Loading from "@/components/Loading";

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
	const isViewer = useIsViewer();
	const logError = useErrorLog();

	// State
	const [assets, setAssets] = useState<AssetItem[]>([]);
	const [loading, setLoading] = useState(true);
	const [searchQuery, setSearchQuery] = useState("");
	const [selectedCategory, setSelectedCategory] =
		useState<AssetCategory>("all");
	const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
	// How wide the tiles are, and the size pictures are saved at when dropped on the page
	const [tile, setTile] = useState<"s" | "m" | "l">("m");
	const [uploadScale, setUploadScale] = useUploadScale();
	// A picture's own size, once it has loaded, for the hover details
	const [dims, setDims] = useState<Record<string, string>>({});

	// Thumbnails cache for images (base64 URLs)
	const [thumbnails, setThumbnails] = useState<Record<string, string>>({});

	// Dialog states
	const [isUploadOpen, setIsUploadOpen] = useState(false);
	const [previewAsset, setPreviewAsset] = useState<AssetItem | null>(null);

	// Deep link from workspace search
	useOpenParam((path) => {
		const asset = assets.find((a) => a.path === path);
		if (asset) setPreviewAsset(asset);
	}, assets.length > 0);
	const [assetToDelete, setAssetToDelete] = useState<AssetItem | null>(null);
	const [assetToRename, setAssetToRename] = useState<AssetItem | null>(null);
	const [historyAsset, setHistoryAsset] = useState<AssetItem | null>(null);
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
		if (isViewer || !assetToRename || !workspace?.path || !newName.trim()) return;

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
		if (isViewer || !assetToDelete || !workspace?.path) return;

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

	// Drop handler for page-level drop
	const handlePageDrop = async (e: React.DragEvent) => {
		e.preventDefault();
		setIsDraggingOver(false);
		if (
			isViewer ||
			!workspace?.path ||
			!e.dataTransfer.files ||
			e.dataTransfer.files.length === 0
		)
			return;

		for (const file of Array.from(e.dataTransfer.files)) {
			try {
				const base64Data = await fileToBase64(file, uploadScale);
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

	const kindIcon = (category: AssetItem["category"], className: string) =>
		category === "video" ? <Film className={className} /> : category === "audio" ? <Headphones className={className} /> : category === "image" ? <ImageIcon className={className} /> : <FileText className={className} />;

	// Tiles that are not pictures get a shape that depends on what they are, so the mosaic has rhythm
	const shapeOf = (asset: AssetItem): string =>
		asset.category === "video" ? "aspect-video" : asset.category === "audio" ? "aspect-[4/3]" : asset.category === "document" ? "aspect-[3/4]" : "aspect-square";

	const tabs = [
		{ key: "all", label: "All", count: categoryCounts.all },
		{ key: "image", label: "Photos", count: categoryCounts.image },
		{ key: "video", label: "Video", count: categoryCounts.video },
		{ key: "audio", label: "Audio", count: categoryCounts.audio },
		{ key: "document", label: "Documents", count: categoryCounts.document },
		{ key: "other", label: "Other", count: categoryCounts.other },
	];

	const actionButton = "flex size-8 cursor-pointer items-center justify-center bg-background/90 text-foreground outline-none backdrop-blur hover:bg-background focus-visible:ring-2 focus-visible:ring-ring";

	return (
		<div
			onDragOver={(e) => {
				e.preventDefault();
				setIsDraggingOver(true);
			}}
			onDragLeave={(e) => e.currentTarget.contains(e.relatedTarget as Node) || setIsDraggingOver(false)}
			onDrop={handlePageDrop}
			className="relative flex h-full min-h-0 flex-col bg-background"
		>
			{/* Drag & Drop Window Overlay */}
			{isDraggingOver && (
				<div className="pointer-events-none absolute inset-0 z-50 flex flex-col items-center justify-center border-2 border-dashed border-primary bg-primary/15 backdrop-blur-sm animate-in fade-in duration-150 motion-reduce:animate-none">
					<UploadCloud className="mb-3 size-16 text-primary" />
					<h3 className="text-xl font-bold text-foreground">Drop to add to assets</h3>
					<p className="mt-1 text-sm text-muted-foreground">{uploadScale === 0.5 ? "Pictures will be saved at half size." : "Pictures keep their original size."}</p>
				</div>
			)}

			{/* Toolbar */}
			<div className="flex min-h-12 shrink-0 flex-wrap items-center gap-2 border-b bg-card/40 px-3 py-1.5">
				<div role="tablist" aria-label="Kind of asset" className="flex items-center gap-1 overflow-x-auto">
					{tabs.map((tab) => (
						<button
							key={tab.key}
							type="button"
							role="tab"
							aria-selected={selectedCategory === tab.key}
							onClick={() => setSelectedCategory(tab.key as AssetCategory)}
							className={cn(
								"flex cursor-pointer items-center gap-1.5 px-2.5 py-1.5 text-sm outline-none transition-colors focus-visible:bg-muted",
								selectedCategory === tab.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
							)}
						>
							{tab.label}
							<span className="font-mono text-xs tabular-nums opacity-70">{tab.count}</span>
						</button>
					))}
				</div>
				<span className="flex-1" />
				<div className="relative w-44">
					<Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
					<Input aria-label="Search assets" placeholder="Search assets" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="h-8 border bg-background pl-8 text-sm" />
				</div>
				{viewMode === "grid" && (
					<div className="flex items-stretch border" role="group" aria-label="Tile size">
						{(["s", "m", "l"] as const).map((size) => (
							<button
								key={size}
								type="button"
								aria-pressed={tile === size}
								aria-label={size === "s" ? "Small tiles" : size === "m" ? "Medium tiles" : "Large tiles"}
								onClick={() => setTile(size)}
								className={cn("flex h-8 w-8 items-center justify-center font-mono text-xs outline-none focus-visible:bg-muted", tile === size ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground")}
							>
								{size.toUpperCase()}
							</button>
						))}
					</div>
				)}
				<div className="flex items-stretch border" role="group" aria-label="View">
					{(["grid", "list"] as const).map((mode) => (
						<button
							key={mode}
							type="button"
							aria-pressed={viewMode === mode}
							aria-label={mode === "grid" ? "Mosaic view" : "List view"}
							onClick={() => setViewMode(mode)}
							className={cn("flex size-8 cursor-pointer items-center justify-center outline-none focus-visible:bg-muted", viewMode === mode ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground")}
						>
							{mode === "grid" ? <LayoutGrid className="size-4" /> : <List className="size-4" />}
						</button>
					))}
				</div>
				{!isViewer && (
					<>
						<span className="hidden font-mono text-xs text-muted-foreground 2xl:inline">Save as</span>
						<div className="flex items-stretch border" role="radiogroup" aria-label="Size pictures are saved at">
							{([1, 0.5] as const).map((value) => (
								<button
									key={value}
									type="button"
									role="radio"
									aria-checked={uploadScale === value}
									title={value === 1 ? "Save pictures at their original size" : "Save pictures at half width and height"}
									onClick={() => setUploadScale(value)}
									className={cn("h-8 px-2.5 text-xs outline-none focus-visible:bg-muted", uploadScale === value ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground")}
								>
									{value === 1 ? "Original" : "50%"}
								</button>
							))}
						</div>
						<Button size="sm" onPress={() => setIsUploadOpen(true)}>
							<Upload data-icon="inline-start" className="size-4" />
							Upload
						</Button>
					</>
				)}
			</div>

			{/* Assets */}
			<div className="min-h-0 flex-1 overflow-auto">
				{loading ? (
					<Loading className="py-24" />
				) : filteredAssets.length === 0 ? (
					<div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
						<ImageIcon className="size-10 text-muted-foreground" />
						<h3 className="text-base font-semibold">{searchQuery ? "No matching assets" : "Nothing here yet"}</h3>
						<p className="max-w-sm text-sm text-muted-foreground">
							{searchQuery ? "Try a different search, or another kind of asset." : "Drop pictures, audio, video or documents anywhere on this page, or press Upload."}
						</p>
						{!searchQuery && !isViewer && (
							<Button size="sm" onPress={() => setIsUploadOpen(true)} className="mt-2">
								<UploadCloud data-icon="inline-start" className="size-4" />
								Upload assets
							</Button>
						)}
					</div>
				) : viewMode === "grid" ? (
					/* Mosaic: columns that each fill from the top, so tiles of different heights pack together */
					<ul className={cn("gap-2 p-3 [&>li]:mb-2", tile === "s" ? "columns-[9rem]" : tile === "m" ? "columns-[14rem]" : "columns-[22rem]")}>
						{filteredAssets.map((asset) => {
							const thumbnail = thumbnails[asset.name];
							const isRemote = asset.syncStatus === "remote_placeholder";
							const ext = asset.name.split(".").pop()?.toUpperCase() ?? "";
							const details = [dims[asset.name], formatBytes(asset.size), new Date(asset.modified_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })].filter(Boolean).join(" · ");
							return (
								<li key={asset.name} className="group relative break-inside-avoid">
									<button
										type="button"
										onClick={() => setPreviewAsset(asset)}
										aria-label={`${asset.name}, ${asset.category}, ${formatBytes(asset.size)}${isRemote ? ", not downloaded" : ""}`}
										className="relative block w-full cursor-pointer overflow-hidden bg-card text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
									>
										{asset.category === "image" && thumbnail && !isRemote ? (
											<img
												src={thumbnail}
												alt=""
												onLoad={(e) => {
													const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
													setDims((prev) => (prev[asset.name] ? prev : { ...prev, [asset.name]: `${w}×${h}` }));
												}}
												className="block h-auto w-full transition-transform duration-300 group-hover:scale-[1.02] motion-reduce:transition-none"
											/>
										) : (
											<div className={cn("flex w-full flex-col items-center justify-center gap-2 bg-muted/60", asset.category === "image" ? "aspect-[4/3]" : shapeOf(asset), isRemote && "border border-dashed border-warning/60 bg-transparent")}>
												{isRemote ? <Sparkles className="size-8 text-warning" /> : kindIcon(asset.category, "size-9 text-muted-foreground")}
												<span className="font-mono text-xs text-muted-foreground">{isRemote ? "Remote" : ext}</span>
											</div>
										)}
										{/* The name and details appear only on hover or keyboard focus */}
										<span className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col gap-0.5 bg-gradient-to-t from-black/75 via-black/40 to-transparent p-3 pt-10 text-white opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 motion-reduce:transition-none">
											<span className="truncate text-sm font-medium">{asset.name}</span>
											<span className="truncate font-mono text-xs opacity-85">
												{ext} · {details}
												{isRemote && " · not downloaded"}
											</span>
										</span>
									</button>
									<div className="absolute top-2 right-2 flex gap-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 motion-reduce:transition-none">
										<button type="button" aria-label={`Copy a Markdown link to ${asset.name}`} onClick={(e) => handleCopyMarkdown(e, asset)} className={actionButton}>
											{copiedKey === asset.name ? <Check className="size-4 text-success" /> : <Copy className="size-4" />}
										</button>
										<button type="button" aria-label={`History of ${asset.name}`} onClick={() => setHistoryAsset(asset)} className={actionButton}>
											<History className="size-4" />
										</button>
										{!isViewer && (
											<>
												<button
													type="button"
													aria-label={`Rename ${asset.name}`}
													onClick={() => {
														setAssetToRename(asset);
														setNewName(asset.name);
													}}
													className={actionButton}
												>
													<Pencil className="size-4" />
												</button>
												<button type="button" aria-label={`Delete ${asset.name}`} onClick={() => setAssetToDelete(asset)} className={cn(actionButton, "hover:bg-destructive hover:text-white")}>
													<Trash2 className="size-4" />
												</button>
											</>
										)}
									</div>
								</li>
							);
						})}
					</ul>
				) : (
				<div className="p-3">
				<div className="border border-border rounded-none overflow-hidden bg-card/60">
					<table className="w-full text-left text-xs">
						<thead className="bg-muted/50 border-b border-border text-muted-foreground text-xs">
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
											<div className="p-1.5 rounded-none bg-muted text-muted-foreground group-hover:text-primary">
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
											<span className="font-mono text-xs bg-muted px-2 py-0.5 rounded-none text-foreground/80 capitalize">
												{asset.category}
											</span>
										</td>
										<td className="py-3 px-4 font-mono text-muted-foreground">
											{formatBytes(asset.size)}
										</td>
										<td className="py-3 px-4">
											{isRemote ?
												<span className="text-warning font-medium flex items-center gap-1">
													○ Not downloaded
												</span>
											:	<span className="text-success font-medium flex items-center gap-1">
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
													className="h-7 px-2 text-xs rounded-none bg-muted/60 hover:bg-muted text-foreground flex items-center gap-1 cursor-pointer transition-colors border border-border/40"
												>
													{copiedKey === asset.name ?
														<Check className="size-3 text-success" />
													:	<Copy className="size-3" />}
													{copiedKey === asset.name ? "Copied" : "Copy"}
												</button>
												<button
													onClick={(e) => {
														e.stopPropagation();
														setHistoryAsset(asset);
													}}
													title="History"
													className="p-1.5 rounded-none hover:bg-muted text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
												>
													<History className="size-3.5" />
												</button>
												{!isViewer && (
													<>
														<button
															onClick={(e) => {
																e.stopPropagation();
																setAssetToRename(asset);
																setNewName(asset.name);
															}}
															className="p-1.5 rounded-none hover:bg-muted text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
														>
															<Pencil className="size-3.5" />
														</button>
														<button
															onClick={(e) => {
																e.stopPropagation();
																setAssetToDelete(asset);
															}}
															className="p-1.5 rounded-none hover:bg-destructive/10 text-muted-foreground hover:text-destructive cursor-pointer transition-colors"
														>
															<Trash2 className="size-3.5" />
														</button>
													</>
												)}
											</div>
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</div>
				</div>
				)}
			</div>

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
						<DialogHeading icon={<Pencil className="size-6" />} title="Rename asset" description={<>Provide a new name for{" "}
								<span className="font-semibold text-foreground">
									{assetToRename.name}
								</span></>} />

						<div className="space-y-3 my-2">
							<Label htmlFor="rename-input">New file Name</Label>
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
						<DialogHeading icon={<Trash2 className="size-6" />} tone="danger" title="Delete asset" description={<>Move{" "}
								<span className="font-semibold text-foreground">
									{assetToDelete.name}
								</span>{" "}
								to the Trash? You can restore it from there.</>} />

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

			{historyAsset && workspace && (
				<FileHistoryDialog
					workspacePath={workspace.path}
					path={historyAsset.path.replace(/^\/+/, "")}
					readOnly={isViewer}
					onRestored={() => void loadAssets()}
					onClose={() => setHistoryAsset(null)}
				/>
			)}
		</div>
	);
}
