import {
	AlignCenter,
	AlignLeft,
	AlignRight,
	ArrowDownAZ,
	ArrowUpZA,
	Bold,
	ChartArea,
	ChartBar,
	ChartColumn,
	ChartLine,
	ChartPie,
	ChartScatter,
	ClipboardPaste,
	FileJson,
	Copy,
	DollarSign,
	Eraser,
	Grid3x3,
	Italic,
	Percent,
	PaintBucket,
	Plus,
	Scissors,
	Sigma,
	Snowflake,
	Strikethrough,
	Table as TableIcon,
	Trash2,
	Type,
	Underline,
	WrapText,
	ALargeSmall,
	Rows3,
	Minus,
	SquareFunction,
	Eye,
	Printer,
	ArrowDownToLine,
	EyeOff,
	Filter,
	GitCompareArrows,
	ListChecks,
	Lock,
	LockOpen,
	Palette,
	SplitSquareHorizontal,
	Target,
} from "lucide-react";

import { Big, Choice, ColorButton, Group, MenuItem, MenuRule, MenuTitle, Row, Rows, Sep, Small } from "@/features/office/shared/Ribbon";
import { FONTS, PALETTE, SIZES } from "@/features/office/documents/lib/documentFormat";
import type { SheetDialogKind } from "@/features/office/sheets/components/SheetDialogs";
import type { ChartOptions } from "@/features/office/sheets/lib/sheet";
import { TABLE_STYLES } from "@/features/office/sheets/lib/sheetFill";
import { NUMBER_FORMATS, stepDecimals, type CellStyle } from "@/features/office/sheets/lib/sheet";

export const FUNCTIONS: { group: string; names: string[] }[] = [
	{ group: "Math", names: ["SUM", "ROUND", "ABS", "SQRT", "POWER", "MOD", "SUMIF", "SUMIFS", "SUMPRODUCT"] },
	{ group: "Statistical", names: ["AVERAGE", "COUNT", "COUNTA", "MAX", "MIN", "MEDIAN", "COUNTIF", "COUNTIFS", "AVERAGEIF"] },
	{ group: "Logical", names: ["IF", "IFS", "AND", "OR", "NOT", "IFERROR", "SWITCH"] },
	{ group: "Lookup", names: ["VLOOKUP", "HLOOKUP", "XLOOKUP", "INDEX", "MATCH", "FILTER", "SORT", "UNIQUE"] },
	{ group: "Text", names: ["CONCAT", "TEXTJOIN", "LEFT", "RIGHT", "MID", "LEN", "UPPER", "LOWER", "TRIM", "TEXT", "SUBSTITUTE"] },
	{ group: "Date & time", names: ["TODAY", "NOW", "DATE", "YEAR", "MONTH", "DAY", "DATEDIF", "EDATE", "NETWORKDAYS"] },
	{ group: "Financial", names: ["PMT", "FV", "PV", "NPV", "IRR", "RATE"] },
];

const CELL_STYLES: { label: string; look: CellStyle }[] = [
	{ label: "Normal", look: {} },
	{ label: "Good", look: { fill: "#C6EFCE", color: "#006100" } },
	{ label: "Bad", look: { fill: "#FFC7CE", color: "#9C0006" } },
	{ label: "Neutral", look: { fill: "#FFEB9C", color: "#9C5700" } },
	{ label: "Input", look: { fill: "#FFCC99", color: "#3F3F76" } },
	{ label: "Heading", look: { bold: true, size: 13, borders: "b" } },
	{ label: "Title", look: { bold: true, size: 18 } },
	{ label: "Total", look: { bold: true, borders: "t" } },
];

const BORDERS: { label: string; value: string }[] = [
	{ label: "Bottom Border", value: "b" },
	{ label: "Top Border", value: "t" },
	{ label: "Left Border", value: "l" },
	{ label: "Right Border", value: "r" },
	{ label: "All Borders", value: "ltrb" },
	{ label: "No Border", value: "" },
];

const CHARTS = [
	{ kind: "column", label: "Column", icon: ChartColumn },
	{ kind: "bar", label: "Bar", icon: ChartBar },
	{ kind: "line", label: "Line", icon: ChartLine },
	{ kind: "pie", label: "Pie", icon: ChartPie },
	{ kind: "doughnut", label: "Doughnut", icon: ChartPie },
	{ kind: "area", label: "Area", icon: ChartArea },
	{ kind: "scatter", label: "Scatter", icon: ChartScatter },
] as const;

