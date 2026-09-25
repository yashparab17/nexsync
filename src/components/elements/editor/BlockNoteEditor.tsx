import { useEffect, useRef, useState, useCallback } from "react";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import { withCollaboration } from "@blocknote/core/yjs";

import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";

import { useThemeContext } from "@/store/ThemeContext";
import { useWorkspace } from "@/store/workspace/WorkspaceContext";
import { readWorkspaceBinaryFile, writeWorkspaceBinaryFile } from "@/lib/tauri";
import { getMimeType } from "@/lib/utils";
import { colorForName } from "@/lib/collabColor";
import { useSeedOnce } from "@/hooks/useSeedOnce";
import type { CollabDoc } from "@/hooks/useCollabDoc";

interface BlockNoteEditorProps {
	initialMarkdown: string;
	onChange: (markdown: string) => void;
	readOnly?: boolean;
	// Live P2P-synced document; when present the editor mirrors this doc's
	// "blocknote" XML fragment instead of a one-shot markdown parse
	collab?: CollabDoc | null;
	userName?: string;
}

// Rich-text Markdown block editor powered by BlockNote, with optional live Yjs collaboration
export default function BlockNoteEditor({
	initialMarkdown,
	onChange,
	readOnly = false,
	collab = null,
	userName = "You",
}: BlockNoteEditorProps) {
	const { isDark } = useThemeContext();
	const { workspace } = useWorkspace();
	const workspacePath = workspace?.path;

	const isUpdatingRef = useRef(false);
	const lastMarkdownRef = useRef(initialMarkdown);
	const [localReady, setLocalReady] = useState(false);

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
				const mime = getMimeType(cleanRelPath, "image/png");
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
				const mime = file.type || getMimeType(sanitizedName, "image/png");
				urlCacheRef.current.set(relUrl, `data:${mime};base64,${base64Data}`);
				return relUrl;
			} catch (err) {
				console.error("Failed to upload image into workspace assets:", err);
				return "";
			}
		},
		[workspacePath],
	);

	// Initialize BlockNote editor instance, wired to the live Yjs doc when collaborating
	const editor = useCreateBlockNote(
		collab
			? withCollaboration({
					resolveFileUrl,
					uploadFile,
					collaboration: {
						fragment: collab.doc.getXmlFragment("blocknote"),
						user: { name: userName, color: colorForName(userName) },
						provider: { awareness: collab.awareness },
					},
				})
			: { resolveFileUrl, uploadFile },
		[resolveFileUrl, uploadFile, collab?.doc],
	);

	// Non-collaborative mode: load the initial Markdown blocks once
	useEffect(() => {
		if (collab) return;
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
				setLocalReady(true);
			} catch (err) {
				console.error("Failed to parse markdown to blocks:", err);
				setLocalReady(true);
			} finally {
				isUpdatingRef.current = false;
			}
		}

		loadInitialMarkdown();
	}, [editor, initialMarkdown, collab]);

	// Collaborative mode: seed the shared fragment from on-disk content the first time it's ever opened
	useSeedOnce(
		!!collab?.synced,
		() => {
			if (!collab || !editor) return;
			const fragment = collab.doc.getXmlFragment("blocknote");
			if (fragment.length > 0 || !initialMarkdown.trim()) return;

			(async () => {
				try {
					isUpdatingRef.current = true;
					const blocks = await editor.tryParseMarkdownToBlocks(initialMarkdown);
					editor.replaceBlocks(editor.document, blocks);
				} catch (err) {
					console.error("Failed to seed collaborative document:", err);
				} finally {
					isUpdatingRef.current = false;
				}
			})();
		},
		[collab, editor, initialMarkdown],
	);

	const isReady = collab ? collab.synced : localReady;

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
