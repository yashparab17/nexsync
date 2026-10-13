import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Check, FileUp, UploadCloud, X } from "@/components/animate-icons";

import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter, DialogHeading } from "@/components/ui/dialog";

import { writeWorkspaceBinaryFile } from "@/lib/tauri";
import { canDownscale, fileToBase64, MIN_SCALE, readImageSize, scaledSize } from "@/lib/assets/uploadScale";
import { safeUploadName } from "@/lib/validation";
import { formatBytes } from "@/lib/utils";

interface AssetUploadDialogProps {
	workspacePath: string;
	isOpen: boolean;
	onClose: () => void;
	onUploaded: () => void;
}

interface Picked {
	file: File;
	// Where the file's picture preview comes from, and how big the picture is, for pictures that can be resized
	preview: string | null;
	size: { width: number; height: number } | null;
}

export default function AssetUploadDialog({ workspacePath, isOpen, onClose, onUploaded }: AssetUploadDialogProps) {
	const fileInputRef = useRef<HTMLInputElement>(null);
	const [dragOver, setDragOver] = useState(false);
	const [picked, setPicked] = useState<Picked[]>([]);
	const [percent, setPercent] = useState(100);
	const [uploading, setUploading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [successCount, setSuccessCount] = useState<number | null>(null);

	// Previews are object URLs, which are released when the files change or the dialog closes
	useEffect(() => () => picked.forEach((p) => p.preview && URL.revokeObjectURL(p.preview)), [picked]);

	const choose = async (files: File[]) => {
		if (files.length === 0) return;
		setError(null);
		setSuccessCount(null);
		const next = await Promise.all(
			files.map(async (file): Promise<Picked> => {
				const isPicture = file.type.startsWith("image/");
				return { file, preview: isPicture ? URL.createObjectURL(file) : null, size: canDownscale(file.name) ? await readImageSize(file) : null };
			}),
		);
		setPicked(next);
	};

	const resizable = picked.filter((p) => canDownscale(p.file.name));

	const handleUpload = async () => {
		if (picked.length === 0 || !workspacePath) return;
		setUploading(true);
		setError(null);
		try {
			let uploaded = 0;
			for (const { file } of picked) {
				const base64Data = await fileToBase64(file, percent);
				const sanitizedName = safeUploadName(file.name);
				await writeWorkspaceBinaryFile(workspacePath, `assets/${sanitizedName}`, base64Data);
				uploaded++;
			}
			setSuccessCount(uploaded);
			setTimeout(() => {
				onUploaded();
				onClose();
				setPicked([]);
				setSuccessCount(null);
			}, 1000);
		} catch (err) {
			console.error("Failed to upload asset:", err);
			setError(String(err));
		} finally {
			setUploading(false);
		}
	};

	return (
		<Dialog isOpen={isOpen} onOpenChange={(open) => !open && onClose()} className="max-w-xl overflow-x-hidden p-6">
			<div className="min-w-0 space-y-5">
				<DialogHeading
					icon={<UploadCloud className="size-6" />}
					title="Upload assets"
				/>

				{/* Drop zone */}
				<div
					onDragOver={(e) => {
						e.preventDefault();
						setDragOver(true);
					}}
					onDragLeave={() => setDragOver(false)}
					onDrop={(e) => {
						e.preventDefault();
						setDragOver(false);
						void choose(Array.from(e.dataTransfer.files));
					}}
					className={`flex flex-col items-center justify-center gap-2 border-2 border-dashed p-6 text-center transition-colors ${dragOver ? "border-primary bg-primary/10" : "border-border hover:border-primary/60 hover:bg-muted/30"}`}
				>
					<input
						type="file"
						aria-label="Choose files to upload"
						ref={fileInputRef}
						multiple
						onChange={(e) => void choose(Array.from(e.target.files ?? []))}
						className="sr-only"
					/>
					<FileUp className="size-7 text-primary" />
					<p className="text-sm font-medium">Drop files here, or</p>
					<Button variant="outline" size="sm" onPress={() => fileInputRef.current?.click()}>
						Choose Files
					</Button>
				</div>

				{/* Chosen files */}
				{picked.length > 0 && (
					<ul className="max-h-48 min-w-0 space-y-1 overflow-x-hidden overflow-y-auto" aria-label="Files to upload">
						{picked.map((p, i) => {
							const after = p.size ? scaledSize(p.size.width, p.size.height, percent) : null;
							return (
								<li key={`${p.file.name}-${i}`} className="flex min-w-0 items-center gap-3 border bg-muted/30 p-2 text-sm">
									{p.preview ? <img src={p.preview} alt="" className="size-10 shrink-0 bg-muted object-cover" /> : <span className="flex size-10 shrink-0 items-center justify-center bg-muted font-mono text-xs text-muted-foreground">{p.file.name.split(".").pop()?.toUpperCase()}</span>}
									<span className="min-w-0 flex-1">
										<span className="block truncate font-medium" title={p.file.name}>{p.file.name}</span>
										<span className="block truncate font-mono text-xs text-muted-foreground">
											{formatBytes(p.file.size)}
											{p.size && ` · ${p.size.width}×${p.size.height}`}
											{p.size && after && percent < 100 && ` → ${after.width}×${after.height}`}
										</span>
									</span>
									<button type="button" aria-label={`Remove ${p.file.name}`} onClick={() => setPicked((prev) => prev.filter((_, j) => j !== i))} className="flex size-7 shrink-0 items-center justify-center text-muted-foreground outline-none hover:bg-muted hover:text-destructive focus-visible:bg-muted">
										<X className="size-4" />
									</button>
								</li>
							);
						})}
					</ul>
				)}

				{/* Picture size: only offered when a picture that can be resized was chosen */}
				{resizable.length > 0 && (
					<div className="space-y-2">
						<div className="flex items-baseline justify-between">
							<label htmlFor="upload-size" className="text-sm font-medium">
								Picture size
							</label>
							<output htmlFor="upload-size" className="font-mono text-xs tabular-nums">
								{percent}%
							</output>
						</div>
						<input
							id="upload-size"
							type="range"
							min={MIN_SCALE}
							max={100}
							step={5}
							value={percent}
							onChange={(e) => setPercent(Number(e.target.value))}
							className="h-2 w-full cursor-pointer accent-primary"
						/>
						<div className="flex justify-between font-mono text-xs text-muted-foreground">
							<span>{MIN_SCALE}%</span>
							<span>Original</span>
						</div>
						<p className="text-xs text-muted-foreground">
							{percent === 100
									? "Pictures are saved at their original size."
									: `${resizable.length} ${resizable.length === 1 ? "picture is" : "pictures are"} saved at ${percent}% of the width and height. This changes the file. Larger pictures are drawn at half size in Assets anyway, without being changed.`}
						</p>
					</div>
				)}

				{error && <div className="border border-destructive/30 bg-destructive/10 p-3 font-mono text-xs text-destructive">{error}</div>}
				{successCount !== null && (
					<div role="status" className="flex items-center gap-2 text-sm text-success">
						<Check className="size-4" />
						Uploaded {successCount} {successCount === 1 ? "asset" : "assets"}.
					</div>
				)}

				<DialogFooter>
					<Button variant="outline" onPress={onClose} isDisabled={uploading}>
						Cancel
					</Button>
					<Button onPress={handleUpload} isDisabled={picked.length === 0 || uploading}>
						{uploading ? <Loader2 className="size-4 animate-spin" /> : <UploadCloud data-icon="inline-start" className="size-4" />}
						{uploading ? "Uploading…" : picked.length ? `Upload ${picked.length}` : "Upload"}
					</Button>
				</DialogFooter>
			</div>
		</Dialog>
	);
}
