import { useEffect, useRef, useState, useCallback } from "react";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";

import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";

import { useTheme } from "@/hooks/useTheme";
import { useWorkspace } from "@/store/workspace/WorkspaceContext";
import { readWorkspaceBinaryFile, writeWorkspaceBinaryFile } from "@/lib/tauri";

interface BlockNoteEditorProps {
	initialMarkdown: string;
	onChange: (markdown: string) => void;
	readOnly?: boolean;
}

// Map file extension to image/media MIME type
function getMimeType(fileName: string): string {
	const ext = fileName.split(".").pop()?.toLowerCase() || "png";
	switch (ext) {
		case "svg":
			return "image/svg+xml";
		case "jpg":
		case "jpeg":
			return "image/jpeg";
		case "gif":
			return "image/gif";
		case "webp":
			return "image/webp";
		case "bmp":
			return "image/bmp";
		case "ico":
			return "image/x-icon";
		case "mp4":
			return "video/mp4";
		case "webm":
			return "video/webm";
		case "mp3":
			return "audio/mpeg";
		case "wav":
			return "audio/wav";
		case "pdf":
			return "application/pdf";
		default:
			return "image/png";
	}
}

// Rich-text Markdown block editor powered by BlockNote
export default function BlockNoteEditor({
	initialMarkdown,
	onChange,
	readOnly = false,
}: BlockNoteEditorProps) {
	const { isDark } = useTheme();
	const { workspace } = useWorkspace();
	const workspacePath = workspace?.path;

	const isUpdatingRef = useRef(false);
	const lastMarkdownRef = useRef(initialMarkdown);
	const [isReady, setIsReady] = useState(false);

	// In-memory cache for resolved binary data URLs so they load instantly
	const urlCacheRef = useRef<Map<string, string>>(new Map());

	// Resolve workspace-relative media paths (e.g. assets/eevee.png or /assets/eevee.png) into viewable data URLs
	const resolveFileUrl = useCallback(
		async (url: string): Promise<string> => {
			if (
				!url ||
				url.startsWith("http://") ||
				url.startsWith("https://") ||
				url.startsWith("data:") ||
				url.startsWith("blob:")
			) {
				return url;
			}

			if (urlCacheRef.current.has(url)) {
				return urlCacheRef.current.get(url)!;
			}

			if (!workspacePath) return url;

			try {
				const cleanRelPath = url.replace(/^\/+/, "");
				const base64 = await readWorkspaceBinaryFile(
					workspacePath,
					cleanRelPath,
				);
				const mime = getMimeType(cleanRelPath);
				const dataUrl = `data:${mime};base64,${base64}`;
				urlCacheRef.current.set(url, dataUrl);
				return dataUrl;
			} catch (err) {
				console.error("Failed to resolve workspace image url:", url, err);
				return url;
			}
		},
		[workspacePath],
	);

	// Handle direct image drop / paste into BlockNote
	const uploadFile = useCallback(
		async (file: File): Promise<string> => {
			if (!workspacePath) return "";
			try {
				const base64Data = await new Promise<string>((resolve, reject) => {
					const reader = new FileReader();
					reader.onload = () => {
						const result = reader.result as string;
						const base64 = result.includes(",") ? result.split(",")[1] : result;
						resolve(base64);
					};
					reader.onerror = reject;
					reader.readAsDataURL(file);
				});

				const sanitizedName = file.name.replace(/[^\w.-]/g, "_");
				await writeWorkspaceBinaryFile(
					workspacePath,
					`assets/${sanitizedName}`,
					base64Data,
				);
				const relUrl = `assets/${sanitizedName}`;
				const mime = file.type || getMimeType(sanitizedName);
				urlCacheRef.current.set(relUrl, `data:${mime};base64,${base64Data}`);
				return relUrl;
			} catch (err) {
				console.error("Failed to upload image into workspace assets:", err);
				return "";
			}
		},
		[workspacePath],
	);

	// Initialize BlockNote editor instance with custom file resolver and upload handler
	const editor = useCreateBlockNote(
		{
			resolveFileUrl,
			uploadFile,
		},
		[resolveFileUrl, uploadFile],
	);

	// Load initial Markdown blocks into editor once ready
	useEffect(() => {
		async function loadInitialMarkdown() {
			if (!editor) return;
			try {
				isUpdatingRef.current = true;
				if (initialMarkdown.trim()) {
					const blocks = await editor.tryParseMarkdownToBlocks(initialMarkdown);
					editor.replaceBlocks(editor.document, blocks);
				} else {
					editor.replaceBlocks(editor.document, [
						{
							type: "paragraph",
							content: [],
						},
					]);
				}
				lastMarkdownRef.current = initialMarkdown;
				setIsReady(true);
			} catch (err) {
				console.error("Failed to parse markdown to blocks:", err);
				setIsReady(true);
			} finally {
				isUpdatingRef.current = false;
			}
		}

		loadInitialMarkdown();
	}, [editor, initialMarkdown]);

	// Handle block changes and serialize back to markdown
	const handleChange = async () => {
		if (!editor || isUpdatingRef.current) return;
		try {
			const markdown = await editor.blocksToMarkdownLossy(editor.document);
			if (markdown !== lastMarkdownRef.current) {
				lastMarkdownRef.current = markdown;
				onChange(markdown);
			}
		} catch (err) {
			console.error("Failed to serialize blocks to markdown:", err);
		}
	};

	return (
		<div className="h-full w-full overflow-y-auto rounded-lg border bg-card p-4 transition-colors">
			{!isReady ? (
				<div className="flex h-48 items-center justify-center">
					<p className="text-xs uppercase tracking-widest text-muted-foreground animate-pulse">
						Loading Rich Notes Editor…
					</p>
				</div>
			) : (
				<BlockNoteView
					editor={editor}
					theme={isDark ? "dark" : "light"}
					editable={!readOnly}
					onChange={handleChange}
					className="min-h-[400px] text-sm"
				/>
			)}
		</div>
	);
}
