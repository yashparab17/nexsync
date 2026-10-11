// Uploading an image at its original size or at half the width and height. Only pictures made of pixels are resized;
// animated GIFs, vector SVGs and every other kind of file are stored as they are.

import { useCallback, useState } from "react";

export type UploadScale = 1 | 0.5;

const RESIZABLE: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", bmp: "image/png" };
const KEY = "nexsync.assets.uploadScale";

export const canDownscale = (fileName: string): boolean => (fileName.split(".").pop()?.toLowerCase() ?? "") in RESIZABLE;

// The size chosen last time, kept on this device
export function useUploadScale() {
	const [scale, setState] = useState<UploadScale>(() => {
		try {
			return localStorage.getItem(KEY) === "0.5" ? 0.5 : 1;
		} catch {
			return 1;
		}
	});
	const setScale = useCallback((next: UploadScale) => {
		setState(next);
		try {
			localStorage.setItem(KEY, String(next));
		} catch {
			// Not remembered this time
		}
	}, []);
	return [scale, setScale] as const;
}

const readAsBase64 = (blob: Blob) =>
	new Promise<string>((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => {
			const result = reader.result as string;
			resolve(result.includes(",") ? result.split(",")[1] : result);
		};
		reader.onerror = reject;
		reader.readAsDataURL(blob);
	});

// The file as base64, resized first when asked and possible. A picture that cannot be decoded is stored as it is.
export async function fileToBase64(file: File, scale: UploadScale): Promise<string> {
	const type = RESIZABLE[file.name.split(".").pop()?.toLowerCase() ?? ""];
	if (scale === 1 || !type) return readAsBase64(file);
	try {
		const bitmap = await createImageBitmap(file);
		const width = Math.max(1, Math.round(bitmap.width * scale));
		const height = Math.max(1, Math.round(bitmap.height * scale));
		const canvas = document.createElement("canvas");
		canvas.width = width;
		canvas.height = height;
		const ctx = canvas.getContext("2d");
		if (!ctx) return readAsBase64(file);
		ctx.imageSmoothingQuality = "high";
		ctx.drawImage(bitmap, 0, 0, width, height);
		bitmap.close();
		const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.92));
		return blob ? readAsBase64(blob) : readAsBase64(file);
	} catch {
		return readAsBase64(file);
	}
}
