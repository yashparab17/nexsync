import { useEffect, useState } from "react";
import {
	Check,
	Copy,
	Download,
	FileText,
	Film,
	Headphones,
	Image as ImageIcon,
	Loader2,
	Maximize2,
	Minimize2,
	RefreshCw,
	Sparkles,
	Volume2,
	X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";

import { readWorkspaceBinaryFile } from "@/lib/tauri";
import type { AssetItem } from "@/types/workspace";

interface AssetPreviewModalProps {
	asset: AssetItem | null;
	workspacePath: string;
	isOpen: boolean;
	onClose: () => void;
	onDownloadLazy?: (asset: AssetItem) => Promise<void>;
}

// Map file extensions to standard MIME types
function getMimeType(fileName: string): string {
	const ext = fileName.split(".").pop()?.toLowerCase() || "";
	switch (ext) {
		case "png":
			return "image/png";
		case "jpg":
		case "jpeg":
			return "image/jpeg";
		case "gif":
			return "image/gif";
		case "webp":
			return "image/webp";
		case "svg":
			return "image/svg+xml";
		case "bmp":
			return "image/bmp";
		case "ico":
			return "image/x-icon";
		case "mp4":
			return "video/mp4";
		case "webm":
			return "video/webm";
		case "mov":
			return "video/quicktime";
		case "mp3":
			return "audio/mpeg";
		case "wav":
			return "audio/wav";
		case "ogg":
			return "audio/ogg";
		case "m4a":
		case "aac":
			return "audio/aac";
		case "pdf":
			return "application/pdf";
		case "txt":
			return "text/plain";
		case "json":
			return "application/json";
		default:
			return "application/octet-stream";
	}
}

// Format bytes into human-readable size
function formatBytes(bytes: number): string {
	if (bytes === 0) return "0 Bytes";
	const k = 1024;
	const sizes = ["Bytes", "KB", "MB", "GB"];
	const i = Math.floor(Math.log(bytes) / Math.log(k));
	return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

export default function AssetPreviewModal({
	asset,
	workspacePath,
	isOpen,
	onClose,
	onDownloadLazy,
}: AssetPreviewModalProps) {
	const [dataUrl, setDataUrl] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [copiedMarkdown, setCopiedMarkdown] = useState(false);
	const [copiedPath, setCopiedPath] = useState(false);
	const [dimensions, setDimensions] = useState<{
		width: number;
		height: number;
	} | null>(null);
	const [isFitToScreen, setIsFitToScreen] = useState(true);
	const [isSyncing, setIsSyncing] = useState(false);

	useEffect(() => {
		if (!isOpen || !asset || !workspacePath) {
			setDataUrl(null);
			setError(null);
			setDimensions(null);
			return;
		}

		if (asset.syncStatus === "remote_placeholder") {
			setDataUrl(null);
			return;
		}

		let isMounted = true;
		setLoading(true);
		setError(null);

		const loadBinary = async () => {
			try {
				const base64 = await readWorkspaceBinaryFile(
					workspacePath,
					asset.path.startsWith("/") ? asset.path.slice(1) : asset.path,
				);
				if (!isMounted) return;
				const mime = getMimeType(asset.name);
				setDataUrl(`data:${mime};base64,${base64}`);
			} catch (err) {
				if (!isMounted) return;
				console.error("Failed to load asset binary:", err);
				setError(String(err));
			} finally {
				if (isMounted) setLoading(false);
			}
		};

		loadBinary();

		return () => {
			isMounted = false;
		};
	}, [isOpen, asset, workspacePath]);

	if (!asset) return null;

	const mimeType = getMimeType(asset.name);
	const isImage = mimeType.startsWith("image/");
	const isVideo = mimeType.startsWith("video/");
	const isAudio = mimeType.startsWith("audio/");
	const isPdf = mimeType === "application/pdf";

	const cleanRelPath =
		asset.path.startsWith("/") ? asset.path.slice(1) : asset.path;

	const markdownSnippet =
		isImage ?
			`![${asset.name}](${cleanRelPath})`
		:	`[${asset.name}](${cleanRelPath})`;

	const handleCopyMarkdown = () => {
		navigator.clipboard.writeText(markdownSnippet);
		setCopiedMarkdown(true);
		setTimeout(() => setCopiedMarkdown(false), 2000);
	};

	const handleCopyPath = () => {
		navigator.clipboard.writeText(cleanRelPath);
		setCopiedPath(true);
		setTimeout(() => setCopiedPath(false), 2000);
	};

	const handleDownloadFile = () => {
		if (!dataUrl) return;
		const a = document.createElement("a");
		a.href = dataUrl;
		a.download = asset.name;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
	};

	const handleFetchRemote = async () => {
		if (!onDownloadLazy) return;
		setIsSyncing(true);
		try {
			await onDownloadLazy(asset);
		} finally {
			setIsSyncing(false);
		}
	};

	return (
		<Dialog
			isOpen={isOpen}
			onOpenChange={(open) => !open && onClose()}
			className="max-w-4xl max-h-[90vh] p-0 overflow-hidden bg-background/95 backdrop-blur-md border-border shadow-2xl"
		>
			<div className="flex flex-col h-full overflow-hidden">
				{/* Top Bar */}
				<DialogHeader className="flex flex-row items-center justify-between px-6 py-4 border-b border-border/60 bg-muted/20">
					<div className="flex items-center gap-3">
						<div className="p-2 rounded-md bg-primary/10 text-primary">
							{isImage ?
								<ImageIcon className="size-5" />
							: isVideo ?
								<Film className="size-5" />
							: isAudio ?
								<Headphones className="size-5" />
							:	<FileText className="size-5" />}
						</div>
						<div>
							<DialogTitle className="text-base font-semibold truncate max-w-md">
								{asset.name}
							</DialogTitle>
							<DialogDescription className="text-xs text-muted-foreground">
								{formatBytes(asset.size)} • {cleanRelPath}
							</DialogDescription>
						</div>
					</div>

					<div className="flex items-center gap-2">
						{dataUrl && (
							<Button
								variant="outline"
								size="sm"
								onPress={handleDownloadFile}
								className="gap-1.5 text-xs h-8"
							>
								<Download className="size-3.5" />
								Export
							</Button>
						)}
						<Button
							variant="ghost"
							size="icon"
							onPress={onClose}
							className="size-8"
						>
							<X className="size-4" />
						</Button>
					</div>
				</DialogHeader>

				{/* Preview Workspace Area */}
				<div className="flex-1 flex flex-col md:flex-row overflow-hidden">
					{/* Main Viewer */}
					<div className="flex-1 bg-black/40 flex items-center justify-center p-6 relative min-h-[360px] overflow-auto">
						{loading && (
							<div className="flex flex-col items-center gap-3 text-muted-foreground">
								<Loader2 className="size-8 animate-spin text-primary" />
								<p className="text-xs font-mono">Loading binary data…</p>
							</div>
						)}

						{error && (
							<div className="flex flex-col items-center gap-2 text-destructive p-6 text-center max-w-md">
								<p className="text-sm font-semibold">
									Failed to load asset preview
								</p>
								<p className="text-xs font-mono text-destructive/80">
									{error}
								</p>
							</div>
						)}

						{asset.syncStatus === "remote_placeholder" && (
							<div className="flex flex-col items-center gap-4 text-center p-8 bg-card/60 border border-border/80 rounded-xl max-w-md shadow-lg">
								<div className="p-3 rounded-full bg-amber-500/10 text-amber-500 border border-amber-500/20">
									<Sparkles className="size-8" />
								</div>
								<div>
									<h4 className="font-semibold text-foreground">
										Peer Asset Placeholder
									</h4>
									<p className="text-xs text-muted-foreground mt-1">
										This file is indexed in the workspace metadata but has not
										been downloaded to your local device yet.
									</p>
								</div>
								<Button
									onPress={handleFetchRemote}
									isDisabled={isSyncing}
									className="gap-2"
								>
									{isSyncing ?
										<Loader2 className="size-4 animate-spin" />
									:	<RefreshCw className="size-4" />}
									{isSyncing ? "Syncing from Peer…" : "Download on Demand"}
								</Button>
							</div>
						)}

						{!loading && !error && dataUrl && (
							<>
								{/* Image Preview */}
								{isImage && (
									<div className="relative flex items-center justify-center w-full h-full">
										<img
											src={dataUrl}
											alt={asset.name}
											onLoad={(e) => {
												const img = e.currentTarget;
												setDimensions({
													width: img.naturalWidth,
													height: img.naturalHeight,
												});
											}}
											className={`transition-all duration-200 rounded-md shadow-lg ${
												isFitToScreen ?
													"max-h-[50vh] max-w-full object-contain"
												:	"max-w-none"
											}`}
										/>
										<button
											onClick={() => setIsFitToScreen(!isFitToScreen)}
											title={isFitToScreen ? "Original Size" : "Fit to Screen"}
											className="absolute bottom-2 right-2 p-1.5 rounded-md bg-background/80 hover:bg-background text-foreground backdrop-blur border border-border/60 text-xs flex items-center gap-1 cursor-pointer transition-all"
										>
											{isFitToScreen ?
												<Maximize2 className="size-3.5" />
											:	<Minimize2 className="size-3.5" />}
										</button>
									</div>
								)}

								{/* Video Preview */}
								{isVideo && (
									<div className="w-full max-w-2xl flex flex-col items-center">
										<video
											src={dataUrl}
											controls
											autoPlay={false}
											className="w-full max-h-[50vh] rounded-lg shadow-2xl border border-border/40 bg-black"
										/>
									</div>
								)}

								{/* Audio Preview */}
								{isAudio && (
									<div className="w-full max-w-md p-6 bg-card/80 backdrop-blur border border-border rounded-xl shadow-xl flex flex-col items-center gap-4">
										<div className="p-4 rounded-full bg-primary/10 text-primary animate-pulse">
											<Volume2 className="size-8" />
										</div>
										<div className="text-center">
											<p className="font-semibold text-sm">{asset.name}</p>
											<p className="text-xs text-muted-foreground">
												Audio Stream
											</p>
										</div>
										<audio src={dataUrl} controls className="w-full mt-2" />
									</div>
								)}

								{/* PDF Viewer */}
								{isPdf && (
									<iframe
										src={dataUrl}
										title={asset.name}
										className="w-full h-[55vh] rounded-md border border-border/50 bg-white"
									/>
								)}

								{/* Generic Binary / Other */}
								{!isImage && !isVideo && !isAudio && !isPdf && (
									<div className="flex flex-col items-center gap-3 text-center p-8 bg-card/50 border border-border rounded-xl">
										<FileText className="size-12 text-muted-foreground" />
										<div>
											<p className="font-semibold">{asset.name}</p>
											<p className="text-xs text-muted-foreground mt-1">
												Binary file preview is not supported for this format.
											</p>
										</div>
										<Button
											variant="outline"
											size="sm"
											onPress={handleDownloadFile}
											className="gap-2 mt-2"
										>
											<Download className="size-4" />
											Download File
										</Button>
									</div>
								)}
							</>
						)}
					</div>

					{/* Metadata & Embed Inspector Sidebar */}
					<div className="w-full md:w-80 border-t md:border-t-0 md:border-l border-border/60 p-5 bg-card/30 flex flex-col gap-5 overflow-y-auto">
						<div>
							<h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
								Asset Details
							</h4>
							<dl className="space-y-2.5 text-xs">
								<div className="flex justify-between items-center py-1 border-b border-border/40">
									<dt className="text-muted-foreground">Type</dt>
									<dd className="font-mono text-foreground font-medium">
										{mimeType}
									</dd>
								</div>
								<div className="flex justify-between items-center py-1 border-b border-border/40">
									<dt className="text-muted-foreground">File Size</dt>
									<dd className="font-mono text-foreground">
										{formatBytes(asset.size)}
									</dd>
								</div>
								{dimensions && (
									<div className="flex justify-between items-center py-1 border-b border-border/40">
										<dt className="text-muted-foreground">Resolution</dt>
										<dd className="font-mono text-foreground">
											{dimensions.width} × {dimensions.height} px
										</dd>
									</div>
								)}
								<div className="flex justify-between items-center py-1 border-b border-border/40">
									<dt className="text-muted-foreground">Status</dt>
									<dd>
										{asset.syncStatus === "synced" ?
											<span className="text-emerald-500 font-medium flex items-center gap-1">
												● Local Storage
											</span>
										:	<span className="text-amber-500 font-medium flex items-center gap-1">
												○ Peer Placeholder
											</span>
										}
									</dd>
								</div>
								<div className="flex justify-between items-center py-1">
									<dt className="text-muted-foreground">Modified</dt>
									<dd className="text-foreground">
										{new Date(asset.modified_at).toLocaleDateString(undefined, {
											month: "short",
											day: "numeric",
											hour: "2-digit",
											minute: "2-digit",
										})}
									</dd>
								</div>
							</dl>
						</div>

						{/* Markdown Embed Snippet */}
						<div className="space-y-2">
							<div className="flex items-center justify-between">
								<span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
									Markdown Embed
								</span>
								<Button
									variant="ghost"
									size="sm"
									onPress={handleCopyMarkdown}
									className="h-6 px-2 text-[11px] gap-1 text-primary hover:text-primary"
								>
									{copiedMarkdown ?
										<Check className="size-3 text-emerald-400" />
									:	<Copy className="size-3" />}
									{copiedMarkdown ? "Copied" : "Copy"}
								</Button>
							</div>
							<div className="p-2.5 rounded-md bg-muted/60 border border-border/60 font-mono text-xs break-all select-all text-muted-foreground">
								{markdownSnippet}
							</div>
							<p className="text-[11px] text-muted-foreground">
								Paste directly into BlockNote or Markdown notes to embed this
								asset.
							</p>
						</div>

						{/* Relative Path */}
						<div className="space-y-2">
							<div className="flex items-center justify-between">
								<span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
									Relative Path
								</span>
								<Button
									variant="ghost"
									size="sm"
									onPress={handleCopyPath}
									className="h-6 px-2 text-[11px] gap-1 text-primary hover:text-primary"
								>
									{copiedPath ?
										<Check className="size-3 text-emerald-400" />
									:	<Copy className="size-3" />}
									{copiedPath ? "Copied" : "Copy"}
								</Button>
							</div>
							<div className="p-2 rounded-md bg-muted/40 font-mono text-xs text-foreground/80 break-all select-all">
								{cleanRelPath}
							</div>
						</div>
					</div>
				</div>
			</div>
		</Dialog>
	);
}