export interface SheetRibbonProps {
	tab: string;
	look: CellStyle;
	readOnly: boolean;
	// Changes how the selected cells look
	style: (change: (cur: CellStyle) => CellStyle) => void;
	paste: () => void;
	pasteTransposed: () => void;
	copyValues: () => void;
	highlightDuplicates: () => void;
	importJson: () => void;
	restructure: (op: "insertRows" | "deleteRows" | "insertCols" | "deleteCols") => void;
	autoSum: (fn: "SUM" | "AVERAGE" | "COUNT" | "MAX" | "MIN") => void;
	insertFunction: (name: string) => void;
	sort: (descending: boolean) => void;
	insertChart: (kind: (typeof CHARTS)[number]["kind"]) => void;
	addSheet: () => void;
	freeze: [number, number];
	setFreeze: (mode: "row" | "col" | "both" | "none") => void;
	view: { grid: boolean; formulaBar: boolean };
	setView: (v: Partial<SheetRibbonProps["view"]>) => void;
	clear: (what: "all" | "formats") => void;
	openFile: () => void;
	canSort: boolean;
	fill: (dir: "down" | "right") => void;
	series: (dir: "down" | "right") => void;
	hide: (what: "rows" | "cols") => void;
	unhideAll: () => void;
	openDialog: (kind: SheetDialogKind) => void;
	removeDuplicates: () => void;
	clearFilter: () => void;
	filtered: boolean;
	locked: boolean;
	protect: (on: boolean) => void;
	unlock: (on: boolean) => void;
	insertTasks: () => void;
	// The chart that is selected, and a change to how it looks (null: none is selected)
	chart: { title: string; opts: ChartOptions } | null;
	changeChart: (patch: { title?: string; opts?: ChartOptions }) => void;
	flashFill: () => void;
	formatAsTable: (styleId: string) => void;
	group: (kind: "rows" | "cols") => void;
	ungroup: () => void;
	foldGroups: (fold: boolean) => void;
}

