// The side list of an Office page and the dialogs that go with it (new, and for kinds that allow it, rename and delete).

import { useRef } from "react";

import { FilePlus, FileText, Pencil, Trash2, Upload } from "@/components/animate-icons";
import { useContextMenu } from "@/components/elements/ContextMenu";
import PresenceDots from "@/components/elements/PresenceDots";
import CollapsiblePane, { LIST_WIDTH } from "@/components/layout/CollapsiblePane";
import { EmptyNote, PaneHeader, listRow } from "@/components/layout/Pane";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogFooter, DialogHeading } from "@/components/ui/dialog";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { FieldError } from "@/components/ui/notice";
import { cn } from "@/lib/utils";
import { validateFileName } from "@/lib/validation";
import { useP2P } from "@/store/p2p/P2PContext";

import type { OfficeFile, OfficeFiles, OfficeKind } from "./useOfficeFiles";

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function OfficeFileList({ kind, files }: { kind: OfficeKind; files: OfficeFiles }) {
	const { viewersAt } = useP2P();
	const menu = useContextMenu();
	const fileInput = useRef<HTMLInputElement>(null);
	const { isViewer, manage, list, shown, selected, setSelected } = files;

	const fileMenu = (e: React.MouseEvent, f: OfficeFile) =>
		menu.open(e, [
			{ label: "Open", icon: <FileText className="size-4" />, shortcut: "Enter", onSelect: () => setSelected(f.rel) },
			"separator",
			{ label: "Rename…", icon: <Pencil className="size-4" />, shortcut: "F2", disabled: isViewer, onSelect: () => files.startRename(f) },
			{ label: "Delete…", icon: <Trash2 className="size-4" />, shortcut: "Del", danger: true, disabled: isViewer, onSelect: () => files.setDeleting(f) },
		]);

	return (
		<>
			<CollapsiblePane id={`${kind.page}.list`} defaultWidth={LIST_WIDTH} label={`the list of ${kind.plural}`}>
				<div className="flex shrink-0 flex-col bg-panel">
					<PaneHeader label={`Search ${kind.plural}`} value={files.query} onChange={files.setQuery} placeholder="Search">
						{!isViewer && (
							<>
								<input
									ref={fileInput}
									type="file"
									accept={kind.accept}
									className="hidden"
									onChange={(e) => {
										const f = e.target.files?.[0];
										e.target.value = "";
										if (f) void files.addFile(f);
									}}
								/>
								<IconButton size="xs" label="Add a file" onPress={() => fileInput.current?.click()}>
									<Upload className="size-4" />
								</IconButton>
								<IconButton size="xs" label={`New ${kind.noun}`} onPress={() => files.setCreating(true)}>
									<FilePlus className="size-4" />
								</IconButton>
							</>
						)}
					</PaneHeader>
					<nav aria-label={cap(kind.plural)} className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-1.5">
						{list === null ? null : shown.length === 0 ? (
							<EmptyNote>{list.length === 0 ? kind.empty : `No ${kind.noun} matches.`}</EmptyNote>
						) : manage ? (
							shown.map((f) => (
								<div key={f.rel} className={cn("group flex min-w-0 items-center hover:bg-muted", f.rel === selected && "bg-muted")}>
									<button
										type="button"
										aria-current={f.rel === selected}
										onClick={() => setSelected(f.rel)}
										onContextMenu={(e) => fileMenu(e, f)}
										onKeyDown={(e) => {
											if (isViewer) return;
											if (e.key === "F2") files.startRename(f);
											else if (e.key === "Delete") files.setDeleting(f);
										}}
										className="flex min-w-0 flex-1 items-center gap-2 py-1.5 pl-3 text-left text-[13px] outline-none focus-visible:bg-muted"
									>
										<span className="min-w-0 flex-1 truncate">{f.name}</span>
										<PresenceDots names={viewersAt(kind.page, f.rel)} />
									</button>
									{!isViewer && (
										<button type="button" aria-label={`Delete ${f.name}`} title="Delete" onClick={() => files.setDeleting(f)} className="mr-1 flex size-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground opacity-0 outline-none group-hover:opacity-100 hover:text-destructive focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring">
											<Trash2 className="size-3.5" />
										</button>
									)}
								</div>
							))
						) : (
							shown.map((f) => (
								<button key={f.rel} type="button" aria-current={f.rel === selected} onClick={() => setSelected(f.rel)} className={listRow(f.rel === selected)}>
									<span className="min-w-0 flex-1 truncate">{f.name}</span>
									<PresenceDots names={viewersAt(kind.page, f.rel)} />
								</button>
							))
						)}
					</nav>
				</div>
			</CollapsiblePane>
			{menu.menu}
		</>
	);
}

