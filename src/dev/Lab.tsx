// Development only (`npm run dev`, then /?lab=documents, ?lab=sheets or ?lab=slides): the office editors on their own, with a shared
// document that lives in this page and, for sheets and slides, the engines served by `cargo run --example office_dev` in src-tauri.

import { ChatContext, NONE } from "@/store/chat/ChatContext";
import type { LogEntry } from "@/features/chat/lib/entries";
import { mockIPC } from "@tauri-apps/api/mocks";
import { useEffect, useMemo, useState } from "react";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";

import DocumentWorkspace from "@/features/office/documents/components/DocumentWorkspace";
import { setFontFactors } from "@/features/office/documents/lib/fontMetrics";
import SheetWorkspace from "@/features/office/sheets/components/SheetWorkspace";
import SlideWorkspace from "@/features/office/slides/components/SlideWorkspace";
import { readWorkbookForFile, type SheetIn } from "@/features/office/sheets/lib/sheet";
import { P2PContext } from "@/store/p2p/P2PContext";
import type { CollabDoc } from "@/hooks/useCollabDoc";

const SAMPLE = `<h1 style="text-align:center">Centered Title</h1><p style="text-align:center">Centered paragraph</p><p style="text-align:right">Right paragraph</p>
<h1><span style="color:#0f4761;font-size:20pt;font-family:'Aptos Display'">Quarterly Review</span></h1>
<p><span style="font-family:'Georgia';font-size:14pt;color:#C00000">Georgia red 14pt</span> <span style="font-family:'Courier New'">Courier</span></p>
<p>This report covers the <strong>second quarter</strong>, with <em>notes</em> from each team and a look ahead. See the <a href="https://example.com">dashboard</a> for the numbers.</p>
<h2>Highlights</h2>
<ul><li>Revenue grew by twelve percent</li><li>Support response time fell below four hours</li><li>The new onboarding shipped on schedule</li></ul>
<h2>Plan</h2>
<ol><li>Hire two engineers</li><li>Move the data to the new region</li><li>Review pricing</li></ol>
<table><tr><th>Team</th><th>Goal</th><th>Status</th></tr><tr><td>Platform</td><td>99.9% uptime</td><td>On track</td></tr><tr><td>Growth</td><td>+10% signups</td><td>Ahead</td></tr></table>
<p>Thanks to everyone who contributed to this quarter.</p>
<p><img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAKAAAABkCAIAAACO1KzYAAABDklEQVR42u3TMQ1AIQxFUeQw/7lKEIGmP6MEJehABXnLSe7epKdtuyrSWT1S/SPSN3ekBhgwYMCAAQMGDBgwYMCAAQMGDBgwYMCAAQMGDBgwYMCAAQMGDBgwYMCAAQMGDBgwYMCAAQMGDBgwYMCAAQMGDBgwYMCAAQMGDBgwYMCAAQMGDBgwYMCAAQMGDBgwYMCAAQMGDBgw4IfAqcGpRacOK/VIgAEDBgwYMGDAgAEDBgwYMGDAgAEDBgwYMGDAgAEDBgwYMGDAgAEDBgwYMGDAgAEDBgwYMGDAgAEDBgwYMGDAgAEDBgwYMGDAgAEDBgwYMGDAgAEDBgwYMGDAgAEDBgwYMGDAgAEDfgh8AQV3TNoATTfMAAAAAElFTkSuQmCC" alt="Sample gradient" width="160" height="100"></p>`;

