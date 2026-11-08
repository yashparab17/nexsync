// Sheets: spreadsheet files of the workspace (.xlsx and the formats it reads) opened as live shared workbooks. What people type and how
// cells look is kept in a shared document; the cells' answers are worked out by the spreadsheet engine from that text, on every device alike.

import { useEffect, useState } from "react";

import Loading from "@/components/Loading";
import { EmptyState, Page } from "@/components/layout/Page";
import { Notice } from "@/components/ui/notice";
import SheetWorkspace from "@/features/office/sheets/components/SheetWorkspace";
import type { SheetIn } from "@/features/office/sheets/lib/sheet";
import { OfficeFileDialogs, OfficeFileList } from "@/features/office/shared/OfficeFileList";
import { SHEET_TEMPLATES } from "@/features/office/shared/templates";
import { type OfficeKind, useOfficeFiles } from "@/features/office/shared/useOfficeFiles";
import { useCollabDoc } from "@/hooks/useCollabDoc";
import { useMyName } from "@/hooks/useMyName";
import { isSpreadsheet } from "@/lib/editor/languages";
import { sheetOpen, sheetSave } from "@/features/office/lib/api";
import { errorText } from "@/lib/utils";
import { LAYOUT } from "@/lib/workspaceLayout";
import { useWorkspace } from "@/store/workspace/WorkspaceContext";

const KIND: OfficeKind = {
	page: "sheets",
	folder: LAYOUT.sheets,
	matches: isSpreadsheet,
	ext: "xlsx",
	noun: "workbook",
	plural: "workbooks",
	accept: ".xlsx,.xlsm,.xlsb,.xls,.ods,.csv,.tsv",
	empty: "No workbooks yet. Make one, or add an .xlsx, .xls, .ods or .csv file.",
	reject: "Choose a spreadsheet file (.xlsx, .xls, .ods, .csv).",
};

export default function SheetsPage() {
	const { workspace } = useWorkspace();
	const workspacePath = workspace?.path ?? "";
	const author = useMyName();
	const files = useOfficeFiles({
		kind: KIND,
		make: (path, _name, template) => sheetSave(workspacePath, path, [{ name: "Sheet1", cells: (SHEET_TEMPLATES.find((t) => t.id === template) ?? SHEET_TEMPLATES[0]).cells }], "Sheet1"),
	});
	const { selected, notice, isViewer } = files;

	const [opened, setOpened] = useState<{ sheets: SheetIn[]; notes: string[] } | { error: string } | null>(null);

	// The file as the workbook gets it the first time; the shared copy takes over once there is one
	useEffect(() => {
		setOpened(null);
		if (!workspacePath || !selected) return;
		let live = true;
		sheetOpen(workspacePath, selected)
			.then((o) => live && setOpened(o))
			.catch((err) => live && setOpened({ error: errorText(err, "That file could not be opened.") }));
		return () => {
			live = false;
		};
	}, [workspacePath, selected]);

	const collab = useCollabDoc(workspacePath, opened && "sheets" in opened ? (selected ?? undefined) : undefined);

	return (
		<Page>
			<div className="flex min-h-0 flex-1">
				<OfficeFileList kind={KIND} files={files} />

				<main className="flex min-h-0 min-w-0 flex-1 flex-col">
					{notice && (
						<Notice tone={notice.ok ? "success" : "error"} className="px-3 py-2">
							{notice.text}
						</Notice>
					)}
					{!selected ? (
						<EmptyState art="sheets" title="Sheets">
							Open a spreadsheet as a workbook everyone in the workspace edits together: type a value or a formula, and everyone sees the answers. It reads .xlsx, .xls, .ods and .csv files, keeps fonts, colours, number formats and column widths, and saves copies as .xlsx, .csv or PDF.
						</EmptyState>
					) : !opened ? (
						<Loading className="h-48" />
					) : "error" in opened ? (
						<Notice className="m-6 max-w-md p-3">{opened.error}</Notice>
					) : collab ? (
						<SheetWorkspace key={selected} collab={collab} opened={opened} name={selected.split("/").pop() ?? ""} rel={selected} workspacePath={workspacePath} author={author} readOnly={isViewer} />
					) : (
						<Loading className="h-48" />
					)}
				</main>
			</div>

			<OfficeFileDialogs kind={KIND} files={files} templates={SHEET_TEMPLATES} />
		</Page>
	);
}
