// The two panels that open under a Slides ribbon button and stay open while they are used: find and replace, and the cells of a table.

import { useState } from "react";

import { Button } from "@/components/ui/button";

const field = "h-7 w-full rounded-md border bg-background px-2 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring/50";

export function FindPanel({ find, replaceOne, replaceAll }: { find: (q: string, matchCase: boolean) => Promise<boolean>; replaceOne: (q: string, r: string, matchCase: boolean) => Promise<boolean>; replaceAll: (q: string, r: string, matchCase: boolean) => Promise<number>; }) {
	const [q, setQ] = useState("");
	const [r, setR] = useState("");
	const [matchCase, setCase] = useState(false);
	const [said, setSaid] = useState("");
	const run = async (fn: () => Promise<void>) => {
		if (!q) return setSaid("Type what to find.");
		await fn();
	};
	return (
		<div className="flex w-64 flex-col gap-2 p-2" role="group" aria-label="Find and replace">
			<label className="flex flex-col gap-1 text-xs text-muted-foreground">
				Find what
				<input autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void run(async () => setSaid((await find(q, matchCase)) ? "" : "No more found."))} className={field} />
			</label>
			<label className="flex flex-col gap-1 text-xs text-muted-foreground">
				Replace with
				<input value={r} onChange={(e) => setR(e.target.value)} className={field} />
			</label>
			<label className="flex items-center gap-2 text-[13px]">
				<input type="checkbox" checked={matchCase} onChange={(e) => setCase(e.target.checked)} />
				Match case
			</label>
			<div className="flex gap-1">
				<Button size="xs" variant="outline" onPress={() => void run(async () => setSaid((await find(q, matchCase)) ? "" : "Not found."))}>
					Find Next
				</Button>
				<Button size="xs" variant="outline" onPress={() => void run(async () => setSaid((await replaceOne(q, r, matchCase)) ? "" : "Not found."))}>
					Replace
				</Button>
				<Button size="xs" variant="outline" onPress={() => void run(async () => { const n = await replaceAll(q, r, matchCase); setSaid(n ? `Replaced ${n}.` : "Not found."); })}>
					Replace All
				</Button>
			</div>
			<p role="status" className="min-h-4 text-xs text-muted-foreground">
				{said}
			</p>
		</div>
	);
}

// Every cell of the table as a box to type in; Apply changes the cells that differ
export function TableCellsPanel({ cells, apply }: { cells: string[][]; apply: (cells: string[][]) => void }) {
	const [grid, setGrid] = useState(cells);
	return (
		<div className="flex max-w-[560px] flex-col gap-2 p-2" role="group" aria-label="Table cells">
			<div className="max-h-64 overflow-auto">
				<table className="border-separate border-spacing-1">
					<tbody>
						{grid.map((row, r) => (
							<tr key={r}>
								{row.map((v, c) => (
									<td key={c}>
										<input
											aria-label={`Row ${r + 1}, column ${c + 1}`}
											value={v}
											onChange={(e) => setGrid(grid.map((x, i) => (i === r ? x.map((y, j) => (j === c ? e.target.value : y)) : x)))}
											className={`${field} w-28`}
										/>
									</td>
								))}
							</tr>
						))}
					</tbody>
				</table>
			</div>
			<Button size="xs" onPress={() => apply(grid)}>
				Apply
			</Button>
		</div>
	);
}