const SHEETS: SheetIn[] = [
	{
		name: "Sales",
		cells: { A1: "Region", B1: "Q1", C1: "Q2", D1: "Total", A2: "North", B2: "1200", C2: "1450.5", D2: "=B2+C2", A3: "South", B3: "980", C3: "1100", D3: "=B3+C3", A4: "East", B4: "1500", C4: "1320", D4: "=B4+C4", A5: "West", B5: "760", C5: "910.25", D5: "=B5+C5", A6: "Total", B6: "=SUM(B2:B5)", C6: "=SUM(C2:C5)", D6: "=SUM(D2:D5)", F1: "Growth", F2: "=C2/B2-1", F3: "=C3/B3-1" },
		styles: {
			A1: { bold: true, fill: "#217346", color: "#FFFFFF" },
			B1: { bold: true, fill: "#217346", color: "#FFFFFF", align: "right" },
			C1: { bold: true, fill: "#217346", color: "#FFFFFF", align: "right" },
			D1: { bold: true, fill: "#217346", color: "#FFFFFF", align: "right" },
			B2: { nf: '"$"#,##0.00' },
			C2: { nf: '"$"#,##0.00' },
			D2: { nf: '"$"#,##0.00', bold: true },
			A6: { bold: true, borders: "t" },
			B6: { bold: true, borders: "t", nf: '"$"#,##0.00' },
			C6: { bold: true, borders: "t", nf: '"$"#,##0.00' },
			D6: { bold: true, borders: "t", nf: '"$"#,##0.00' },
			F2: { nf: "0.0%", color: "#217346" },
			F3: { nf: "0.0%", italic: true },
		},
		widths: { A: 110, D: 120 },
		freeze: [1, 0],
	},
	{ name: "Notes", cells: { A1: "Second sheet" } },
];

// ?perf: every stretch of more than 50 ms the page could not answer in, from the start, in window.__long
if (new URLSearchParams(location.search).has("perf")) {
	const long: { at: number; ms: number }[] = ((window as unknown as { __long: unknown }).__long = []) as never;
	new PerformanceObserver((l) => l.getEntries().forEach((e) => long.push({ at: Math.round(e.startTime), ms: Math.round(e.duration) }))).observe({ type: "longtask" });
}

async function viaLab(cmd: string, args: unknown) {
	const r = await fetch("http://127.0.0.1:7878/", { method: "POST", body: JSON.stringify({ cmd, args }) });
	const j = (await r.json()) as { ok?: unknown; err?: string };
	if (j.err) throw new Error(j.err);
	return j.ok;
}

