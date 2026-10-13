import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Check, ChevronRight, Copy, Download, FileText, Film, Headphones, History, Image as ImageIcon, Maximize2, Minimize2, Pencil, RefreshCw, Sparkles, Trash2, Volume2, X } from "@/components/animate-icons";

import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import Loading from "@/components/Loading";
import PdfViewer from "@/components/elements/PdfViewer";

import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import { displaySize } from "@/lib/assets/displaySize";
import { readWorkspaceBinaryFile } from "@/lib/tauri";
import { cn, formatBytes, getMimeType } from "@/lib/utils";
import type { AssetItem } from "@/types/workspace";

const INSPECTOR = 320;
const HEADER = 64;
const MIN_VIEWER = { w: 420, h: 440 };

// The size the viewer area takes: a picture or video at its own size, as large as the window allows; a PDF as a tall page
function viewerSize(kind: "image" | "video" | "pdf" | "other", media: { w: number; h: number } | null, win: { w: number; h: number }) {
	const maxW = Math.max(MIN_VIEWER.w, Math.min(win.w * 0.96 - INSPECTOR, 1700));
	const maxH = Math.max(MIN_VIEWER.h, win.h * 0.92 - HEADER);
	if (kind === "pdf") return { w: Math.min(maxW, 860), h: maxH };
	if (kind === "other" || !media) return { w: Math.min(maxW, 560), h: Math.min(maxH, 440) };
	const scale = Math.min(1, maxW / media.w, maxH / media.h);
	return { w: Math.max(MIN_VIEWER.w, Math.round(media.w * scale)), h: Math.max(MIN_VIEWER.h, Math.round(media.h * scale)) };
}

interface AssetPreviewModalProps {
	asset: AssetItem | null;
	workspacePath: string;
	isOpen: boolean;
	onClose: () => void;
	onDownloadLazy?: (asset: AssetItem) => Promise<void>;
	// Stepping through the assets that are showing; the arrow keys do the same
	onStep?: (direction: -1 | 1) => void;
	position?: { index: number; total: number };
	// Left out for people who may not change assets
	onHistory?: (asset: AssetItem) => void;
	onRename?: (asset: AssetItem) => void;
	onDelete?: (asset: AssetItem) => void;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<div className="flex items-baseline justify-between gap-4 border-b py-2 last:border-b-0">
			<dt className="shrink-0 text-sm text-muted-foreground">{label}</dt>
			<dd className="min-w-0 truncate text-right font-mono text-xs" title={typeof children === "string" ? children : undefined}>
				{children}
			</dd>
		</div>
	);
}

