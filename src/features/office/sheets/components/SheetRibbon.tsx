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
} from "lucide-react";

import { Big, Choice, ColorButton, Group, MenuItem, MenuRule, MenuTitle, Row, Rows, Sep, Small } from "@/features/office/shared/Ribbon";
import { FONTS, PALETTE, SIZES } from "@/features/office/documents/lib/documentFormat";
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
				<Group label="Editing">
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
				<Group label="Sort">
					<Big icon={ArrowDownAZ} label="Sort A to Z" disabled={ro || !p.canSort} onPress={() => p.sort(false)} />
					<Big icon={ArrowUpZA} label="Sort Z to A" disabled={ro || !p.canSort} onPress={() => p.sort(true)} />
				</Group>
				<Group label="Tools">
						<Big icon={Copy} label="Find Duplicates" title="Fill the cells of the selection whose text appears more than once" disabled={ro} onPress={p.highlightDuplicates} />
					</Group>
					<Group label="Get Data">
						<Big icon={FileJson} label="From JSON" title="Put a JSON file (a list of objects or of rows) into the sheet at the selected cell" disabled={ro} onPress={p.importJson} />
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
