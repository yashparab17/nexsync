// The dialogs of the Data and Home tabs: conditional formatting, data validation, text to columns, a pivot summary, goal seek and a filter.

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter, DialogHeading } from "@/components/ui/dialog";
import type { useSheetFeatures } from "@/features/office/sheets/components/useSheetFeatures";
import { ICON_SETS, type CfRule, type PivotFn } from "@/features/office/sheets/lib/sheetTools";
import { Filter, GitCompareArrows, Sheet, SplitSquareHorizontal, Table as TableIcon, Target } from "lucide-react";

export type SheetDialogKind = "cf" | "dv" | "split" | "pivot" | "goal" | "filter" | "datatable" | "scenario" | "spark";

type Features = ReturnType<typeof useSheetFeatures>;

const field = "h-8 w-full border bg-background px-2 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring";
const Label = ({ text, children }: { text: string; children: React.ReactNode }) => (
	<label className="block space-y-1">
		<span>{text}</span>
		{children}
	</label>
);

interface Props {
	kind: SheetDialogKind;
	onClose: () => void;
	f: Features;
	selectionText: string;
	activeCol: number;
}

const CF_KINDS: { value: CfRule["kind"]; label: string; needs: 0 | 1 | 2 }[] = [
	{ value: "gt", label: "Greater than", needs: 1 },
	{ value: "lt", label: "Less than", needs: 1 },
	{ value: "eq", label: "Equal to", needs: 1 },
	{ value: "between", label: "Between", needs: 2 },
	{ value: "contains", label: "Text contains", needs: 1 },
	{ value: "scale", label: "Colour scale (red to green)", needs: 0 },
	{ value: "bar", label: "Data bars", needs: 0 },
	{ value: "icons", label: "Icon set (three icons)", needs: 0 },
	{ value: "top", label: "Top N values", needs: 1 },
	{ value: "bottom", label: "Bottom N values", needs: 1 },
	{ value: "above", label: "Above average", needs: 0 },
	{ value: "below", label: "Below average", needs: 0 },
	{ value: "duplicate", label: "Duplicate values", needs: 0 },
	{ value: "blank", label: "Blank cells", needs: 0 },
	{ value: "error", label: "Errors", needs: 0 },
];
const FILLS = [
	{ label: "Light red", value: "#FFC7CE" },
	{ label: "Light yellow", value: "#FFEB9C" },
	{ label: "Light green", value: "#C6EFCE" },
	{ label: "Light blue", value: "#BDD7EE" },
];