export default function AssetPreviewModal({ asset, workspacePath, isOpen, onClose, onDownloadLazy, onStep, position, onHistory, onRename, onDelete }: AssetPreviewModalProps) {
	const [dataUrl, setDataUrl] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const { copiedKey, copy } = useCopyToClipboard();
	const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);
	// The size of the picture or video showing now; kept until the next one reports its own, so the window changes size
	// once, smoothly, when the next asset is ready
	const [media, setMedia] = useState<{ w: number; h: number } | null>(null);
	const [win, setWin] = useState({ w: window.innerWidth, h: window.innerHeight });
	useEffect(() => {
		const onResize = () => setWin({ w: window.innerWidth, h: window.innerHeight });
		window.addEventListener("resize", onResize);
		return () => window.removeEventListener("resize", onResize);
	}, []);
	const [fit, setFit] = useState(true);
	const [isSyncing, setIsSyncing] = useState(false);

	useEffect(() => {
		setDimensions(null);
		setFit(true);
		if (!isOpen || !asset || !workspacePath || asset.syncStatus === "remote_placeholder") {
			setDataUrl(null);
			setError(null);
			return;
		}
		let mounted = true;
		setLoading(true);
		setError(null);
		readWorkspaceBinaryFile(workspacePath, asset.path.replace(/^\/+/, ""))
			.then((base64) => mounted && setDataUrl(`data:${getMimeType(asset.name)};base64,${base64}`))
			.catch((err) => {
				if (!mounted) return;
				console.error("Failed to load asset binary:", err);
				setError(String(err));
			})
			.finally(() => mounted && setLoading(false));
		return () => {
			mounted = false;
		};
	}, [isOpen, asset, workspacePath]);

	// Left and right arrows move to the neighbouring asset, unless something is being typed or played
	useEffect(() => {
		if (!isOpen || !onStep) return;
		const onKey = (e: KeyboardEvent) => {
			const tag = (e.target as HTMLElement).tagName;
			if (e.altKey || e.ctrlKey || e.metaKey || tag === "INPUT" || tag === "TEXTAREA" || tag === "VIDEO" || tag === "AUDIO") return;
			if (e.key === "ArrowLeft") onStep(-1);
			else if (e.key === "ArrowRight") onStep(1);
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [isOpen, onStep]);

	if (!asset) return null;

	const mimeType = getMimeType(asset.name);
	const isImage = mimeType.startsWith("image/");
	const isVideo = mimeType.startsWith("video/");
	const isAudio = mimeType.startsWith("audio/");
	const isPdf = mimeType === "application/pdf";
	const relPath = asset.path.replace(/^\/+/, "");
	const markdown = isImage ? `![${asset.name}](${relPath})` : `[${asset.name}](${relPath})`;
	const isRemote = asset.syncStatus === "remote_placeholder";
	const shown = dimensions ? displaySize(dimensions.width, dimensions.height) : null;

	const exportFile = () => {
		if (!dataUrl) return;
		const a = document.createElement("a");
		a.href = dataUrl;
		a.download = asset.name;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
	};

	const fetchRemote = async () => {
		if (!onDownloadLazy) return;
		setIsSyncing(true);
		try {
			await onDownloadLazy(asset);
		} finally {
			setIsSyncing(false);
		}
	};

	const KindIcon = isImage ? ImageIcon : isVideo ? Film : isAudio ? Headphones : FileText;
	const iconButton = "size-8";

	// Wide windows size themselves to what is showing; narrow ones fill the window and stack the details below
	const adaptive = win.w >= 900;
	const size = viewerSize(isPdf ? "pdf" : isImage ? "image" : isVideo ? "video" : "other", media, win);
	// A picture bigger than the window can be viewed at its own size, scrolling inside the same space
	const canZoom = isImage && !!dimensions && (dimensions.width > size.w + 1 || dimensions.height > size.h + 1);

	const details = (
		<aside aria-label="Asset details" className={cn("flex shrink-0 flex-col gap-5 overflow-y-auto border-border bg-muted/40 p-4", adaptive ? "w-80 border-l" : "max-h-[40%] w-full border-t")}>
			<div className="flex flex-wrap gap-1.5">
				{dataUrl && (
					<Button variant="outline" size="sm" onPress={exportFile}>
						<Download data-icon="inline-start" className="size-4" />
						Export
					</Button>
				)}
				{onHistory && (
					<Button variant="ghost" size="icon-xs" className={iconButton} aria-label="File history" onPress={() => onHistory(asset)}>
						<History className="size-4" />
					</Button>
				)}
				{onRename && (
					<Button variant="ghost" size="icon-xs" className={iconButton} aria-label="Rename" onPress={() => onRename(asset)}>
						<Pencil className="size-4" />
					</Button>
				)}
				{onDelete && (
					<Button variant="ghost" size="icon-xs" className={cn(iconButton, "text-destructive")} aria-label="Delete" onPress={() => onDelete(asset)}>
						<Trash2 className="size-4" />
					</Button>
				)}
			</div>

			<section>
				<h3 className="mb-1 font-mono text-xs text-muted-foreground">Details</h3>
				<dl>
					<Row label="Type">{mimeType}</Row>
					<Row label="Size">{formatBytes(asset.size)}</Row>
					{dimensions && <Row label="Picture">{`${dimensions.width} × ${dimensions.height} px`}</Row>}
					{shown?.halved && <Row label="In the mosaic">{`${shown.width} × ${shown.height} px (50%)`}</Row>}
					<Row label="Status">{isRemote ? "Not downloaded" : "On this device"}</Row>
					<Row label="Modified">{new Date(asset.modified_at).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}</Row>
				</dl>
			</section>

			<section className="space-y-2">
				<div className="flex items-center justify-between">
					<h3 className="font-mono text-xs text-muted-foreground">{isImage ? "Markdown embed" : "Markdown link"}</h3>
					<Button variant="ghost" size="xs" onPress={() => copy(markdown, "markdown")}>
						{copiedKey === "markdown" ? <Check data-icon="inline-start" className="size-3.5 text-success" /> : <Copy data-icon="inline-start" className="size-3.5" />}
						{copiedKey === "markdown" ? "Copied" : "Copy"}
					</Button>
				</div>
				<code className="block break-all border bg-background p-2.5 font-mono text-xs select-all">{markdown}</code>
				<p className="text-xs text-muted-foreground">Paste into a note or Markdown file to embed it.</p>
			</section>

			<section className="space-y-2">
				<div className="flex items-center justify-between">
					<h3 className="font-mono text-xs text-muted-foreground">Path</h3>
					<Button variant="ghost" size="xs" onPress={() => copy(relPath, "path")}>
						{copiedKey === "path" ? <Check data-icon="inline-start" className="size-3.5 text-success" /> : <Copy data-icon="inline-start" className="size-3.5" />}
						{copiedKey === "path" ? "Copied" : "Copy"}
					</Button>
				</div>
				<code className="block break-all border bg-background p-2.5 font-mono text-xs select-all">{relPath}</code>
			</section>
		</aside>
	);

	return (
		<Dialog isOpen={isOpen} onOpenChange={(open) => !open && onClose()} showCloseButton={false} className="right-0 left-0 mx-auto w-fit max-w-[calc(100%-1rem)] translate-x-0 gap-0 overflow-hidden p-0 sm:max-w-none">
			<div
				style={adaptive ? { width: size.w + INSPECTOR, height: size.h + HEADER } : { width: "calc(100vw - 1rem)", height: "calc(100dvh - 1rem)" }}
				className="flex flex-col overflow-hidden transition-[width,height] duration-300 ease-[cubic-bezier(.22,1,.36,1)] motion-reduce:transition-none"
			>
				{/* Title bar */}
				<div style={{ height: HEADER }} className="flex shrink-0 items-center gap-3 border-b px-4">
					<KindIcon className="size-5 shrink-0 text-primary" />
					<div className="min-w-0 flex-1">
						<DialogTitle className="truncate text-base font-semibold">{asset.name}</DialogTitle>
						<DialogDescription className="truncate font-mono text-xs text-muted-foreground">
							{formatBytes(asset.size)} · {relPath}
						</DialogDescription>
					</div>
					{position && position.total > 1 && (
						<div className="flex items-center gap-1">
							<Button variant="ghost" size="icon-xs" aria-label="Previous asset" onPress={() => onStep?.(-1)}>
								<ChevronRight className="size-4 rotate-180" />
							</Button>
							<span className="font-mono text-xs tabular-nums text-muted-foreground" aria-live="polite">
								{position.index + 1} / {position.total}
							</span>
							<Button variant="ghost" size="icon-xs" aria-label="Next asset" onPress={() => onStep?.(1)}>
								<ChevronRight className="size-4" />
							</Button>
						</div>
					)}
					<Button variant="ghost" size="icon-xs" onPress={onClose} aria-label="Close preview">
						<X className="size-4" />
					</Button>
				</div>

				<div className={cn("flex min-h-0 flex-1", adaptive ? "flex-row" : "flex-col")}>
					{/* Viewer: just the asset, with no frame or pattern behind it */}
					<div className="relative flex min-h-0 min-w-0 flex-1 overflow-auto bg-background">
						{/* Each asset fades in as it arrives */}
						<div key={asset.name} className="flex min-h-full min-w-full animate-in fade-in duration-300 motion-reduce:animate-none">
							{loading && <Loading className="m-auto" />}
							{error && (
								<div role="alert" className="m-auto max-w-md p-6 text-center">
									<p className="text-sm font-semibold text-destructive">This asset could not be opened</p>
									<p className="mt-1 font-mono text-xs text-destructive/80">{error}</p>
								</div>
							)}
							{isRemote && (
								<div className="m-auto flex max-w-sm flex-col items-center gap-4 border bg-muted/40 p-8 text-center">
									<Sparkles className="size-8 text-warning" />
									<div>
										<h4 className="font-semibold">Not downloaded yet</h4>
										<p className="mt-1 text-sm text-muted-foreground">This file belongs to the workspace but has not reached this device yet.</p>
									</div>
									<Button onPress={fetchRemote} isDisabled={isSyncing}>
										{isSyncing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw data-icon="inline-start" className="size-4" />}
										{isSyncing ? "Downloading…" : "Download"}
									</Button>
								</div>
							)}
							{!loading && !error && dataUrl && (
								<>
									{isImage && (
										<img
											src={dataUrl}
											alt={asset.name}
											onLoad={(e) => {
												const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
												setDimensions({ width: w, height: h });
												if (w > 0 && h > 0) setMedia({ w, h });
											}}
											className={cn("m-auto", fit ? "max-h-full max-w-full object-contain" : "max-w-none")}
										/>
									)}
									{isVideo && (
										<video
											src={dataUrl}
											controls
											onLoadedMetadata={(e) => {
												const { videoWidth: w, videoHeight: h } = e.currentTarget;
												if (w > 0 && h > 0) setMedia({ w, h });
											}}
											className="m-auto max-h-full max-w-full bg-black"
										/>
									)}
									{isAudio && (
										<div className="m-auto flex w-full max-w-md flex-col items-center gap-4 border bg-muted/40 p-6">
											<Volume2 className="size-8 text-primary" />
											<p className="text-sm font-semibold">{asset.name}</p>
											<audio src={dataUrl} controls className="w-full" />
										</div>
									)}
									{isPdf && <PdfViewer name={asset.name} base64={dataUrl.slice(dataUrl.indexOf(",") + 1)} />}
									{!isImage && !isVideo && !isAudio && !isPdf && (
										<div className="m-auto flex max-w-sm flex-col items-center gap-3 border bg-muted/40 p-8 text-center">
											<FileText className="size-12 text-muted-foreground" />
											<p className="font-semibold">{asset.name}</p>
											<p className="text-sm text-muted-foreground">This kind of file cannot be previewed here.</p>
											<Button variant="outline" size="sm" onPress={exportFile}>
												<Download data-icon="inline-start" className="size-4" />
												Export File
											</Button>
										</div>
									)}
								</>
							)}
						</div>
						{canZoom && (
							<Button variant="outline" size="sm" onPress={() => setFit((f) => !f)} aria-pressed={!fit} className="absolute right-3 bottom-3 bg-background">
								{fit ? <Maximize2 data-icon="inline-start" className="size-4" /> : <Minimize2 data-icon="inline-start" className="size-4" />}
								{fit ? "Actual Size" : "Fit to Window"}
							</Button>
						)}
					</div>

					{details}
				</div>
			</div>
		</Dialog>
	);
}
