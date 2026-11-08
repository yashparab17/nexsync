// The list of one kind of Office file in the workspace (documents, workbooks or decks): reading it, choosing one, making a new one,
// adding one from disk and, where a kind allows it, renaming and deleting. The Pages keep what differs: how a file is opened, saved and drawn.

import { useCallback, useEffect, useMemo, useState } from "react";

import { readFileBase64 } from "@/features/assets/lib/uploadScale";
import { useErrorLog } from "@/hooks/useErrorLog";
import { useNewParam } from "@/hooks/useNewParam";
import { useOpenParam } from "@/hooks/useOpenParam";
import { useReportItem } from "@/hooks/usePresence";
import { useSyncedIn } from "@/hooks/useSyncedIn";
import { pushRecent } from "@/lib/recentFiles";
import { deleteWorkspaceItem, renameWorkspaceItem, renameYjsDoc, searchWorkspaceFiles, writeWorkspaceBinaryFile } from "@/lib/tauri";
import { errorText } from "@/lib/utils";
import { safeUploadName, validateFileName } from "@/lib/validation";
import { isIn, placeIn } from "@/lib/workspaceLayout";
import { useIsViewer } from "@/store/p2p/P2PContext";
import { useWorkspace } from "@/store/workspace/WorkspaceContext";

// What sets one kind apart: where its files live, which names are its files and what to call them
export interface OfficeKind {
	// The page it is shown on, for who-is-here dots and the error log
	page: "documents" | "sheets" | "slides";
	folder: string;
	matches: (name: string) => boolean;
	// The extension of a file made new
	ext: string;
	// "workbook", and in the plural "workbooks"
	noun: string;
	plural: string;
	// The file types the add-a-file picker offers
	accept: string;
	// Shown when there are none, and when a file of another kind is chosen
	empty: string;
	reject: string;
}

export interface OfficeFile {
	name: string;
	// Workspace-relative, such as office/documents/report.docx
	rel: string;
}

export const stripSlash = (p: string) => p.replace(/^\/+/, "");

interface Options {
	kind: OfficeKind;
	// Writes a new file at the full path (the name is what the person typed, the template one of the kind's templates)
	make: (fullPath: string, name: string, template: string) => Promise<unknown>;
	// Renaming and deleting, with the right-click menu
	manage?: boolean;
	// Turns the `?open=` value into the file's path, when it carries more than a path
	openParam?: (value: string) => string;
}

