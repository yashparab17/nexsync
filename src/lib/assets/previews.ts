// Small pictures of things that are not pictures: the first page of a PDF, a frame from a video, the start of a text
// file. They are made once, in the background, and used as tiles in the assets mosaic.

export type TilePreview =
	| { kind: "image"; src: string; width: number; height: number }
	| { kind: "text"; text: string };

// Files bigger than this are not read just to make a tile
export const MAX_PREVIEW_BYTES: Record<"pdf" | "video" | "text", number> = { pdf: 12_000_000, video: 40_000_000, text: 2_000_000 };

const TEXT_TYPES = new Set(["txt", "md", "csv", "json", "log", "xml", "yml", "yaml", "toml", "html", "css", "js", "ts"]);
const THUMB_WIDTH = 480;

export function previewKind(name: string): "pdf" | "video" | "text" | null {
	const ext = name.split(".").pop()?.toLowerCase() ?? "";
	if (ext === "pdf") return "pdf";
	if (["mp4", "webm", "mov", "mkv", "m4v", "ogv"].includes(ext)) return "video";
	return TEXT_TYPES.has(ext) ? "text" : null;
}

// The browser decodes a data address natively, far faster than looping over a big file's characters
export async function base64Bytes(base64: string): Promise<Uint8Array> {
	try {
		return new Uint8Array(await (await fetch(`data:application/octet-stream;base64,${base64}`)).arrayBuffer());
	} catch {
		return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
	}
}

const bytesOf = (base64: string) => Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));

// The first lines of a text file
export function textSnippet(base64: string, maxChars = 600): string {
	// Only the start is decoded, so a big file costs nothing extra
	const head = bytesOf(base64.slice(0, Math.ceil((maxChars * 4) / 3) + 8));
	return new TextDecoder().decode(head).slice(0, maxChars);
}

// The PDF reader, loaded the first time one is needed. The legacy build runs on the older web views some systems have.
export async function loadPdfjs() {
	const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
	pdfjs.GlobalWorkerOptions.workerSrc = (await import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url")).default;
	return pdfjs;
}

// The first page of a PDF, drawn small
export async function pdfFirstPage(base64: string): Promise<TilePreview> {
	const pdfjs = await loadPdfjs();
	const task = pdfjs.getDocument({ data: await base64Bytes(base64) });
	const doc = await task.promise;
	try {
		const page = await doc.getPage(1);
		const natural = page.getViewport({ scale: 1 });
		const viewport = page.getViewport({ scale: THUMB_WIDTH / natural.width });
		const canvas = document.createElement("canvas");
		canvas.width = Math.floor(viewport.width);
		canvas.height = Math.floor(viewport.height);
		await page.render({ canvas, canvasContext: canvas.getContext("2d")!, viewport }).promise;
		return { kind: "image", src: canvas.toDataURL("image/jpeg", 0.8), width: Math.round(natural.width), height: Math.round(natural.height) };
	} finally {
		void task.destroy();
	}
}

// A frame from near the start of a video
export function videoFrame(dataUrl: string): Promise<TilePreview> {
	return new Promise((resolve, reject) => {
		const video = document.createElement("video");
		video.muted = true;
		video.preload = "auto";
		video.playsInline = true;
		const fail = () => reject(new Error("The video could not be read."));
		const timer = setTimeout(fail, 8000);
		video.onerror = fail;
		video.onloadeddata = () => {
			video.currentTime = Math.min(1, (video.duration || 2) / 10);
		};
		video.onseeked = () => {
			clearTimeout(timer);
			const { videoWidth: w, videoHeight: h } = video;
			if (!w || !h) return fail();
			const canvas = document.createElement("canvas");
			canvas.width = Math.min(THUMB_WIDTH, w);
			canvas.height = Math.round((canvas.width * h) / w);
			canvas.getContext("2d")!.drawImage(video, 0, 0, canvas.width, canvas.height);
			resolve({ kind: "image", src: canvas.toDataURL("image/jpeg", 0.8), width: w, height: h });
			video.removeAttribute("src");
			video.load();
		};
		video.src = dataUrl;
	});
}
