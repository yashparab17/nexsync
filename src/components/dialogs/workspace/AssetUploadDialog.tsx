import { useState, useRef } from "react";
import { Check, FileUp, Loader2, UploadCloud, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";

import { writeWorkspaceBinaryFile } from "@/lib/tauri";

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
				const base64Data = await new Promise<string>((resolve, reject) => {
					const reader = new FileReader();
					reader.onload = () => {
						const result = reader.result as string;
						// Strip prefix like data:image/png;base64,
						const base64 = result.includes(",") ? result.split(",")[1] : result;
						resolve(base64);
					};
					reader.onerror = (err) => reject(err);
					reader.readAsDataURL(file);
				});

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
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<UploadCloud className="size-5 text-primary" />
						Upload Workspace Assets
					</DialogTitle>
					<DialogDescription>
						Import images, media, or documents directly into your local{" "}
						<code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono text-foreground">
							assets/
						</code>{" "}
						directory.
					</DialogDescription>
				</DialogHeader>

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
						className={`border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center gap-3 text-center cursor-pointer transition-all ${
							dragOver ?
								"border-primary bg-primary/10 scale-[0.99]"
							:	"border-border hover:border-primary/60 hover:bg-muted/30"
						}`}
					>
						<input
							type="file"
							ref={fileInputRef}
							multiple
							onChange={(e) => handleFileSelect(e.target.files)}
							className="hidden"
						/>
						<div className="p-3 rounded-full bg-primary/10 text-primary">
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
									className="flex items-center justify-between px-3 py-1.5 rounded-md bg-muted/40 text-xs border border-border/50"
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
											className="text-muted-foreground hover:text-destructive p-0.5 rounded cursor-pointer"
										>
											<X className="size-3.5" />
										</button>
									</div>
								</div>
							))}
						</div>
					)}

					{error && (
						<div className="p-3 rounded-md bg-destructive/10 border border-destructive/20 text-destructive text-xs font-mono">
							{error}
						</div>
					)}

					{successCount !== null && (
						<div className="p-3 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs flex items-center gap-2">
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
