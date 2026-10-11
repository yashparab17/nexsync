// Saving a picture smaller when it is uploaded. Only pictures made of pixels are resized; animated GIFs, vector SVGs
// and every other kind of file are stored as they are.

const RESIZABLE: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", bmp: "image/png" };

export const MIN_SCALE = 10;

export const canDownscale = (fileName: string): boolean => (fileName.split(".").pop()?.toLowerCase() ?? "") in RESIZABLE;

// The size a picture ends up at for a scale of 10 to 100 percent
export function scaledSize(width: number, height: number, percent: number): { width: number; height: number } {
	const p = Math.min(100, Math.max(MIN_SCALE, percent)) / 100;
	return { width: Math.max(1, Math.round(width * p)), height: Math.max(1, Math.round(height * p)) };
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

// How big a picture is, or null when it cannot be read
export async function readImageSize(file: Blob): Promise<{ width: number; height: number } | null> {
	try {
		const bitmap = await createImageBitmap(file);
		const size = { width: bitmap.width, height: bitmap.height };
		bitmap.close();
		return size;
	} catch {
		return null;
	}
}

// The file as base64, resized first when asked and possible. A picture that cannot be decoded is stored as it is.
export async function fileToBase64(file: File, percent: number): Promise<string> {
	const type = RESIZABLE[file.name.split(".").pop()?.toLowerCase() ?? ""];
	if (percent >= 100 || !type) return readAsBase64(file);
	try {
		const bitmap = await createImageBitmap(file);
		const { width, height } = scaledSize(bitmap.width, bitmap.height, percent);
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
