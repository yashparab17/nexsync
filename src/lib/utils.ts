import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

// Combines clsx conditional classes and merges conflicting Tailwind classes
export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

// Map a file extension to a MIME type; falls back to `fallback` for unknown extensions
export function getMimeType(
	fileName: string,
	fallback = "application/octet-stream",
): string {
	const ext = fileName.split(".").pop()?.toLowerCase() || "";
	const types: Record<string, string> = {
		png: "image/png",
		jpg: "image/jpeg",
		jpeg: "image/jpeg",
		gif: "image/gif",
		webp: "image/webp",
		svg: "image/svg+xml",
		bmp: "image/bmp",
		ico: "image/x-icon",
		mp4: "video/mp4",
		webm: "video/webm",
		mov: "video/quicktime",
		mp3: "audio/mpeg",
		wav: "audio/wav",
		ogg: "audio/ogg",
		m4a: "audio/aac",
		aac: "audio/aac",
		pdf: "application/pdf",
		txt: "text/plain",
		json: "application/json",
	};
	return types[ext] || fallback;
}

// Format bytes into human-readable size
export function formatBytes(bytes: number): string {
	if (bytes === 0) return "0 Bytes";
	const k = 1024;
	const sizes = ["Bytes", "KB", "MB", "GB"];
	const i = Math.floor(Math.log(bytes) / Math.log(k));
	return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

// Extract a human-readable message from a caught value
export function errorText(err: unknown, fallback: string): string {
	return err instanceof Error ? err.message
		: typeof err === "string" ? err
		: fallback;
}
