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
import { getMimeType, formatBytes } from "@/lib/utils";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import type { AssetItem } from "@/types/workspace";
import Loading from "@/components/Loading";

interface AssetPreviewModalProps {
	asset: AssetItem | null;
	workspacePath: string;
	isOpen: boolean;
	onClose: () => void;
	onDownloadLazy?: (asset: AssetItem) => Promise<void>;
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
	const { copiedKey, copy } = useCopyToClipboard();
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

	const handleCopyMarkdown = () => copy(markdownSnippet, "markdown");

	const handleCopyPath = () => copy(cleanRelPath, "path");

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
			showCloseButton={false}
			className="h-[85vh] w-[95vw] gap-0 overflow-hidden p-0 sm:max-w-6xl grid-rows-[minmax(0,1fr)] [&>*]:grid-rows-[minmax(0,1fr)]"
		>
			<div className="flex h-full min-h-0 flex-col overflow-hidden">
				{/* Top Bar */}
				<DialogHeader className="flex flex-row items-center justify-between shrink-0 px-5 py-3 border-b bg-muted/20">
					<div className="flex items-center gap-3">
						<div className="p-2 rounded-none bg-primary/10 text-primary">
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
							aria-label="Close preview"
							className="size-8"
						>
							<X className="size-4" />
						</Button>
					</div>
				</DialogHeader>

				{/* Preview Workspace Area */}
				<div className="flex min-h-0 flex-1 flex-col md:flex-row overflow-hidden">
					{/* Main Viewer */}
					<div className="relative flex min-h-0 min-w-0 flex-1 overflow-auto bg-muted/40 p-4">
						{loading && (
							<Loading className="m-auto" />
						)}

						{error && (
							<div className="m-auto flex max-w-md flex-col items-center gap-2 p-6 text-center text-destructive">
								<p className="text-sm font-semibold">
									Failed to load asset preview
								</p>
								<p className="text-xs font-mono text-destructive/80">
									{error}
								</p>
							</div>
						)}

						{asset.syncStatus === "remote_placeholder" && (
							<div className="m-auto flex max-w-md flex-col items-center gap-4 border bg-card p-8 text-center">
								<div className="p-3 rounded-none bg-amber-500/10 text-amber-500 border border-amber-500/20">
									<Sparkles className="size-8" />
								</div>
								<div>
									<h4 className="font-semibold text-foreground">
										Not downloaded yet
									</h4>
									<p className="text-xs text-muted-foreground mt-1">
										This file is part of the workspace, but it hasn't been downloaded to this device yet.
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
									{isSyncing ? "Downloading…" : "Download"}
								</Button>
							</div>
						)}

						{!loading && !error && dataUrl && (
							<>
								{/* Image Preview */}
								{isImage && (
									<div className="flex min-h-full min-w-full">
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
											className={`m-auto bg-background shadow-md ${
												isFitToScreen ?
													"max-h-full max-w-full object-contain"
												:	"max-w-none"
											}`}
										/>
										<button
											onClick={() => setIsFitToScreen(!isFitToScreen)}
											title={isFitToScreen ? "Original Size" : "Fit to Screen"}
											className="absolute right-4 bottom-4 z-10 flex cursor-pointer items-center gap-1 border bg-background p-2 text-xs text-foreground shadow-sm hover:bg-muted"
										>
											{isFitToScreen ?
												<Maximize2 className="size-3.5" />
											:	<Minimize2 className="size-3.5" />}
										</button>
									</div>
								)}

								{/* Video Preview */}
								{isVideo && (
									<div className="m-auto flex w-full max-w-3xl flex-col items-center">
										<video
											src={dataUrl}
											controls
											autoPlay={false}
											className="max-h-full w-full border bg-black"
										/>
									</div>
								)}

								{/* Audio Preview */}
								{isAudio && (
									<div className="m-auto flex w-full max-w-md flex-col items-center gap-4 border bg-card p-6">
										<div className="p-4 rounded-none bg-primary/10 text-primary animate-pulse">
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
										className="h-full min-h-[60vh] w-full border bg-white"
									/>
								)}

								{/* Generic Binary / Other */}
								{!isImage && !isVideo && !isAudio && !isPdf && (
									<div className="m-auto flex flex-col items-center gap-3 border bg-card p-8 text-center">
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
					<div className="flex max-h-[40%] w-full shrink-0 flex-col gap-5 overflow-y-auto border-t bg-card p-5 md:max-h-none md:w-72 md:border-t-0 md:border-l">
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
												○ Not downloaded
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
									{copiedKey === "markdown" ?
										<Check className="size-3 text-emerald-400" />
									:	<Copy className="size-3" />}
									{copiedKey === "markdown" ? "Copied" : "Copy"}
								</Button>
							</div>
							<div className="p-2.5 rounded-none bg-muted/60 border border-border/60 font-mono text-xs break-all select-all text-muted-foreground">
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
									{copiedKey === "path" ?
										<Check className="size-3 text-emerald-400" />
									:	<Copy className="size-3" />}
									{copiedKey === "path" ? "Copied" : "Copy"}
								</Button>
							</div>
							<div className="p-2 rounded-none bg-muted/40 font-mono text-xs text-foreground/80 break-all select-all">
								{cleanRelPath}
							</div>
						</div>
					</div>
				</div>
			</div>
		</Dialog>
	);
}