export default function SheetRibbon(p: SheetRibbonProps) {
	const { tab, look, readOnly: ro, style } = p;
	const nf = NUMBER_FORMATS.find((f) => f.code === (look.nf ?? ""))?.id ?? "custom";

	if (tab === "home")
		return (
			<>
				<Group label="Clipboard">
					<Big
							icon={ClipboardPaste}
							label="Paste"
							disabled={ro}
							onPress={p.paste}
						/>
						<Big
							icon={ClipboardPaste}
							label="Paste Special"
							disabled={ro}
							menu={
								<div role="menu" className="w-48">
									<MenuItem label="Paste Transposed" onPress={p.pasteTransposed} />
								</div>
							}
						/>
					<Rows>
						<Small icon={Scissors} label="Cut" disabled={ro} onPress={() => document.execCommand("cut")} />
						<Small icon={Copy} label="Copy" onPress={() => document.execCommand("copy")} />
							<Small icon={Copy} label="Copy Values" title="Copy the answers the cells show, not their formulas" onPress={p.copyValues} />
					</Rows>
				</Group>
				<Group label="Font">
					<Rows>
						<Row>
							<Choice label="Font" value={look.font ?? "Calibri"} width={124} disabled={ro} options={FONTS.map((f) => ({ value: f.name, label: f.name, style: { fontFamily: f.stack } }))} onChange={(v) => style((c) => ({ ...c, font: v }))} />
							<Choice label="Font size" value={String(look.size ?? 11)} width={56} disabled={ro} options={SIZES.map((s) => ({ value: String(s), label: String(s) }))} onChange={(v) => style((c) => ({ ...c, size: Number(v) }))} />
							<Small icon={ALargeSmall} title="Grow font" disabled={ro} onPress={() => style((c) => ({ ...c, size: Math.min(72, (c.size ?? 11) + 1) }))} />
							<Small icon={Type} title="Shrink font" disabled={ro} onPress={() => style((c) => ({ ...c, size: Math.max(6, (c.size ?? 11) - 1) }))} />
						</Row>
						<Row>
							<Small icon={Bold} title="Bold (Ctrl+B)" active={look.bold} disabled={ro} onPress={() => style((c) => ({ ...c, bold: !look.bold }))} />
							<Small icon={Italic} title="Italic (Ctrl+I)" active={look.italic} disabled={ro} onPress={() => style((c) => ({ ...c, italic: !look.italic }))} />
							<Small icon={Underline} title="Underline (Ctrl+U)" active={look.underline} disabled={ro} onPress={() => style((c) => ({ ...c, underline: !look.underline }))} />
							<Small icon={Strikethrough} title="Strikethrough" active={look.strike} disabled={ro} onPress={() => style((c) => ({ ...c, strike: !look.strike }))} />
							<Small
								icon={Grid3x3}
								title="Borders"
								disabled={ro}
								menu={
									<div role="menu" className="w-44">
										{BORDERS.map((b) => (
											<MenuItem key={b.label} label={b.label} onPress={() => style((c) => ({ ...c, borders: b.value === "" ? "" : [...new Set(((b.value === "ltrb" ? "" : (c.borders ?? "")) + b.value).split(""))].join("") }))} />
										))}
									</div>
								}
							/>
							<Sep />
							<ColorButton icon={PaintBucket} title="Fill color" color={(look.fill ?? "#FFFF00").replace("#", "")} colors={PALETTE} none="No Fill" onPick={(h) => style((c) => ({ ...c, fill: h ? `#${h.replace("#", "")}` : "" }))} />
							<ColorButton icon={Type} title="Font color" color={(look.color ?? "#C00000").replace("#", "")} colors={PALETTE} none="Automatic" onPick={(h) => style((c) => ({ ...c, color: h ? `#${h.replace("#", "")}` : "" }))} />
						</Row>
					</Rows>
				</Group>
				<Group label="Alignment">
					<Rows>
						<Row>
							<Small icon={AlignLeft} title="Align left" active={look.align === "left"} disabled={ro} onPress={() => style((c) => ({ ...c, align: look.align === "left" ? undefined : "left" }))} />
							<Small icon={AlignCenter} title="Center" active={look.align === "center"} disabled={ro} onPress={() => style((c) => ({ ...c, align: look.align === "center" ? undefined : "center" }))} />
							<Small icon={AlignRight} title="Align right" active={look.align === "right"} disabled={ro} onPress={() => style((c) => ({ ...c, align: look.align === "right" ? undefined : "right" }))} />
						</Row>
						<Row>
							<Small icon={WrapText} label="Wrap Text" active={look.wrap} disabled={ro} onPress={() => style((c) => ({ ...c, wrap: !look.wrap }))} />
						</Row>
					</Rows>
				</Group>
				<Group label="Number">
					<Rows>
						<Row>
							<Choice label="Number format" value={nf} width={132} disabled={ro} options={[...NUMBER_FORMATS.map((f) => ({ value: f.id, label: f.label })), ...(nf === "custom" ? [{ value: "custom", label: "Custom" }] : [])]} onChange={(v) => style((c) => ({ ...c, nf: NUMBER_FORMATS.find((f) => f.id === v)?.code || undefined }))} />
						</Row>
						<Row>
							<Small icon={DollarSign} title="Currency" disabled={ro} onPress={() => style((c) => ({ ...c, nf: NUMBER_FORMATS[2].code }))} />
							<Small icon={Percent} title="Percent style" disabled={ro} onPress={() => style((c) => ({ ...c, nf: "0%" }))} />
							<Small icon={Plus} title="Comma style" disabled={ro} onPress={() => style((c) => ({ ...c, nf: "#,##0.00" }))} />
							<Small icon={Plus} label=".0" title="Increase decimal" disabled={ro} onPress={() => style((c) => ({ ...c, nf: stepDecimals(c.nf, 1) }))} />
							<Small icon={Minus} label=".0" title="Decrease decimal" disabled={ro} onPress={() => style((c) => ({ ...c, nf: stepDecimals(c.nf, -1) }))} />
						</Row>
					</Rows>
				</Group>
				<Group label="Cells">
					<Big
						icon={EyeOff}
						label="Hide"
						disabled={ro}
						menu={
							<div role="menu" className="w-48">
								<MenuItem label="Hide Rows" onPress={() => p.hide("rows")} />
								<MenuItem label="Hide Columns" onPress={() => p.hide("cols")} />
								<MenuItem label="Unhide All" onPress={p.unhideAll} />
							</div>
						}
					/>
					<Big
						icon={Rows3}
						label="Insert"
						disabled={ro}
						menu={
							<div role="menu" className="w-44">
								<MenuItem label="Insert Sheet Rows" onPress={() => p.restructure("insertRows")} />
								<MenuItem label="Insert Sheet Columns" onPress={() => p.restructure("insertCols")} />
								<MenuItem label="Insert Sheet" onPress={p.addSheet} />
							</div>
						}
					/>
					<Big
						icon={Trash2}
						label="Delete"
						disabled={ro}
						menu={
							<div role="menu" className="w-44">
								<MenuItem label="Delete Sheet Rows" onPress={() => p.restructure("deleteRows")} />
								<MenuItem label="Delete Sheet Columns" onPress={() => p.restructure("deleteCols")} />
							</div>
						}
					/>
				</Group>
				<Group label="Styles">
					<Big
							icon={TableIcon}
							label="Format as Table"
							title="A coloured heading row and shaded rows"
							disabled={ro}
							menu={
								<div role="menu" className="w-40">
									{TABLE_STYLES.map((t) => (
										<MenuItem key={t.id} label={t.label} onPress={() => p.formatAsTable(t.id)} />
									))}
								</div>
							}
						/>
						<Big icon={Palette} label="Conditional Formatting" title="Colour cells by what they show" disabled={ro} onPress={() => p.openDialog("cf")} />
					<Big
						icon={PaintBucket}
						label="Cell Styles"
						disabled={ro}
						menu={
							<div role="menu" className="w-40">
								{CELL_STYLES.map((c) => (
									<MenuItem key={c.label} label={c.label} onPress={() => style(() => ({ ...c.look }))} />
								))}
							</div>
						}
					/>
				</Group>
				<Group label="Editing">
					<Big
						icon={ArrowDownToLine}
						label="Fill"
						title="Carry the first cell, or a series, over the selection"
						disabled={ro}
						menu={
							<div role="menu" className="w-52">
								<MenuItem label="Down" onPress={() => p.fill("down")} />
								<MenuItem label="Right" onPress={() => p.fill("right")} />
								<MenuItem label="Series Down" hint="1, 2 then 3, 4" onPress={() => p.series("down")} />
								<MenuItem label="Series Right" onPress={() => p.series("right")} />
								<MenuItem label="Flash Fill" hint="learns from your examples" onPress={p.flashFill} />
							</div>
						}
					/>
					<Big
						icon={Sigma}
						label="AutoSum"
						disabled={ro}
						menu={
							<div role="menu" className="w-40">
								{(["SUM", "AVERAGE", "COUNT", "MAX", "MIN"] as const).map((f) => (
									<MenuItem key={f} label={f === "COUNT" ? "Count Numbers" : f === "SUM" ? "Sum" : f[0] + f.slice(1).toLowerCase()} onPress={() => p.autoSum(f)} />
								))}
							</div>
						}
					/>
					<Big
						icon={ArrowDownAZ}
						label="Sort"
						disabled={ro || !p.canSort}
						menu={
							<div role="menu" className="w-44">
								<MenuItem icon={ArrowDownAZ} label="Sort A to Z" onPress={() => p.sort(false)} />
								<MenuItem icon={ArrowUpZA} label="Sort Z to A" onPress={() => p.sort(true)} />
							</div>
						}
					/>
					<Big
						icon={Eraser}
						label="Clear"
						disabled={ro}
						menu={
							<div role="menu" className="w-40">
								<MenuItem label="Clear All" onPress={() => p.clear("all")} />
								<MenuItem label="Clear Formats" onPress={() => p.clear("formats")} />
							</div>
						}
					/>
				</Group>
			</>
		);

	if (tab === "insert")
		return (
			<>
				<Group label="Charts">
					{CHARTS.map((c) => (
						<Big key={c.kind} icon={c.icon} label={c.label} title={`Insert a ${c.label.toLowerCase()} chart of the selected cells`} disabled={ro} onPress={() => p.insertChart(c.kind)} />
					))}
				</Group>
				<Group label="Sparklines">
					<Big icon={ChartLine} label="Sparkline" title="A small chart in one cell, from a range" disabled={ro} onPress={() => p.openDialog("spark")} />
				</Group>
				<Group label="Chart Options">
					<Big
						icon={ChartColumn}
						label="Chart Options"
						title={p.chart ? "How the selected chart looks" : "Select a chart first"}
						disabled={ro || !p.chart}
						menu={
							p.chart ? (
								<div role="menu" className="w-64">
									<MenuItem label="Data labels" checked={!!p.chart.opts.labels} onPress={() => p.changeChart({ opts: { ...p.chart!.opts, labels: !p.chart!.opts.labels } })} />
									<MenuItem label="Gridlines" checked={!p.chart.opts.noGrid} onPress={() => p.changeChart({ opts: { ...p.chart!.opts, noGrid: !p.chart!.opts.noGrid } })} />
									<MenuRule />
									<MenuTitle>Trendline</MenuTitle>
									{(["", "linear", "exponential", "logarithmic", "poly2"] as const).map((t) => (
										<MenuItem key={t} label={t === "" ? "None" : t === "poly2" ? "Polynomial (2)" : t[0].toUpperCase() + t.slice(1)} checked={(p.chart!.opts.trend ?? "") === t} onPress={() => p.changeChart({ opts: { ...p.chart!.opts, trend: t } })} />
									))}
									<MenuRule />
									<form
										className="space-y-1 p-1"
										onSubmit={(e) => {
											e.preventDefault();
											const f = new FormData(e.currentTarget);
											p.changeChart({ title: String(f.get("title") ?? ""), opts: { ...p.chart!.opts, xTitle: String(f.get("x") ?? ""), yTitle: String(f.get("y") ?? "") } });
										}}
									>
										<input name="title" aria-label="Chart title" defaultValue={p.chart.title} placeholder="Chart title" className="h-7 w-full border bg-background px-1.5 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring" />
										<input name="x" aria-label="Horizontal axis title" defaultValue={p.chart.opts.xTitle ?? ""} placeholder="Horizontal axis title" className="h-7 w-full border bg-background px-1.5 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring" />
										<input name="y" aria-label="Vertical axis title" defaultValue={p.chart.opts.yTitle ?? ""} placeholder="Vertical axis title" className="h-7 w-full border bg-background px-1.5 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring" />
										<button type="submit" className="h-7 w-full bg-[var(--office)] px-2 text-[13px] text-white">
											Apply
										</button>
									</form>
								</div>
							) : null
						}
					/>
				</Group>
				<Group label="Sheets">
					<Big icon={TableIcon} label="New Sheet" disabled={ro} onPress={p.addSheet} />
				</Group>
			</>
		);

	if (tab === "formulas")
		return (
			<>
				<Group label="Function Library">
					<Big
						icon={Sigma}
						label="AutoSum"
						disabled={ro}
						menu={
							<div role="menu" className="w-40">
								{(["SUM", "AVERAGE", "COUNT", "MAX", "MIN"] as const).map((f) => (
									<MenuItem key={f} label={f[0] + f.slice(1).toLowerCase()} onPress={() => p.autoSum(f)} />
								))}
							</div>
						}
					/>
					{FUNCTIONS.map((g) => (
						<Big
							key={g.group}
							icon={SquareFunction}
							label={g.group}
							disabled={ro}
							menu={
								<div role="menu" className="max-h-72 w-44 overflow-auto">
									<MenuTitle>{g.group}</MenuTitle>
									{g.names.map((n) => (
										<MenuItem key={n} label={n} onPress={() => p.insertFunction(n)} />
									))}
								</div>
							}
						/>
					))}
				</Group>
			</>
		);

	if (tab === "data")
		return (
			<>
				<Group label="Sort & Filter">
					<Big icon={ArrowDownAZ} label="Sort A to Z" disabled={ro || !p.canSort} onPress={() => p.sort(false)} />
					<Big icon={ArrowUpZA} label="Sort Z to A" disabled={ro || !p.canSort} onPress={() => p.sort(true)} />
					<Big icon={Filter} label="Filter" title="Show only the rows with chosen values in the selected column" disabled={ro || !p.canSort} onPress={() => p.openDialog("filter")} />
					<Big icon={Eye} label="Clear Filter" disabled={!p.filtered} onPress={p.clearFilter} />
				</Group>
				<Group label="Data Tools">
					<Rows>
						<Small icon={SplitSquareHorizontal} label="Text to Columns" disabled={ro} onPress={() => p.openDialog("split")} />
						<Small icon={Copy} label="Find Duplicates" title="Fill the cells of the selection whose text appears more than once" disabled={ro} onPress={p.highlightDuplicates} />
						<Small icon={Trash2} label="Remove Duplicates" title="Keep the first of each repeated row in the selection or table" disabled={ro} onPress={p.removeDuplicates} />
					</Rows>
					<Big icon={GitCompareArrows} label="Data Validation" title="Say what may be typed into the selected cells" disabled={ro} onPress={() => p.openDialog("dv")} />
				</Group>
				<Group label="Analyze">
					<Big icon={TableIcon} label="Summarise" title="Group the table by a column on a new sheet" disabled={ro} onPress={() => p.openDialog("pivot")} />
					<Big
						icon={Target}
						label="What-If"
						disabled={ro}
						menu={
							<div role="menu" className="w-56">
								<MenuItem label="Goal Seek" hint="the input that gives a result" onPress={() => p.openDialog("goal")} />
								<MenuItem label="Data Table" hint="results for a column of inputs" onPress={() => p.openDialog("datatable")} />
								<MenuItem label="Scenarios" hint="named sets of values" onPress={() => p.openDialog("scenario")} />
							</div>
						}
					/>
				</Group>
				<Group label="Outline">
					<Big
						icon={Rows3}
						label="Group"
						disabled={ro}
						menu={
							<div role="menu" className="w-48">
								<MenuItem label="Group Rows" onPress={() => p.group("rows")} />
								<MenuItem label="Group Columns" onPress={() => p.group("cols")} />
								<MenuItem label="Ungroup" onPress={p.ungroup} />
								<MenuRule />
								<MenuItem label="Fold All Groups" onPress={() => p.foldGroups(true)} />
								<MenuItem label="Unfold All Groups" onPress={() => p.foldGroups(false)} />
							</div>
						}
					/>
				</Group>
				<Group label="Protect">
					<Big icon={p.locked ? LockOpen : Lock} label={p.locked ? "Unprotect Sheet" : "Protect Sheet"} title="Stop changes to cells that are not unlocked" disabled={ro} onPress={() => p.protect(!p.locked)} />
					<Rows>
						<Small icon={LockOpen} label="Unlock Cells" title="Keep the selected cells editable on a protected sheet" disabled={ro} onPress={() => p.unlock(true)} />
						<Small icon={Lock} label="Lock Cells" disabled={ro} onPress={() => p.unlock(false)} />
					</Rows>
				</Group>
				<Group label="Get Data">
					<Big icon={FileJson} label="From JSON" title="Put a JSON file (a list of objects or of rows) into the sheet at the selected cell" disabled={ro} onPress={p.importJson} />
					<Big icon={ListChecks} label="Workspace Tasks" title="Put the workspace's tasks into the sheet at the selected cell" disabled={ro} onPress={p.insertTasks} />
				</Group>
				<Group label="Open">
					<Big icon={Printer} label="Save a Copy" onPress={p.openFile} />
				</Group>
			</>
		);

	// View
	return (
		<>
			<Group label="Window">
				<Big
					icon={Snowflake}
					label="Freeze Panes"
					menu={
						<div role="menu" className="w-52">
							<MenuItem label="Freeze Panes" hint="above and left of the cell" disabled={ro} onPress={() => p.setFreeze("both")} />
							<MenuItem label="Freeze Top Row" checked={p.freeze[0] === 1 && p.freeze[1] === 0} disabled={ro} onPress={() => p.setFreeze("row")} />
							<MenuItem label="Freeze First Column" checked={p.freeze[0] === 0 && p.freeze[1] === 1} disabled={ro} onPress={() => p.setFreeze("col")} />
							<MenuRule />
							<MenuItem label="Unfreeze Panes" disabled={ro || (p.freeze[0] === 0 && p.freeze[1] === 0)} onPress={() => p.setFreeze("none")} />
						</div>
					}
				/>
			</Group>
			<Group label="Show">
				<Rows>
					<Small icon={Grid3x3} label="Gridlines" active={p.view.grid} onPress={() => p.setView({ grid: !p.view.grid })} />
					<Small icon={Eye} label="Formula Bar" active={p.view.formulaBar} onPress={() => p.setView({ formulaBar: !p.view.formulaBar })} />
				</Rows>
			</Group>
		</>
	);
}