export default function SheetDialogs({ kind, onClose, f, selectionText, activeCol }: Props) {
	const [cfKind, setCfKind] = useState<CfRule["kind"]>("gt");
	const [a, setA] = useState("");
	const [b, setB] = useState("");
	const [color, setColor] = useState(FILLS[0].value);
	const [dvKind, setDvKind] = useState<"list" | "whole" | "decimal">("list");
	const [list, setList] = useState("");
	const [delimiter, setDelimiter] = useState(",");
	const [by, setBy] = useState(0);
	const [of, setOf] = useState(1);
	const [fn, setFn] = useState<PivotFn>("sum");
	const [setCellText, setSetCellText] = useState("");
	const [target, setTarget] = useState("");
	const [change, setChange] = useState("");
	const [busy, setBusy] = useState(false);
	const [across, setAcross] = useState(-1);
	const [sparkKind, setSparkKind] = useState<"line" | "column" | "winloss">("line");
	const [scenarioName, setScenarioName] = useState("");
	const names = f.columnNames();
	const values = f.columnValues(activeCol);
	const [allowed, setAllowed] = useState<Set<string>>(() => new Set(values));
	const cfNeeds = CF_KINDS.find((k) => k.value === cfKind)!.needs;
	const done = () => onClose();

	const frame = (icon: React.ReactNode, title: string, body: React.ReactNode, footer: React.ReactNode) => (
		<Dialog isOpen onOpenChange={(o) => !o && onClose()} className="max-w-md">
			<div className="space-y-3 text-sm">
				<DialogHeading icon={icon} title={title} />
				{body}
				<DialogFooter>
					{footer}
					<Button variant="outline" onPress={onClose}>
						Cancel
					</Button>
				</DialogFooter>
			</div>
		</Dialog>
	);

	if (kind === "cf")
		return frame(
			<Sheet className="size-6" />,
			"Conditional Formatting",
			<>
				<p className="text-muted-foreground">Applies to {selectionText}.</p>
				<Label text="Rule">
					<select aria-label="Rule" className={field} value={cfKind} onChange={(e) => setCfKind(e.target.value as CfRule["kind"])}>
						{CF_KINDS.map((k) => (
							<option key={k.value} value={k.value}>
								{k.label}
							</option>
						))}
					</select>
				</Label>
				{cfNeeds >= 1 && <input aria-label="Value" className={field} placeholder={cfKind === "between" ? "From" : "Value"} value={a} onChange={(e) => setA(e.target.value)} />}
				{cfNeeds === 2 && <input aria-label="To" className={field} placeholder="To" value={b} onChange={(e) => setB(e.target.value)} />}
				{cfKind === "icons" && (
					<Label text="Icon set">
						<select aria-label="Icon set" className={field} value={a || "3Arrows"} onChange={(e) => setA(e.target.value)}>
							{Object.entries(ICON_SETS).map(([k, s]) => (
								<option key={k} value={k}>
									{s.label}
								</option>
							))}
						</select>
					</Label>
				)}
				{cfKind !== "scale" && cfKind !== "icons" && (
					<Label text="Colour">
						<select aria-label="Colour" className={field} value={color} onChange={(e) => setColor(e.target.value)}>
							{FILLS.map((c) => (
								<option key={c.value} value={c.value}>
									{c.label}
								</option>
							))}
						</select>
					</Label>
				)}
			</>,
			<>
				<Button variant="outline" onPress={() => (f.clearRules("cf"), done())}>
					Clear Rules on Sheet
				</Button>
				<Button
					onPress={() => {
						f.addCf({ kind: cfKind, a: cfKind === "icons" ? a || "3Arrows" : a, b, color });
						done();
					}}
				>
					Add Rule
				</Button>
			</>,
		);

	if (kind === "dv")
		return frame(
			<GitCompareArrows className="size-6" />,
			"Data Validation",
			<>
				<p className="text-muted-foreground">Applies to {selectionText}. It checks what is typed; pasted and filled values are not checked.</p>
				<Label text="Allow">
					<select aria-label="Allow" className={field} value={dvKind} onChange={(e) => setDvKind(e.target.value as typeof dvKind)}>
						<option value="list">A list of values</option>
						<option value="whole">Whole numbers</option>
						<option value="decimal">Numbers</option>
					</select>
				</Label>
				{dvKind === "list" ? (
					<input aria-label="Values" className={field} placeholder="Yes, No, Maybe" value={list} onChange={(e) => setList(e.target.value)} />
				) : (
					<div className="grid grid-cols-2 gap-2">
						<input aria-label="Least" className={field} placeholder="Least (optional)" value={a} onChange={(e) => setA(e.target.value)} />
						<input aria-label="Greatest" className={field} placeholder="Greatest (optional)" value={b} onChange={(e) => setB(e.target.value)} />
					</div>
				)}
			</>,
			<>
				<Button variant="outline" onPress={() => (f.clearRules("dv"), done())}>
					Clear Rules on Sheet
				</Button>
				<Button
					isDisabled={dvKind === "list" && !list.trim()}
					onPress={() => {
						f.addDv({ kind: dvKind, list: list.split(",").map((s) => s.trim()).filter(Boolean), min: a, max: b });
						done();
					}}
				>
					Add Rule
				</Button>
			</>,
		);

	if (kind === "split")
		return frame(
			<SplitSquareHorizontal className="size-6" />,
			"Text to Columns",
			<>
				<p className="text-muted-foreground">Splits the text in the first column of {selectionText} into the cells to its right.</p>
				<Label text="Split at">
					<select aria-label="Split at" className={field} value={delimiter} onChange={(e) => setDelimiter(e.target.value)}>
						<option value=",">Comma</option>
						<option value=";">Semicolon</option>
						<option value={"\t"}>Tab</option>
						<option value=" ">Space</option>
						<option value="-">Hyphen</option>
					</select>
				</Label>
			</>,
			<Button
				onPress={() => {
					f.textToColumns(delimiter);
					done();
				}}
			>
				Split
			</Button>,
		);

	if (kind === "pivot")
		return frame(
			<TableIcon className="size-6" />,
			"Summarise by a Column",
			<>
				<p className="text-muted-foreground">Groups the table's rows (first row is the heading) onto a new sheet.</p>
				<Label text="Group by">
					<select aria-label="Group by" className={field} value={by} onChange={(e) => setBy(Number(e.target.value))}>
						{names.map((n) => (
							<option key={n.col} value={n.col}>
								{n.name}
							</option>
						))}
					</select>
				</Label>
				<Label text="Across the top (optional)">
					<select aria-label="Across" className={field} value={across} onChange={(e) => setAcross(Number(e.target.value))}>
						<option value={-1}>None</option>
						{names.map((n) => (
							<option key={n.col} value={n.col}>
								{n.name}
							</option>
						))}
					</select>
				</Label>
				<Label text="Summarise">
					<select aria-label="Summarise" className={field} value={of} onChange={(e) => setOf(Number(e.target.value))}>
						{names.map((n) => (
							<option key={n.col} value={n.col}>
								{n.name}
							</option>
						))}
					</select>
				</Label>
				<Label text="With">
					<select aria-label="With" className={field} value={fn} onChange={(e) => setFn(e.target.value as PivotFn)}>
						{(["sum", "count", "average", "max", "min"] as const).map((x) => (
							<option key={x} value={x}>
								{x}
							</option>
						))}
					</select>
				</Label>
			</>,
			<Button
				onPress={() => {
					f.makePivot(by, of, fn, across);
					done();
				}}
			>
				Make Summary
			</Button>,
		);

	if (kind === "goal")
		return frame(
			<Target className="size-6" />,
			"Goal Seek",
			<>
				<p className="text-muted-foreground">Finds the value for one cell that makes a formula cell give the result you want.</p>
				<input aria-label="Set cell" className={field} placeholder="Formula cell, such as D2" value={setCellText} onChange={(e) => setSetCellText(e.target.value)} />
				<input aria-label="To value" className={field} placeholder="To value" value={target} onChange={(e) => setTarget(e.target.value)} />
				<input aria-label="By changing cell" className={field} placeholder="By changing cell, such as B2" value={change} onChange={(e) => setChange(e.target.value)} />
			</>,
			<Button
				isDisabled={busy || !f.parseCell(setCellText) || !f.parseCell(change) || target.trim() === "" || Number.isNaN(Number(target))}
				onPress={async () => {
					setBusy(true);
					await f.seek(f.parseCell(setCellText)!, Number(target), f.parseCell(change)!);
					setBusy(false);
					done();
				}}
			>
				{busy ? "Working…" : "Find It"}
			</Button>,
		);

	if (kind === "spark")
		return frame(
			<Sheet className="size-6" />,
			"Sparkline",
			<>
				<p className="text-muted-foreground">A small chart in one cell, drawn from the numbers of a range.</p>
				<input aria-label="Data range" className={field} placeholder="Data range, such as B2:E2" value={setCellText} onChange={(e) => setSetCellText(e.target.value)} />
				<input aria-label="Place in" className={field} placeholder="Place in the cell, such as F2" value={change} onChange={(e) => setChange(e.target.value)} />
				<Label text="Kind">
					<select aria-label="Sparkline kind" className={field} value={sparkKind} onChange={(e) => setSparkKind(e.target.value as typeof sparkKind)}>
						<option value="line">Line</option>
						<option value="column">Column</option>
						<option value="winloss">Win/Loss</option>
					</select>
				</Label>
			</>,
			<>
				<Button variant="outline" onPress={() => (f.clearSparks(), done())}>
					Clear Sparklines on Sheet
				</Button>
				<Button
					isDisabled={!setCellText.trim() || !f.parseCell(change)}
					onPress={() => {
						f.addSpark(setCellText.trim().toUpperCase(), f.parseCell(change)!, sparkKind, "#2F5597");
						done();
					}}
				>
					Add
				</Button>
			</>,
		);

	if (kind === "datatable")
		return frame(
			<Target className="size-6" />,
			"Data Table",
			<>
				<p className="text-muted-foreground">Select a column of inputs first. Each is put in the input cell and the answer is written beside it.</p>
				<input aria-label="Input cell" className={field} placeholder="Input cell, such as B2" value={setCellText} onChange={(e) => setSetCellText(e.target.value)} />
				<input aria-label="Formula cell" className={field} placeholder="Formula cell, such as D2" value={change} onChange={(e) => setChange(e.target.value)} />
			</>,
			<Button
				isDisabled={busy || !f.parseCell(setCellText) || !f.parseCell(change)}
				onPress={async () => {
					setBusy(true);
					await f.dataTable(f.parseCell(setCellText)!, f.parseCell(change)!);
					setBusy(false);
					done();
				}}
			>
				{busy ? "Working…" : "Make Table"}
			</Button>,
		);

	if (kind === "scenario")
		return frame(
			<Sheet className="size-6" />,
			"Scenarios",
			<>
				<p className="text-muted-foreground">Keeps what {selectionText} holds now under a name; Apply puts it back.</p>
				<ul className="max-h-40 space-y-1 overflow-auto">
					{f.scenarios.length === 0 && <li className="text-muted-foreground">No scenarios yet.</li>}
					{f.scenarios.map((s) => (
						<li key={s.id} className="flex items-center justify-between gap-2">
							<span>
								{s.name} ({Object.keys(s.cells).length} cells)
							</span>
							<span className="flex gap-2">
								<button type="button" className="underline" onClick={() => f.applyScenario(s.id)}>
									Apply
								</button>
								<button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => f.deleteScenario(s.id)}>
									Delete
								</button>
							</span>
						</li>
					))}
				</ul>
				<input aria-label="Scenario name" className={field} placeholder="Name, such as Best case" value={scenarioName} onChange={(e) => setScenarioName(e.target.value)} />
			</>,
			<Button
				isDisabled={!scenarioName.trim()}
				onPress={() => {
					f.saveScenario(scenarioName.trim());
					setScenarioName("");
				}}
			>
				Save Scenario
			</Button>,
		);

	// filter
	return frame(
		<Filter className="size-6" />,
		"Filter",
		<>
			<p className="text-muted-foreground">Shows only rows whose value in the selected column is ticked.</p>
			<ul className="max-h-52 space-y-1 overflow-auto">
				{values.map((v) => (
					<li key={v}>
						<label className="flex items-center gap-2">
							<input
								type="checkbox"
								checked={allowed.has(v)}
								onChange={(e) => {
									const next = new Set(allowed);
									if (e.target.checked) next.add(v);
									else next.delete(v);
									setAllowed(next);
								}}
							/>
							{v === "" ? "(blank)" : v}
						</label>
					</li>
				))}
			</ul>
		</>,
		<>
			<Button variant="outline" onPress={() => (f.clearFilter(), done())}>
				Clear Filter
			</Button>
			<Button
				onPress={() => {
					f.applyFilter(activeCol, allowed);
					done();
				}}
			>
				Apply
			</Button>
		</>,
	);
}
