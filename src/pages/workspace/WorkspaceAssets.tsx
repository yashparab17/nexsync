import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { EmptyState } from "@/components/layout/Page";
import Toolbar, { ToolbarTitle, ToolbarSearch, ToolbarSelect, ToolbarSwitch, ToolbarTabs } from "@/components/layout/Toolbar";
import { SlidersHorizontal, Copy, Check, Play, Trash2, FileText, Film, Headphones, Image as ImageIcon, History, Pencil, Sparkles, Upload, UploadCloud } from "@/components/animate-icons";
import { displaySize } from "@/lib/assets/displaySize";
import { justify } from "@/lib/assets/justify";
import { validateFileName } from "@/lib/validation";
import { MAX_PREVIEW_BYTES, pdfFirstPage, previewKind, textSnippet, videoFrame, type TilePreview } from "@/lib/assets/previews";
import { DropOverlay, useDropNotice, useFileDrop } from "@/hooks/useFileDrop";
import { dropSummary, importDropped } from "@/lib/dropImport";
import { Ellipsis } from "lucide-react";
import { useContextMenu, type MenuEntry } from "@/components/elements/ContextMenu";
import { cn } from "@/lib/utils";

import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter, DialogHeading } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import AssetPreviewModal from "@/components/dialogs/workspace/AssetPreviewModal";
import FileHistoryDialog from "@/components/dialogs/workspace/FileHistoryDialog";
import AssetUploadDialog from "@/components/dialogs/workspace/AssetUploadDialog";
import { useListKeys } from "@/hooks/useListKeys";
import { useErrorLog } from "@/hooks/useErrorLog";
import { useOpenParam } from "@/hooks/useOpenParam";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import { formatBytes, getMimeType } from "@/lib/utils";
import {
	deleteWorkspaceItem,
	listWorkspaceFiles,
	readWorkspaceBinaryFile,
	renameWorkspaceItem,
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

const SORTS = {
	newest: "Newest first",
	oldest: "Oldest first",
	name: "Name A–Z",
	"name-desc": "Name Z–A",
	largest: "Largest first",
	smallest: "Smallest first",
	type: "Kind",
};
type SortKey = keyof typeof SORTS;
const SIZE_BANDS = { any: "Any size", small: "Under 1 MB", medium: "1–10 MB", large: "Over 10 MB" };
type SizeBand = keyof typeof SIZE_BANDS;
const AGES = { any: "Any time", day: "Past day", week: "Past week", month: "Past month" };
type Age = keyof typeof AGES;
const MB = 1024 * 1024;
const DAY_MS = 86_400_000;
const AGE_MS: Record<Age, number> = { any: Infinity, day: DAY_MS, week: 7 * DAY_MS, month: 30 * DAY_MS };
const when = (a: AssetItem) => new Date(a.modified_at).getTime() || 0;
const COMPARE: Record<SortKey, (a: AssetItem, b: AssetItem) => number> = {
	newest: (a, b) => when(b) - when(a),
	oldest: (a, b) => when(a) - when(b),
	name: (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }),
	"name-desc": (a, b) => b.name.localeCompare(a.name, undefined, { numeric: true, sensitivity: "base" }),
	largest: (a, b) => b.size - a.size,
	smallest: (a, b) => a.size - b.size,
	type: (a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }),
};

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
	const [sort, setSort] = useState<SortKey>("newest");
	const [sizeBand, setSizeBand] = useState<SizeBand>("any");
	const [age, setAge] = useState<Age>("any");
	const [showFilters, setShowFilters] = useState(false);
	// How big the tiles are drawn, and each picture's own size once it is known
	const [tile, setTile] = useState<"s" | "m" | "l">("m");
	const [sizes, setSizes] = useState<Record<string, { w: number; h: number }>>({});
	// Small pictures of PDFs, videos and text files, made in the background
	const [previews, setPreviews] = useState<Record<string, TilePreview>>({});
	const [gridWidth, setGridWidth] = useState(1200);
	// The mosaic's width is watched from the moment it is on screen, however many times it has been hidden and shown again
	const observer = useRef<ResizeObserver | null>(null);
	const gridRef = useCallback((el: HTMLUListElement | null) => {
		observer.current?.disconnect();
		if (!el) return;
		observer.current = new ResizeObserver(() => setGridWidth(el.clientWidth));
		observer.current.observe(el);
		setGridWidth(el.clientWidth);
	}, []);

	// Thumbnails cache for images (base64 URLs)
	const [thumbnails, setThumbnails] = useState<Record<string, string>>({});

	// Dialog states
	const [isUploadOpen, setIsUploadOpen] = useState(false);
	useListKeys(isViewer ? undefined : () => setIsUploadOpen(true));
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

	// A picture's own size, read once its thumbnail has arrived, decides how big its tile is
	useEffect(() => {
		for (const [name, src] of Object.entries(thumbnails)) {
			if (sizes[name]) continue;
			const img = new Image();
			img.onload = () => img.naturalWidth > 0 && img.naturalHeight > 0 && setSizes((prev) => (prev[name] ? prev : { ...prev, [name]: { w: img.naturalWidth, h: img.naturalHeight } }));
			img.src = src;
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [thumbnails]);

	// PDFs, videos and text files get a preview tile, made one at a time so a big folder does not stall the page
	useEffect(() => {
		const root = workspace?.path;
		if (!root) return;
		let live = true;
		void (async () => {
			for (const asset of assets) {
				if (!live) return;
				const kind = previewKind(asset.name);
				if (!kind || previews[asset.name] || asset.syncStatus !== "synced" || asset.size > MAX_PREVIEW_BYTES[kind]) continue;
				try {
					const base64 = await readWorkspaceBinaryFile(root, asset.path.replace(/^\/+/, ""));
					const made: TilePreview = kind === "pdf" ? await pdfFirstPage(base64) : kind === "video" ? await videoFrame(`data:${getMimeType(asset.name)};base64,${base64}`) : { kind: "text", text: textSnippet(base64) };
					if (!live) return;
					setPreviews((prev) => ({ ...prev, [asset.name]: made }));
					if (made.kind === "image" && made.width > 0 && made.height > 0) setSizes((prev) => ({ ...prev, [asset.name]: { w: made.width, h: made.height } }));
				} catch (err) {
					console.debug("Preview skipped for", asset.name, err);
				}
			}
		})();
		return () => {
			live = false;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [assets, workspace?.path]);

	// Filtered assets
	const filteredAssets = useMemo(() => {
		const now = Date.now();
		return assets
			.filter((asset) => {
				const matchesCategory =
					selectedCategory === "all" || asset.category === selectedCategory;
				const matchesSearch = asset.name
					.toLowerCase()
					.includes(searchQuery.toLowerCase());
				const matchesSize = sizeBand === "any" || (sizeBand === "small" ? asset.size < MB : sizeBand === "medium" ? asset.size >= MB && asset.size <= 10 * MB : asset.size > 10 * MB);
				const matchesAge = age === "any" || now - when(asset) <= AGE_MS[age];
				return matchesCategory && matchesSearch && matchesSize && matchesAge;
			})
			.sort(COMPARE[sort]);
	}, [assets, selectedCategory, searchQuery, sizeBand, age, sort]);
	const narrowed = sizeBand !== "any" || age !== "any";

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

	// Files dropped anywhere on the page are added to assets, saved as they are; a dropped folder adds the files in it
	const notice = useDropNotice();
	const { dragging, bind: dropProps } = useFileDrop(async (items) => {
		if (!workspace?.path) return;
		const result = await importDropped(workspace.path, "assets", items.map((i) => ({ ...i, rel: i.file.name })));
		notice.show(dropSummary(result));
		await loadAssets();
		await refreshStats();
	}, isViewer || !workspace?.path);

	const kindIcon = (category: AssetItem["category"], className: string) =>
		category === "video" ? <Film className={className} /> : category === "audio" ? <Headphones className={className} /> : category === "image" ? <ImageIcon className={className} /> : <FileText className={className} />;

	// Tiles sit in rows that each fill the width, so no space is left over. A tile wants to be drawn at its own size,
	// or half of it for pictures bigger than 500 pixels, and each row stretches its tiles together to reach the edges.
	const GAP = 8;
	const PAD = 12;
	const mul = tile === "s" ? 0.7 : tile === "l" ? 1.4 : 1;
	const tileWish = (asset: AssetItem): { aspect: number; height: number } => {
		const natural = sizes[asset.name];
		let w: number;
		let h: number;
		if (asset.syncStatus === "remote_placeholder") [w, h] = [150, 150];
		else if (natural) {
			const d = displaySize(natural.w, natural.h);
			[w, h] = [d.width, d.height];
		} else if (asset.category === "image") [w, h] = [200, 200];
		else if (asset.category === "video") [w, h] = [240, 135];
		else if (asset.category === "audio") [w, h] = [180, 135];
		else if (asset.category === "document") [w, h] = [150, 200];
		else [w, h] = [120, 120];
		return { aspect: w / h, height: h * mul };
	};
	const layout = useMemo(
		() => justify(filteredAssets.map((a) => ({ id: a.name, ...tileWish(a) })), gridWidth - PAD * 2, GAP),
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[filteredAssets, sizes, gridWidth, tile],
	);

	const tabs = [
		{ key: "all", label: "All", count: categoryCounts.all },
		{ key: "image", label: "Photos", count: categoryCounts.image },
		{ key: "video", label: "Video", count: categoryCounts.video },
		{ key: "audio", label: "Audio", count: categoryCounts.audio },
		{ key: "document", label: "Documents", count: categoryCounts.document },
		{ key: "other", label: "Other", count: categoryCounts.other },
	];

	const menu = useContextMenu();
	const renameAsset = (asset: AssetItem) => {
		setAssetToRename(asset);
		setNewName(asset.name);
	};
	// The same actions as the buttons on a wide tile, for narrow tiles and for a right-click
	const assetMenu = (e: { clientX: number; clientY: number; preventDefault: () => void }, asset: AssetItem) => {
		const entries: MenuEntry[] = [
			{ label: "Open", icon: <ImageIcon className="size-4" />, onSelect: () => setPreviewAsset(asset) },
			{ label: "Copy Markdown link", icon: <Copy className="size-4" />, onSelect: () => copy(asset.category === "image" ? `![${asset.name}](${asset.path.replace(/^\/+/, "")})` : `[${asset.name}](${asset.path.replace(/^\/+/, "")})`, asset.name) },
			{ label: "File history", icon: <History className="size-4" />, onSelect: () => setHistoryAsset(asset) },
			...(isViewer
				? []
				: ([
						"separator",
						{ label: "Rename…", icon: <Pencil className="size-4" />, onSelect: () => renameAsset(asset) },
						{ label: "Delete…", icon: <Trash2 className="size-4" />, danger: true, onSelect: () => setAssetToDelete(asset) },
					] as MenuEntry[])),
		];
		menu.open(e, entries);
	};

	const actionButton = "flex size-8 cursor-pointer items-center justify-center bg-background/90 text-foreground outline-none backdrop-blur hover:bg-background focus-visible:ring-2 focus-visible:ring-ring";

	return (
		<div {...dropProps} className="relative flex h-full min-h-0 flex-col bg-background">
			<DropOverlay show={dragging} title="Drop to add to assets" />
			{notice.node}

			{/* Toolbar */}
			<Toolbar>
				<ToolbarTitle name="Assets" meta={assets.length || undefined} />
				<ToolbarTabs label="Kind of asset" value={selectedCategory} onChange={setSelectedCategory} tabs={tabs as { key: AssetCategory; label: string; count: number }[]} />
				<span className="flex-1" />
				{!isViewer && (
					<Button size="sm" onPress={() => setIsUploadOpen(true)}>
						<Upload data-icon="inline-start" className="size-4" />
						Upload
					</Button>
				)}
			</Toolbar>
			<Toolbar variant="sub" className="h-auto min-h-10 flex-wrap gap-2 py-1">
				<ToolbarSearch label="Search assets" placeholder="Search assets" value={searchQuery} onChange={setSearchQuery} />
				<Button variant={showFilters || narrowed ? "secondary" : "outline"} size="sm" aria-expanded={showFilters} onPress={() => setShowFilters((v) => !v)}>
					<SlidersHorizontal className="size-4" />
					Filters
					{narrowed && <span className="font-mono text-[13px]">{Number(sizeBand !== "any") + Number(age !== "any")}</span>}
				</Button>
				{showFilters && (
					<>
						<ToolbarSelect label="Size" value={sizeBand} onChange={setSizeBand} active={sizeBand !== "any"} options={Object.entries(SIZE_BANDS).map(([value, label]) => ({ value: value as SizeBand, label }))} />
						<ToolbarSelect label="Modified" value={age} onChange={setAge} active={age !== "any"} options={Object.entries(AGES).map(([value, label]) => ({ value: value as Age, label }))} />
						{narrowed && (
							<Button variant="ghost" size="sm" onPress={() => { setSizeBand("any"); setAge("any"); }}>
								Clear
							</Button>
						)}
					</>
				)}
				<span className="flex-1" />
				<ToolbarSelect label="Sort by" value={sort} onChange={setSort} options={Object.entries(SORTS).map(([value, label]) => ({ value: value as SortKey, label }))} />
				<ToolbarSwitch
					label="Tile size"
					value={tile}
					onChange={setTile}
					options={[
						{ value: "s", label: "S", title: "Small tiles" },
						{ value: "m", label: "M", title: "Medium tiles" },
						{ value: "l", label: "L", title: "Large tiles" },
					]}
				/>
			</Toolbar>

			{/* Assets */}
			<div className="min-h-0 flex-1 overflow-auto">
				{loading ? (
					<Loading className="py-24" />
				) : filteredAssets.length === 0 ? (
					<EmptyState
						icon={<ImageIcon />}
						title={searchQuery || narrowed ? "No matching assets" : "Nothing here yet"}
						action={
							!searchQuery && !narrowed && !isViewer && (
								<Button size="sm" onPress={() => setIsUploadOpen(true)}>
									<UploadCloud data-icon="inline-start" className="size-4" />
									Upload Assets
								</Button>
							)
						}
					>
						{searchQuery || narrowed ? "Try a different search, a wider size or date, or another kind of asset." : "Drop pictures, audio, video or documents anywhere on this page, or press Upload."}
					</EmptyState>
				) : (
					/* Mosaic: columns that each fill from the top, so tiles of different heights pack together */
					<ul ref={gridRef} className="relative" style={{ height: (Number.isFinite(layout.height) ? layout.height : 0) + PAD * 2 }}>
						{filteredAssets.map((asset) => {
							const thumbnail = thumbnails[asset.name];
							const preview = previews[asset.name];
							const isRemote = asset.syncStatus === "remote_placeholder";
							const ext = asset.name.split(".").pop()?.toUpperCase() ?? "";
							const natural = sizes[asset.name];
							const shown = natural ? displaySize(natural.w, natural.h) : null;
							const box = layout.boxes[asset.name];
							if (!box) return null;
							const details = [natural && `${natural.w}×${natural.h}${shown?.halved ? " (shown at 50%)" : ""}`, formatBytes(asset.size), new Date(asset.modified_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })].filter(Boolean).join(" · ");
							return (
								<li
									key={asset.name}
									onContextMenu={(e) => assetMenu(e, asset)}
									className="group absolute overflow-hidden animate-in fade-in zoom-in-95 duration-300 [transition:left_350ms_cubic-bezier(.22,1,.36,1),top_350ms_cubic-bezier(.22,1,.36,1),width_350ms_cubic-bezier(.22,1,.36,1),height_350ms_cubic-bezier(.22,1,.36,1)] motion-reduce:animate-none motion-reduce:transition-none"
									style={{ left: box.x + PAD, top: box.y + PAD, width: box.w, height: box.h }}
								>
									<button
										type="button"
										data-nav
										onClick={() => setPreviewAsset(asset)}
										aria-label={`${asset.name}, ${asset.category}, ${formatBytes(asset.size)}${isRemote ? ", not downloaded" : ""}`}
										className="relative block h-full w-full cursor-pointer overflow-hidden bg-card text-left outline-none after:pointer-events-none after:absolute after:inset-0 after:ring-1 after:ring-inset after:ring-foreground/10 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
									>
										{asset.category === "image" && thumbnail && !isRemote ? (
											<img
												src={thumbnail}
												alt=""
												className="block h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02] motion-reduce:transition-none"
											/>
										) : preview?.kind === "image" && !isRemote ? (
											<>
												<img src={preview.src} alt="" className="block h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02] motion-reduce:transition-none" />
												{asset.category === "video" && (
													<span aria-hidden="true" className="absolute top-1/2 left-1/2 flex size-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center bg-black/55 text-white">
														<Play className="size-5" />
													</span>
												)}
											</>
										) : preview?.kind === "text" && !isRemote ? (
											<div className="flex h-full w-full flex-col gap-2 overflow-hidden border bg-muted/40 p-3">
												<pre className="min-h-0 flex-1 overflow-hidden font-mono text-xs leading-snug break-words whitespace-pre-wrap text-muted-foreground">{preview.text}</pre>
												<span className="font-mono text-xs text-muted-foreground/70">{ext}</span>
											</div>
										) : (
											<div className={cn("flex h-full w-full flex-col items-center justify-center gap-2 border bg-muted/40", isRemote && "border border-dashed border-warning/60 bg-transparent")}>
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
									{/* Wide tiles show every action; narrow ones show one button that opens the same list as a menu */}
									<div className="absolute top-2 right-2 flex gap-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 motion-reduce:transition-none">
										{box.w >= 200 ? (
											<>
												<button type="button" aria-label={`Copy a Markdown link to ${asset.name}`} onClick={(e) => handleCopyMarkdown(e, asset)} className={actionButton}>
													{copiedKey === asset.name ? <Check className="size-4 text-success" /> : <Copy className="size-4" />}
												</button>
												<button type="button" aria-label={`History of ${asset.name}`} onClick={() => setHistoryAsset(asset)} className={actionButton}>
													<History className="size-4" />
												</button>
												{!isViewer && (
													<>
														<button type="button" aria-label={`Rename ${asset.name}`} onClick={() => renameAsset(asset)} className={actionButton}>
															<Pencil className="size-4" />
														</button>
														<button type="button" aria-label={`Delete ${asset.name}`} onClick={() => setAssetToDelete(asset)} className={cn(actionButton, "hover:bg-destructive hover:text-white")}>
															<Trash2 className="size-4" />
														</button>
													</>
												)}
											</>
										) : (
											<button
												type="button"
												aria-label={`Actions for ${asset.name}`}
												aria-haspopup="menu"
												onClick={(e) => {
													const r = e.currentTarget.getBoundingClientRect();
													assetMenu({ clientX: r.left, clientY: r.bottom + 4, preventDefault: () => {} }, asset);
												}}
												className={actionButton}
											>
												<Ellipsis className="size-4" />
											</button>
										)}
									</div>
								</li>
							);
						})}
					</ul>
				)}
			</div>

			{menu.menu}

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
					position={{ index: Math.max(0, filteredAssets.findIndex((a) => a.name === previewAsset.name)), total: filteredAssets.length }}
					onStep={(direction) => {
						const at = filteredAssets.findIndex((a) => a.name === previewAsset.name);
						const next = filteredAssets[(at + direction + filteredAssets.length) % filteredAssets.length];
						if (next) setPreviewAsset(next);
					}}
					onHistory={(a) => {
						setPreviewAsset(null);
						setHistoryAsset(a);
					}}
					onRename={isViewer ? undefined : (a) => {
						setPreviewAsset(null);
						setAssetToRename(a);
						setNewName(a.name);
					}}
					onDelete={isViewer ? undefined : (a) => {
						setPreviewAsset(null);
						setAssetToDelete(a);
					}}
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
						<DialogHeading icon={<Pencil className="size-6" />} title="Rename asset" />

						<div className="space-y-2">
							<Label htmlFor="rename-input">New name</Label>
							<Input
								id="rename-input"
								value={newName}
								onChange={(e) => setNewName(e.target.value)}
								aria-invalid={!!validateFileName(newName)}
								autoFocus
							/>
							{validateFileName(newName) && (
								<p role="alert" className="text-xs text-destructive">
									{validateFileName(newName)}
								</p>
							)}
						</div>

						<DialogFooter className="mt-4 gap-2">
							<Button
								variant="outline"
								onPress={() => setAssetToRename(null)}
								isDisabled={isRenaming}
							>
								Cancel
							</Button>
							<Button
								onPress={handleRenameConfirm}
								isDisabled={!newName.trim() || isRenaming || !!validateFileName(newName)}
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

						<DialogFooter className="mt-4 gap-2">
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
