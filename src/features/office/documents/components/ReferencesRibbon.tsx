// The References and Mailings tabs of the document ribbon: contents, notes, captions, cross-references, an index, sources and
// citations, and mail merge.

import { FileText, Image as ImageIcon, Library, Link as LinkIcon, ListOrdered, Mail, Quote, StickyNote, Table as TableIcon, Tag } from "lucide-react";
import { useState } from "react";

import { Big, Group, MenuItem, MenuTitle, Rows, Small } from "@/features/office/shared/Ribbon";
import type { useDocumentActions } from "@/features/office/documents/components/useDocumentActions";

// A menu with one text field and a button, as the link menu has
export function TextForm({ label, button, onSubmit, multiline }: { label: string; button: string; onSubmit: (text: string) => void; multiline?: boolean }) {
	const [text, setText] = useState("");
	const submit = (e: React.FormEvent) => {
		e.preventDefault();
		if (text.trim()) onSubmit(text.trim());
		setText("");
	};
	return (
		<form className="flex w-72 items-center gap-1 p-1" onSubmit={submit}>
			{multiline ? (
				<textarea autoFocus aria-label={label} value={text} onChange={(e) => setText(e.target.value)} placeholder={label} rows={3} className="flex-1 border bg-background px-1.5 py-1 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring" />
			) : (
				<input autoFocus aria-label={label} value={text} onChange={(e) => setText(e.target.value)} placeholder={label} className="h-7 flex-1 border bg-background px-1.5 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring" />
			)}
			<button type="submit" className="h-7 bg-[var(--office)] px-2 text-[13px] text-white">
				{button}
			</button>
		</form>
	);
}

export interface ReferencesProps {
	tab: string;
	a: ReturnType<typeof useDocumentActions>;
	readOnly: boolean;
	// Things in the document other places can point at: headings and captions
	crossRefs: () => string[];
	// The sources, each with the text its citation puts in the document
	citations: { label: string; text: string }[];
	openSources: () => void;
	openMerge: () => void;
	openNotes: () => void;
}

export default function ReferencesRibbon({ tab, a, readOnly: ro, crossRefs, citations, openSources, openMerge, openNotes }: ReferencesProps) {
	if (tab === "mailings")
		return (
			<Group label="Mail Merge">
				<Big icon={Mail} label="Merge from Data" title="One copy of the document for each row of a table, with {{field}} replaced" disabled={ro} onPress={openMerge} />
			</Group>
		);
	return (
		<>
			<Group label="Table of Contents">
				<Big icon={ListOrdered} label="Table of Contents" title="Insert the headings as a contents list; press again to bring it up to date" disabled={ro} onPress={a.insertToc} />
			</Group>
			<Group label="Notes">
				<Big icon={StickyNote} label="Footnote" title="A numbered note, which the file keeps as a real footnote" disabled={ro} menu={<TextForm label="Note text" button="Add" onSubmit={(t) => a.footnote(t)} />} />
				<Big icon={StickyNote} label="Endnote" title="A numbered note, which the file keeps as a real endnote" disabled={ro} menu={<TextForm label="Endnote text" button="Add" onSubmit={(t) => a.footnote(t, true)} />} />
				<Big icon={StickyNote} label="Show Notes" title="Read and change the words of the notes" onPress={openNotes} />
			</Group>
			<Group label="Captions">
				<Rows>
					<Small icon={ImageIcon} label="Figure Caption" disabled={ro} onPress={() => a.insertCaption("Figure")} />
					<Small icon={TableIcon} label="Table Caption" disabled={ro} onPress={() => a.insertCaption("Table")} />
					<Small
						icon={LinkIcon}
						label="Cross-reference"
						disabled={ro}
						menu={
							<>
								<MenuTitle>Refer to</MenuTitle>
								{crossRefs().length === 0 ? <MenuItem label="Nothing to refer to yet" disabled onPress={() => {}} /> : crossRefs().map((r) => <MenuItem key={r} label={r} onPress={() => a.crossRef(r)} />)}
							</>
						}
					/>
				</Rows>
			</Group>
			<Group label="Index">
				<Rows>
					<Small icon={Tag} label="Mark Entry" title="Mark the selected words for the index" disabled={ro} onPress={a.markEntry} />
					<Small icon={FileText} label="Insert Index" disabled={ro} onPress={a.insertIndex} />
				</Rows>
			</Group>
			<Group label="Citations">
				<Big icon={Library} label="Sources" title="The books and articles this document cites, and the reference list" disabled={ro} onPress={openSources} />
				<Big
					icon={Quote}
					label="Insert Citation"
					disabled={ro}
					menu={
						<>
							<MenuTitle>Cite</MenuTitle>
							{citations.length === 0 ? <MenuItem label="Add a source first" disabled onPress={() => {}} /> : citations.map((c) => <MenuItem key={c.label} label={`${c.label}  ·  ${c.text}`} onPress={() => a.crossRef(c.text)} />)}
						</>
					}
				/>
			</Group>
		</>
	);
}
