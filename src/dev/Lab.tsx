// Development only (`npm run dev`, then /?lab=documents, ?lab=sheets or ?lab=slides): the office editors on their own, with a shared
// document that lives in this page and, for sheets and slides, the engines served by `cargo run --example office_dev` in src-tauri.

import { mockIPC } from "@tauri-apps/api/mocks";
import { useEffect, useMemo, useState } from "react";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";

import DocumentWorkspace from "@/components/documents/DocumentWorkspace";
import SheetWorkspace from "@/components/sheets/SheetWorkspace";
import SlideWorkspace from "@/components/slides/SlideWorkspace";
import type { SheetIn } from "@/lib/sheet";
import type { CollabDoc } from "@/hooks/useCollabDoc";

const SAMPLE = `<h1>Quarterly Review</h1>
<p>This report covers the <strong>second quarter</strong>, with <em>notes</em> from each team and a look ahead. See the <a href="https://example.com">dashboard</a> for the numbers.</p>
<h2>Highlights</h2>
<ul><li>Revenue grew by twelve percent</li><li>Support response time fell below four hours</li><li>The new onboarding shipped on schedule</li></ul>
<h2>Plan</h2>
<ol><li>Hire two engineers</li><li>Move the data to the new region</li><li>Review pricing</li></ol>
<table><tr><th>Team</th><th>Goal</th><th>Status</th></tr><tr><td>Platform</td><td>99.9% uptime</td><td>On track</td></tr><tr><td>Growth</td><td>+10% signups</td><td>Ahead</td></tr></table>
<p>Thanks to everyone who contributed to this quarter.</p>`;

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

async function viaLab(cmd: string, args: unknown) {
	const r = await fetch("http://127.0.0.1:7878/", { method: "POST", body: JSON.stringify({ cmd, args }) });
	const j = (await r.json()) as { ok?: unknown; err?: string };
	if (j.err) throw new Error(j.err);
	return j.ok;
}

export default function Lab({ which }: { which: string }) {
	useEffect(() => {
		mockIPC((cmd, args) => viaLab(cmd, args));
	}, []);
	const collab = useMemo<CollabDoc>(() => {
		const doc = new Y.Doc();
		return { doc, awareness: new Awareness(doc), synced: true };
	}, []);
	const [readOnly] = useState(false);
	(window as unknown as { __lab: unknown }).__lab = collab;
	const [deck, setDeck] = useState<{ base: string; slides: string[]; notes: string[] } | null>(null);
	useEffect(() => {
		if (which === "slides") void viaLab("deck_new", {}).then((o) => setDeck({ base: (o as { parts: { base: string } }).parts.base, slides: (o as { parts: { slides: string[] } }).parts.slides, notes: [] }));
	}, [which]);
	if (which === "slides")
		return (
			<div style={{ height: new URLSearchParams(location.search).get("h") ?? "100vh" }}>
				{deck ? <SlideWorkspace collab={collab} opened={deck} name="Deck.pptx" rel="files/Deck.pptx" workspacePath="/lab" author="Ana" readOnly={readOnly} /> : null}
			</div>
		);
	if (which === "sheets")
		return (
			<div style={{ height: new URLSearchParams(location.search).get("h") ?? "100vh" }}>
				<SheetWorkspace collab={collab} opened={{ sheets: SHEETS, notes: [] }} name="Sales.xlsx" rel="files/Sales.xlsx" workspacePath="/lab" author="Ana" readOnly={readOnly} />
			</div>
		);
	if (which !== "documents") return <p className="p-6">The lab has no “{which}” yet.</p>;
	return (
		<div style={{ height: new URLSearchParams(location.search).get("h") ?? "100vh" }}>
			<DocumentWorkspace
				collab={collab}
				initialHtml={SAMPLE}
				name="Quarterly Review.docx"
				title="Quarterly Review"
				author="Ana"
				readOnly={readOnly}
				inspect={{ words: 120, images: 0, comments: 0, revisions: 0, people: ["Ana"], title: "", created: "", modified: "", macros: false, embedded: [], external: [], leftOut: ["Page layout (margins, columns, headers, footers), named styles, footnotes and fields."] }}
				canUpdateFile
				onSaveCopy={async () => {}}
				onUpdateFile={async () => {}}
			/>
		</div>
	);
}