// A chat that lives in this page, so comments can be tried without a workspace
function LabChat({ children }: { children: React.ReactNode }) {
	const [entries, setEntries] = useState<LogEntry[]>([]);
	const value = useMemo(
		() => ({
			...NONE,
			entries,
			me: "ana",
			myName: "Ana",
			role: "Owner" as const,
			canPost: true,
			people: [{ key: "ana", name: "Ana" }] as never,
			post: async (a: { kind: LogEntry["kind"]; channel: string; parent?: string; body: string }) => {
				const e: LogEntry = { id: `e${Date.now()}${Math.random().toString(36).slice(2, 6)}`, kind: a.kind, channel: a.channel, parent: a.parent ?? "", author: "ana", name: "Ana", ts: Date.now(), body: a.body, sig: "" };
				setEntries((x) => [...x, e]);
				return e;
			},
		}),
		[entries],
	);
	return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export default function Lab({ which }: { which: string }) {
	useEffect(() => {
		mockIPC((cmd, args) => viaLab(cmd, args));
	}, []);
	const base = useMemo(() => {
		const doc = new Y.Doc();
		(window as unknown as { __labSave: (drop?: string) => void }).__labSave = (drop) => {
			if (drop) doc.getMap(drop).clear();
			sessionStorage.setItem("labDoc", btoa(Array.from(Y.encodeStateAsUpdate(doc), (b) => String.fromCharCode(b)).join("")));
		};
		return { doc, awareness: new Awareness(doc) };
	}, []);
	// ?restore: start from the document `__labSave()` kept, loaded a moment later the way the app loads a file opened before
	const kept = new URLSearchParams(location.search).has("restore") ? sessionStorage.getItem("labDoc") : null;
	const [synced, setSynced] = useState(!kept);
	useEffect(() => {
		if (!kept) return;
		const t = setTimeout(() => {
			Y.applyUpdate(base.doc, Uint8Array.from(atob(kept), (c) => c.charCodeAt(0)));
			setSynced(true);
		}, 500);
		return () => clearTimeout(t);
	}, [base, kept]);
	const collab = useMemo<CollabDoc>(() => ({ ...base, synced }), [base, synced]);
	const [readOnly] = useState(false);
	(window as unknown as { __lab: unknown }).__lab = collab;
	// For checking what a workbook writes: __labXlsx(path) saves the shared workbook through the lab backend
	(window as unknown as { __labXlsx: (path: string) => Promise<unknown> }).__labXlsx = (path) => viaLab("sheet_write_file", { sheets: readWorkbookForFile(collab.doc), path });
	const fileParam = new URLSearchParams(location.search).get("file");
	const [deck, setDeck] = useState<{ base: string; slides: string[]; notes: string[] } | null>(null);
	useEffect(() => {
		if (which === "slides") void (fileParam ? viaLab("deck_open_file", { path: fileParam }) : viaLab("deck_new", {})).then((o) => setDeck({ base: (o as { parts: { base: string } }).parts.base, slides: (o as { parts: { slides: string[] } }).parts.slides, notes: [] }));
	}, [which, fileParam]);
	if (which === "slides")
		return (
			<div style={{ height: new URLSearchParams(location.search).get("h") ?? "100vh" }}>
				{deck ? <SlideWorkspace collab={collab} opened={deck} name="Deck.pptx" rel="office/slides/Deck.pptx" workspacePath="/lab" author="Ana" readOnly={readOnly} /> : null}
			</div>
		);
	if (which === "sheets")
		return (
			<div style={{ height: new URLSearchParams(location.search).get("h") ?? "100vh" }}>
				<SheetWorkspace collab={collab} opened={{ sheets: SHEETS, notes: [] }} name="Sales.xlsx" rel="office/sheets/Sales.xlsx" workspacePath="/lab" author="Ana" readOnly={readOnly} />
			</div>
		);
	const [opened, setOpened] = useState<{ html: string; layout: never; sourceId: string } | null>(null);
	useEffect(() => {
		if (fileParam)
			void viaLab("office_import_file", { path: fileParam }).then((o) => {
				setFontFactors((o as { fonts?: Record<string, number> }).fonts);
				setOpened(o as never);
			});
	}, [fileParam]);
	if (fileParam && !opened) return <p className="p-6">Opening…</p>;
	if (which !== "documents") return <p className="p-6">The lab has no “{which}” yet.</p>;
	return (
		<P2PContext.Provider value={{ publishDataChange: () => {}, setMyPresence: () => {} } as never}><LabChat><div style={{ height: new URLSearchParams(location.search).get("h") ?? "100vh" }}>
			<DocumentWorkspace canComment
				collab={collab}
				fileLayout={(opened as unknown as { layout?: never } | null)?.layout}
				sourceId={(opened as unknown as { sourceId?: string } | null)?.sourceId}
				lists={(opened as unknown as { lists?: never } | null)?.lists}
				styles={(opened as unknown as { styles?: never } | null)?.styles}
				notes={(opened as unknown as { notes?: never } | null)?.notes}
				initialBlocks={opened ? (opened as unknown as { blocks: unknown[] }).blocks : new URLSearchParams(location.search).has("long") ? SAMPLE + Array.from({ length: 40 }, (_, i) => `<h2>Section ${i + 1}</h2><p>${"Lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(5)}</p>`).join("") : SAMPLE}
				name="Quarterly Review.docx"
				title="Quarterly Review"
				author="Ana"
				readOnly={readOnly}
				inspect={{ words: 120, images: 0, comments: 0, revisions: 0, people: ["Ana"], title: "", created: "", modified: "", macros: false, embedded: [], external: [], leftOut: ["Page layout (margins, columns, headers, footers), named styles, footnotes and fields."] }}
				canUpdateFile
				onSaveCopy={async (format, html, layout) => {
						// ?out=<folder>: write the copy there through the lab backend, so it can be opened again (window.__labCopy says where)
						const out = new URLSearchParams(location.search).get("out");
						if (!out) return;
						const path = `${out}/lab-copy.${format}`;
						await viaLab("office_export_html", { ext: format, html, title: "Quarterly Review", author: "Ana", path, layout, sourceId: (opened as { sourceId?: string } | null)?.sourceId });
						(window as unknown as { __labCopy: string }).__labCopy = path;
					}}
				onUpdateFile={async () => {}}
			/>
		</div></LabChat></P2PContext.Provider>
	);
}