export function useOfficeFiles({ kind, make, manage = false, openParam }: Options) {
	const { workspace, addActivityEvent } = useWorkspace();
	const logError = useErrorLog();
	const isViewer = useIsViewer();
	const synced = useSyncedIn(kind.folder);
	const workspacePath = workspace?.path ?? "";

	const [list, setList] = useState<OfficeFile[] | null>(null);
	const [query, setQuery] = useState("");
	const [selected, setSelected] = useState<string | null>(null);
	const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
	const [creating, setCreating] = useState(false);
	const [newName, setNewName] = useState("");
	const [template, setTemplate] = useState("blank");
	const [renaming, setRenaming] = useState<{ file: OfficeFile; value: string; error: string } | null>(null);
	const [deleting, setDeleting] = useState<OfficeFile | null>(null);
	const flash = (ok: boolean, text: string) => setNotice({ ok, text });

	const load = useCallback(() => {
		if (!workspacePath) return;
		searchWorkspaceFiles(workspacePath)
			.then((all) => setList((all ?? []).filter((f) => kind.matches(f.name) && isIn(f.path, kind.folder)).map((f) => ({ name: f.name, rel: stripSlash(f.path) })).sort((a, b) => a.name.localeCompare(b.name))))
			.catch((err) => {
				logError(err, { source: kind.page, workspace: workspacePath });
				setList([]);
			});
	}, [workspacePath, logError, kind]);
	useEffect(load, [load, synced]);

	useOpenParam((v) => setSelected(stripSlash(openParam ? openParam(v) : v)), !!workspacePath);
	useReportItem(selected);
	useNewParam(() => setCreating(true), !!workspacePath && !isViewer);
	useEffect(() => {
		if (workspacePath && selected) pushRecent(workspacePath, selected);
	}, [workspacePath, selected]);
	// A message is about the file it was shown for
	useEffect(() => setNotice(null), [workspacePath, selected]);

	const shown = useMemo(() => (list ?? []).filter((f) => f.name.toLowerCase().includes(query.trim().toLowerCase())), [list, query]);

	const create = async () => {
		const name = newName.trim();
		if (!name || validateFileName(name) || !workspacePath) return;
		const rel = placeIn(kind.folder, `${name}.${kind.ext}`);
		if (list?.some((f) => f.rel.toLowerCase() === rel.toLowerCase())) return flash(false, `A ${kind.noun} with that name exists.`);
		try {
			await make(`${workspacePath.replace(/[\\/]+$/, "")}/${rel}`, name, template);
			setCreating(false);
			setNewName("");
			load();
			setSelected(rel);
		} catch (err) {
			flash(false, errorText(err, `The ${kind.noun} could not be made.`));
		}
	};

	const addFile = async (file: File) => {
		try {
			const name = safeUploadName(file.name);
			if (!kind.matches(name)) return flash(false, kind.reject);
			await writeWorkspaceBinaryFile(workspacePath, placeIn(kind.folder, name), await readFileBase64(file));
			load();
			setSelected(placeIn(kind.folder, name));
		} catch (err) {
			flash(false, errorText(err, "The file could not be added."));
		}
	};

	const startRename = (file: OfficeFile) => setRenaming({ file, value: file.name.replace(/\.[^.]+$/, ""), error: "" });

	const rename = async () => {
		if (!manage || !renaming || !workspacePath) return;
		const { file } = renaming;
		const dot = file.name.lastIndexOf(".");
		let name = renaming.value.trim().replace(/[\\/]/g, "-");
		const problem = name ? validateFileName(name) : "Name is required.";
		if (problem) return setRenaming({ ...renaming, error: problem });
		if (!kind.matches(name)) name += dot > 0 ? file.name.slice(dot) : `.${kind.ext}`;
		if (name === file.name) return setRenaming(null);
		const moved = `${file.rel.slice(0, file.rel.lastIndexOf("/") + 1)}${name}`;
		if (list?.some((f) => f.rel.toLowerCase() === moved.toLowerCase())) return setRenaming({ ...renaming, error: `A ${kind.noun} with that name exists.` });
		try {
			await renameWorkspaceItem(workspacePath, file.rel, name);
			// The shared copy goes with the file, so what people have written in it is not left behind
			await renameYjsDoc(workspacePath, file.rel, moved).catch(() => {});
			if (selected === file.rel) setSelected(moved);
			setRenaming(null);
			load();
		} catch (err) {
			setRenaming({ ...renaming, error: errorText(err, `The ${kind.noun} could not be renamed.`) });
		}
	};

	const remove = async () => {
		if (!manage || isViewer || !workspacePath || !deleting) return;
		const gone = deleting;
		setDeleting(null);
		try {
			await deleteWorkspaceItem(workspacePath, gone.rel);
			addActivityEvent(`Deleted ${kind.noun}`, `Deleted ${kind.noun} ${gone.name}`, undefined, "file");
			if (selected === gone.rel) setSelected(null);
			load();
		} catch (err) {
			flash(false, errorText(err, `The ${kind.noun} could not be deleted.`));
		}
	};

	return {
		manage,
		isViewer,
		workspacePath,
		list,
		shown,
		query,
		setQuery,
		selected,
		setSelected,
		notice,
		flash,
		load,
		creating,
		setCreating,
		newName,
		setNewName,
		template,
		setTemplate,
		create,
		addFile,
		renaming,
		setRenaming,
		startRename,
		rename,
		deleting,
		setDeleting,
		remove,
	};
}

export type OfficeFiles = ReturnType<typeof useOfficeFiles>;
