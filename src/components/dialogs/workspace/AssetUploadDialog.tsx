import { useState, useRef } from "react";
import { Loader2 } from "lucide-react";
import { Check, FileUp, UploadCloud, X } from "@/components/animate-icons";

import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter, DialogHeading } from "@/components/ui/dialog";

import { writeWorkspaceBinaryFile } from "@/lib/tauri";
import { canDownscale, fileToBase64, useUploadScale } from "@/lib/assets/uploadScale";
import { cn } from "@/lib/utils";

interface AssetUploadDialogProps {
	workspacePath: string;
	isOpen: boolean;
	onClose: () => void;
	onUploaded: () => void;
}

export default function AssetUploadDialog({
	workspacePath,
	isOpen,
	onClose,
	onUploaded,
}: AssetUploadDialogProps) {
	const fileInputRef = useRef<HTMLInputElement>(null);
	const [dragOver, setDragOver] = useState(false);
	const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
	const [uploading, setUploading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [successCount, setSuccessCount] = useState<number | null>(null);
	const [scale, setScale] = useUploadScale();
	const resizing = scale === 0.5 && selectedFiles.filter((f) => canDownscale(f.name)).length;

	const handleFileSelect = (files: FileList | null) => {
		if (!files || files.length === 0) return;
		setSelectedFiles(Array.from(files));
		setError(null);
		setSuccessCount(null);
	};

	const handleDrop = (e: React.DragEvent) => {
		e.preventDefault();
		setDragOver(false);
		if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
			setSelectedFiles(Array.from(e.dataTransfer.files));
			setError(null);
			setSuccessCount(null);
		}
	};

	const handleUpload = async () => {
		if (selectedFiles.length === 0 || !workspacePath) return;

		setUploading(true);
		setError(null);

		try {
			let uploaded = 0;
			for (const file of selectedFiles) {
				const base64Data = await fileToBase64(file, scale);

				// Clean filename
				const sanitizedName = file.name.replace(/[^\w.-]/g, "_");
				await writeWorkspaceBinaryFile(
					workspacePath,
					`assets/${sanitizedName}`,
					base64Data,
				);
				uploaded++;
			}

			setSuccessCount(uploaded);
			setTimeout(() => {
				onUploaded();
				onClose();
				setSelectedFiles([]);
				setSuccessCount(null);
			}, 1200);
		} catch (err) {
			console.error("Failed to upload asset:", err);
			setError(String(err));
		} finally {
			setUploading(false);
		}
	};

	const removeFile = (index: number) => {
		setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
	};

	return (
		<Dialog
			isOpen={isOpen}
			onOpenChange={(open) => !open && onClose()}
			className="max-w-lg p-6 bg-card border-border"
		>
			<div className="space-y-4">
				<DialogHeading icon={<UploadCloud className="size-6" />} title="Upload assets" description={<>Import images, media, or documents directly into your local{" "}
						<code className="bg-muted px-1.5 py-0.5 rounded-none text-xs font-mono text-foreground">
							assets/
						</code>{" "}
						directory.</>} />

				<div className="space-y-4 my-2">
					{/* Drop Zone */}
					<div
						onDragOver={(e) => {
							e.preventDefault();
							setDragOver(true);
						}}
						onDragLeave={() => setDragOver(false)}
						onDrop={handleDrop}
						onClick={() => fileInputRef.current?.click()}
						className={`border-2 border-dashed rounded-none p-8 flex flex-col items-center justify-center gap-3 text-center cursor-pointer transition-colors ${
							dragOver ?
								"border-primary bg-primary/10 scale-[0.99]"
							:	"border-border hover:border-primary/60 hover:bg-muted/30"
						}`}
					>
						<input
							type="file"
							aria-label="Choose files to upload"
							ref={fileInputRef}
							multiple
							onChange={(e) => handleFileSelect(e.target.files)}
							className="hidden"
						/>
						<div className="p-3 rounded-none bg-primary/10 text-primary">
							<FileUp className="size-6" />
						</div>
						<div>
							<p className="text-sm font-semibold text-foreground">
								Click to browse or drag and drop files here
							</p>
							<p className="text-xs text-muted-foreground mt-1">
								Images (PNG, JPG, WebP, SVG), Audio, Video, PDFs up to 50MB
							</p>
						</div>
					</div>

					{/* Selected Files List */}
					{selectedFiles.length > 0 && (
						<div className="space-y-2 max-h-40 overflow-y-auto">
							<p className="text-xs font-semibold text-muted-foreground">
								Selected Files ({selectedFiles.length}):
							</p>
							{selectedFiles.map((f, idx) => (
								<div
									key={idx}
									className="flex items-center justify-between px-3 py-1.5 rounded-none bg-muted/40 text-xs border border-border/50"
								>
									<span className="truncate max-w-[280px] font-medium text-foreground">
										{f.name}
									</span>
									<div className="flex items-center gap-2">
										<span className="text-muted-foreground font-mono">
											{(f.size / 1024).toFixed(1)} KB
										</span>
										<button
											type="button"
											onClick={(e) => {
												e.stopPropagation();
												removeFile(idx);
											}}
											className="text-muted-foreground hover:text-destructive p-0.5 rounded-none cursor-pointer"
										>
											<X className="size-3.5" />
										</button>
									</div>
								</div>
							))}
						</div>
					)}

					{/* Pictures can be stored at half their width and height */}
					<fieldset className="space-y-2">
						<legend className="text-xs font-semibold text-muted-foreground">Image size</legend>
						<div className="flex items-stretch border" role="radiogroup" aria-label="Image size">
							{([1, 0.5] as const).map((value) => (
								<button
									key={value}
									type="button"
									role="radio"
									aria-checked={scale === value}
									onClick={() => setScale(value)}
									className={cn("flex-1 px-3 py-1.5 text-sm outline-none focus-visible:bg-muted", scale === value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground")}
								>
									{value === 1 ? "Original size" : "Half size (50%)"}
								</button>
							))}
						</div>
						<p className="text-xs text-muted-foreground">
							{resizing ? `${resizing} ${resizing === 1 ? "picture" : "pictures"} will be saved at half the width and height.` : "PNG, JPG and WebP pictures can be saved smaller. GIFs, SVGs and other files are never resized."}
						</p>
					</fieldset>

					{error && (
						<div className="p-3 rounded-none bg-destructive/10 border border-destructive/20 text-destructive text-xs font-mono">
							{error}
						</div>
					)}

					{successCount !== null && (
						<div className="p-3 text-success text-xs flex items-center gap-2">
							<Check className="size-4" />
							Successfully uploaded {successCount} asset
							{successCount > 1 ? "s" : ""}!
						</div>
					)}
				</div>

				<DialogFooter className="flex items-center justify-between gap-2">
					<Button variant="outline" onPress={onClose} isDisabled={uploading}>
						Cancel
					</Button>
					<Button
						onPress={handleUpload}
						isDisabled={selectedFiles.length === 0 || uploading}
						className="gap-2"
					>
						{uploading ?
							<Loader2 className="size-4 animate-spin" />
						:	<UploadCloud className="size-4" />}
						{uploading ? "Uploading…" : `Upload (${selectedFiles.length})`}
					</Button>
				</DialogFooter>
			</div>
		</Dialog>
	);
}