export function OfficeFileDialogs({ kind, files, templates }: { kind: OfficeKind; files: OfficeFiles; templates?: readonly { id: string; label: string }[] }) {
	const { creating, newName, renaming, deleting } = files;
	const bad = newName ? validateFileName(newName) : null;
	return (
		<>
			{renaming && (
				<Dialog isOpen onOpenChange={(o) => !o && files.setRenaming(null)} className="max-w-md">
					<form
						className="space-y-4"
						onSubmit={(e) => {
							e.preventDefault();
							void files.rename();
						}}
					>
						<DialogHeading icon={<Pencil className="size-6" />} title={`Rename ${cap(kind.noun)}`} description={<>{renaming.file.name}</>} />
						<Input aria-label="New name" autoFocus value={renaming.value} onChange={(e) => files.setRenaming({ ...renaming, value: e.target.value, error: "" })} aria-invalid={!!(validateFileName(renaming.value) ?? renaming.error)} />
						{(validateFileName(renaming.value) ?? renaming.error) && <FieldError>{validateFileName(renaming.value) ?? renaming.error}</FieldError>}
						<DialogFooter className="mt-2">
							<Button type="button" variant="outline" onPress={() => files.setRenaming(null)}>
								Cancel
							</Button>
							<Button type="submit" isDisabled={!renaming.value.trim() || !!validateFileName(renaming.value)}>
								Rename
							</Button>
						</DialogFooter>
					</form>
				</Dialog>
			)}
			{deleting && (
				<ConfirmDialog
					isOpen
					onOpenChange={(o) => !o && files.setDeleting(null)}
					icon={<Trash2 className="size-6" />}
					title={`Delete ${cap(kind.noun)}`}
					description={
						<>
							Move <span className="font-semibold text-foreground">{deleting.name}</span> to the Trash? You can restore it from there.
						</>
					}
					confirmLabel="Delete"
					onConfirm={() => void files.remove()}
					onCancel={() => files.setDeleting(null)}
				/>
			)}
			{creating && (
				<Dialog isOpen onOpenChange={(o) => !o && files.setCreating(false)} className="max-w-md">
					<form
						className="space-y-4"
						onSubmit={(e) => {
							e.preventDefault();
							void files.create();
						}}
					>
						<DialogHeading icon={<FilePlus className="size-6" />} title={`New ${cap(kind.noun)}`} />
						<Input aria-label={`${cap(kind.noun)} name`} autoFocus required value={newName} onChange={(e) => files.setNewName(e.target.value)} placeholder="Title" aria-invalid={!!bad} />
						{templates && (
							<select aria-label="Template" value={files.template} onChange={(e) => files.setTemplate(e.target.value)} className="h-9 w-full border bg-background px-2 text-sm">
								{templates.map((t) => (
									<option key={t.id} value={t.id}>
										{t.label}
									</option>
								))}
							</select>
						)}
						{bad && <FieldError>{bad}</FieldError>}
						<DialogFooter className="mt-2">
							<Button type="button" variant="outline" onPress={() => files.setCreating(false)}>
								Cancel
							</Button>
							<Button type="submit" isDisabled={!newName.trim() || !!bad}>
								Create
							</Button>
						</DialogFooter>
					</form>
				</Dialog>
			)}
		</>
	);
}
