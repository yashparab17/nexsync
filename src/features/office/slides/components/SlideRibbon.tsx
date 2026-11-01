import {
	AlignCenter,
	AlignHorizontalJustifyCenter,
	AlignHorizontalJustifyEnd,
	AlignHorizontalJustifyStart,
	AlignHorizontalSpaceBetween,
	AlignJustify,
	AlignLeft,
	AlignRight,
	AlignVerticalJustifyCenter,
	AlignVerticalJustifyEnd,
	AlignVerticalJustifyStart,
	AlignVerticalSpaceBetween,
	ArrowDownToLine,
	ArrowUpToLine,
	Bold,
	ChevronDown,
	ChevronUp,
	ClipboardPaste,
	Columns3,
	Copy,
	CopyPlus,
	EyeOff,
	Grid3x3,
	Group as GroupIcon,
	Image as ImageIcon,
	IndentDecrease,
	IndentIncrease,
	Italic,
	LayoutGrid,
	LayoutTemplate,
	List,
	ListOrdered,
	MonitorPlay,
	MousePointerClick,
	NotebookPen,
	PaintBucket,
	Paintbrush,
	Play,
	Plus,
	Presentation,
	RotateCcw,
	RotateCw,
	Rows3,
	Scissors,
	Search,
	Shapes,
	SquareDashed,
	Table as TableIcon,
	Trash2,
	Type,
	Underline,
	Ungroup,
} from "lucide-react";

import { FONTS, PALETTE } from "@/features/office/documents/lib/documentFormat";
import { FindPanel, TableCellsPanel } from "@/features/office/slides/components/SlidePanels";
import type { AlignTo } from "@/features/office/slides/lib/arrange";
import { Big, Choice, ColorButton, Gallery, GridPicker, Group, MenuItem, MenuRule, MenuTitle, Popover, Row, Rows, Sep, Small } from "@/features/office/shared/Ribbon";
import type { ShapeEdit, SlideEdit, TableEdit } from "@/lib/tauri";

export const SHAPES: [string, string][] = [
	["textBox", "Text Box"],
	["rect", "Rectangle"],
	["roundRect", "Rounded Rectangle"],
	["ellipse", "Oval"],
	["triangle", "Triangle"],
	["diamond", "Diamond"],
	["hexagon", "Hexagon"],
	["rightArrow", "Right Arrow"],
	["star5", "5-Point Star"],
	["cloud", "Cloud"],
];

export const TRANSITIONS: [string, string][] = [
	["none", "None"],
	["fade", "Fade"],
	["push", "Push"],
	["wipe", "Wipe"],
	["split", "Split"],
	["reveal", "Reveal"],
	["cut", "Cut"],
	["uncover", "Uncover"],
	["cover", "Cover"],
	["flash", "Flash"],
	["dissolve", "Dissolve"],
	["checker", "Checkerboard"],
	["blinds", "Blinds"],
	["clock", "Clock"],
	["zoom", "Zoom"],
	["randomBar", "Random Bars"],
];

const BACKGROUNDS = ["FFFFFF", "F2F2F2", "D9E2F3", "DDEBF7", "E2F0D9", "FFF2CC", "FCE4D6", "1F2937", "0F172A", "2B579A", "217346", "B7472A"];
const OUTLINE_WIDTHS = [0.5, 1, 1.5, 2.25, 3, 4.5, 6];
const SPACINGS = [1, 1.15, 1.5, 2, 2.5, 3];
const AFTER = [0, 1, 2, 3, 5, 10, 15, 30, 60];
const DURATIONS = [0.25, 0.5, 0.7, 1, 1.5, 2, 3, 5];

export interface SlideRibbonProps {
	tab: string;
	readOnly: boolean;
	hasSelection: boolean;
	hasText: boolean;
	// How many shapes are chosen; aligning needs one, distributing three, grouping two
	selectionCount: number;
	isGroup: boolean;
	isTable: boolean;
	// The cells of the chosen table
	tableCells: string[][] | null;
	hasClipboard: boolean;
	layouts: { id: number; name: string }[];
	// The layout of this slide
	layout: number;
	hidden: boolean;
	transition: string;
	timing: { after: number; click: boolean; seconds: number };
	newSlide: (layout: number) => void;
	changeLayout: (layout: number) => void;
	duplicate: () => void;
	deleteSlide: () => void;
	moveSlide: (by: number) => void;
	addShape: (kind: string) => void;
	addTable: (rows: number, cols: number) => void;
	editTable: (e: TableEdit) => void;
	pickPicture: () => void;
	change: (e: ShapeEdit) => void;
	arrange: (to: "front" | "back") => void;
	align: (how: AlignTo) => void;
	distribute: (axis: "h" | "v") => void;
	group: () => void;
	ungroup: () => void;
	rotate: (by: number | "reset") => void;
	copy: () => void;
	cut: () => void;
	paste: () => void;
	duplicateShape: () => void;
	deleteShape: () => void;
	find: (q: string, matchCase: boolean) => Promise<boolean>;
	replaceOne: (q: string, r: string, matchCase: boolean) => Promise<boolean>;
	replaceAll: (q: string, r: string, matchCase: boolean) => Promise<number>;
	setBackground: (hex: string, all: boolean) => void;
	setTransition: (kind: string, all: boolean) => void;
	setTiming: (e: SlideEdit, all: boolean) => void;
	setHidden: (h: boolean) => void;
	present: (fromStart: boolean) => void;
	// Whether a show gives the audience their own window and keeps this one for the notes
	presenterView: boolean;
	setPresenterView: (on: boolean) => void;
	view: { notes: boolean; sorter: boolean };
	setView: (v: Partial<SlideRibbonProps["view"]>) => void;
}

export default function SlideRibbon(p: SlideRibbonProps) {
	const { tab, readOnly: ro } = p;
	const textOff = ro || !p.hasText;
	const shapeOff = ro || !p.hasSelection;
	const manyOff = ro || p.selectionCount < 2;
	const defaultLayout = p.layouts.find((l) => /title and content/i.test(l.name))?.id ?? p.layouts[1]?.id ?? p.layouts[0]?.id;

	const layoutMenu = (onPick: (id: number) => void, current?: number) => (
		<div role="menu" className="max-h-72 w-52 overflow-auto">
			<MenuTitle>Office Theme</MenuTitle>
			{p.layouts.map((l) => (
				<MenuItem key={l.id} icon={LayoutTemplate} label={l.name} checked={l.id === current} onPress={() => onPick(l.id)} />
			))}
		</div>
	);
	const shapeMenu = (
		<div role="menu" className="w-48">
			{SHAPES.map(([k, l]) => (
				<MenuItem key={k} icon={k === "textBox" ? Type : Shapes} label={l} onPress={() => p.addShape(k)} />
			))}
		</div>
	);
	const tableMenu = (
		<div role="menu">
			<GridPicker onPick={p.addTable} />
		</div>
	);
	const findButton = (
		<Popover trigger={(open, isOpen) => <Big icon={Search} label="Find" title="Find and replace text on the slides" active={isOpen} onPress={open} />}>
			<FindPanel find={p.find} replaceOne={p.replaceOne} replaceAll={p.replaceAll} />
		</Popover>
	);
	const arrangeMenu = (
		<div role="menu" className="w-56">
			<MenuTitle>Order</MenuTitle>
			<MenuItem icon={ArrowUpToLine} label="Bring to Front" disabled={shapeOff} onPress={() => p.arrange("front")} />
			<MenuItem icon={ArrowDownToLine} label="Send to Back" disabled={shapeOff} onPress={() => p.arrange("back")} />
			<MenuRule />
			<MenuTitle>Align {p.selectionCount > 1 ? "Selected Objects" : "to Slide"}</MenuTitle>
			<MenuItem icon={AlignHorizontalJustifyStart} label="Align Left" disabled={shapeOff} onPress={() => p.align("left")} />
			<MenuItem icon={AlignHorizontalJustifyCenter} label="Align Center" disabled={shapeOff} onPress={() => p.align("center")} />
			<MenuItem icon={AlignHorizontalJustifyEnd} label="Align Right" disabled={shapeOff} onPress={() => p.align("right")} />
			<MenuItem icon={AlignVerticalJustifyStart} label="Align Top" disabled={shapeOff} onPress={() => p.align("top")} />
			<MenuItem icon={AlignVerticalJustifyCenter} label="Align Middle" disabled={shapeOff} onPress={() => p.align("middle")} />
			<MenuItem icon={AlignVerticalJustifyEnd} label="Align Bottom" disabled={shapeOff} onPress={() => p.align("bottom")} />
			<MenuItem icon={AlignHorizontalSpaceBetween} label="Distribute Horizontally" disabled={ro || p.selectionCount < 3} onPress={() => p.distribute("h")} />
			<MenuItem icon={AlignVerticalSpaceBetween} label="Distribute Vertically" disabled={ro || p.selectionCount < 3} onPress={() => p.distribute("v")} />
			<MenuRule />
			<MenuItem icon={GroupIcon} label="Group" disabled={manyOff} onPress={p.group} />
			<MenuItem icon={Ungroup} label="Ungroup" disabled={shapeOff || !p.isGroup} onPress={p.ungroup} />
			<MenuRule />
			<MenuTitle>Rotate</MenuTitle>
			<MenuItem icon={RotateCw} label="Rotate Right 90°" disabled={shapeOff} onPress={() => p.rotate(90)} />
			<MenuItem icon={RotateCcw} label="Rotate Left 90°" disabled={shapeOff} onPress={() => p.rotate(-90)} />
			<MenuItem label="Rotate 15° Right" disabled={shapeOff} onPress={() => p.rotate(15)} />
			<MenuItem label="Rotate 15° Left" disabled={shapeOff} onPress={() => p.rotate(-15)} />
			<MenuItem label="Reset Rotation" disabled={shapeOff} onPress={() => p.rotate("reset")} />
		</div>
	);
	const bulletMenu = (
		<div role="menu" className="w-44">
			<MenuTitle>Bullets</MenuTitle>
			<MenuItem label="None" onPress={() => p.change({ bullet: "none" })} />
			<MenuItem label="• Dot" onPress={() => p.change({ bullet: "dot" })} />
			<MenuItem label="– Dash" onPress={() => p.change({ bullet: "dash" })} />
		</div>
	);
	const numberMenu = (
		<div role="menu" className="w-44">
			<MenuTitle>Numbering</MenuTitle>
			<MenuItem label="None" onPress={() => p.change({ bullet: "none" })} />
			<MenuItem label="1. 2. 3." onPress={() => p.change({ bullet: "num" })} />
			<MenuItem label="a. b. c." onPress={() => p.change({ bullet: "alpha" })} />
			<MenuItem label="i. ii. iii." onPress={() => p.change({ bullet: "roman" })} />
		</div>
	);

	if (tab === "home")
		return (
			<>
				<Group label="Clipboard">
					<Big icon={ClipboardPaste} label="Paste" title="Paste the shapes copied (Ctrl+V)" disabled={ro || !p.hasClipboard} onPress={p.paste} />
					<Rows>
						<Small icon={Scissors} label="Cut" title="Cut (Ctrl+X)" disabled={shapeOff} onPress={p.cut} />
						<Small icon={Copy} label="Copy" title="Copy (Ctrl+C)" disabled={shapeOff} onPress={p.copy} />
						<Small icon={CopyPlus} label="Duplicate" title="Duplicate the shape (Ctrl+D)" disabled={shapeOff} onPress={p.duplicateShape} />
					</Rows>
				</Group>
				<Group label="Slides">
					<Big icon={Plus} label="New Slide" disabled={ro || defaultLayout === undefined} menu={layoutMenu(p.newSlide)} />
					<Rows>
						<Small icon={LayoutTemplate} label="Layout" title="Change the layout of this slide" disabled={ro || defaultLayout === undefined} menu={layoutMenu(p.changeLayout, p.layout)} />
						<Small icon={Copy} label="Duplicate" title="Duplicate this slide" disabled={ro} onPress={p.duplicate} />
						<Row>
							<Small icon={ChevronUp} title="Move slide up" disabled={ro} onPress={() => p.moveSlide(-1)} />
							<Small icon={ChevronDown} title="Move slide down" disabled={ro} onPress={() => p.moveSlide(1)} />
							<Small icon={Trash2} title="Delete slide" disabled={ro} onPress={p.deleteSlide} />
						</Row>
					</Rows>
				</Group>
				<Group label="Font">
					<Rows>
						<Row>
							<Choice label="Font" value="" width={124} disabled={textOff} options={[{ value: "", label: "Font…" }, ...FONTS.map((f) => ({ value: f.name, label: f.name, style: { fontFamily: f.stack } }))]} onChange={(v) => v && p.change({ font: v })} />
							<Choice label="Font size" value="" width={64} disabled={textOff} options={[{ value: "", label: "Size" }, ...[8, 10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 48, 60, 72, 96].map((s) => ({ value: String(s), label: String(s) }))]} onChange={(v) => v && p.change({ size: Number(v) })} />
						</Row>
						<Row>
							<Small icon={Bold} title="Bold" disabled={textOff} onPress={() => p.change({ bold: true })} />
							<Small icon={Italic} title="Italic" disabled={textOff} onPress={() => p.change({ italic: true })} />
							<Small icon={Underline} title="Underline" disabled={textOff} onPress={() => p.change({ underline: true })} />
							<Sep />
							<ColorButton icon={Type} title="Font color" color="C00000" colors={PALETTE} none="Automatic" onPick={(h) => h && p.change({ color: h.replace("#", "") })} />
						</Row>
					</Rows>
				</Group>
				<Group label="Paragraph">
					<Rows>
						<Row>
							<Small icon={List} title="Bullets" disabled={textOff} menu={bulletMenu} />
							<Small icon={ListOrdered} title="Numbering" disabled={textOff} menu={numberMenu} />
							<Sep />
							<Small icon={IndentDecrease} title="Decrease list level" disabled={textOff} onPress={() => p.change({ level: -1 })} />
							<Small icon={IndentIncrease} title="Increase list level" disabled={textOff} onPress={() => p.change({ level: 1 })} />
						</Row>
						<Row>
							<Small icon={AlignLeft} title="Align left" disabled={textOff} onPress={() => p.change({ align: "left" })} />
							<Small icon={AlignCenter} title="Center" disabled={textOff} onPress={() => p.change({ align: "center" })} />
							<Small icon={AlignRight} title="Align right" disabled={textOff} onPress={() => p.change({ align: "right" })} />
							<Small icon={AlignJustify} title="Justify" disabled={textOff} onPress={() => p.change({ align: "justify" })} />
						</Row>
						<Row>
							<Choice label="Line spacing" value="" width={86} disabled={textOff} options={[{ value: "", label: "Line gap" }, ...SPACINGS.map((s) => ({ value: String(s), label: s.toFixed(s % 1 ? 2 : 1).replace(/0$/, "") }))]} onChange={(v) => v && p.change({ lineSpacing: Number(v) })} />
							<Choice label="Space after" value="" width={86} disabled={textOff} options={[{ value: "", label: "After" }, ...[0, 6, 12, 18, 24].map((s) => ({ value: String(s), label: `${s} pt` }))]} onChange={(v) => v && p.change({ spaceAfter: Number(v) })} />
						</Row>
					</Rows>
				</Group>
				<Group label="Drawing">
					<Big icon={Shapes} label="Shapes" disabled={ro} menu={shapeMenu} />
					<Rows>
						<Row>
							<ColorButton icon={PaintBucket} title="Shape fill" color="2D64D2" colors={PALETTE} none="No Fill" onPick={(h) => p.change({ fill: h.replace("#", "") })} />
							<ColorButton icon={SquareDashed} title="Shape outline" color="111827" colors={PALETTE} none="No Outline" onPick={(h) => p.change({ line: h.replace("#", "") })} />
						</Row>
						<Row>
							<Choice label="Outline weight" value="" width={74} disabled={shapeOff} options={[{ value: "", label: "Weight" }, ...OUTLINE_WIDTHS.map((w) => ({ value: String(w), label: `${w} pt` }))]} onChange={(v) => v && p.change({ lineWidth: Number(v) })} />
						</Row>
					</Rows>
					<Big icon={LayoutGrid} label="Arrange" title="Order, align, group and rotate shapes" disabled={shapeOff} menu={arrangeMenu} />
					<Big icon={Trash2} label="Delete Shape" disabled={shapeOff} onPress={p.deleteShape} />
				</Group>
				<Group label="Editing">{findButton}</Group>
				{p.isTable && (
					<Group label="Table">
						<Rows>
							<Row>
								<Small icon={Rows3} label="Row Above" disabled={ro} onPress={() => p.editTable({ insertRow: 0 })} />
								<Small icon={Rows3} label="Row Below" disabled={ro} onPress={() => p.editTable({ insertRow: p.tableCells?.length ?? 1 })} />
							</Row>
							<Row>
								<Small icon={Columns3} label="Col Left" disabled={ro} onPress={() => p.editTable({ insertCol: 0 })} />
								<Small icon={Columns3} label="Col Right" disabled={ro} onPress={() => p.editTable({ insertCol: p.tableCells?.[0]?.length ?? 1 })} />
							</Row>
							<Row>
								<Small icon={Trash2} label="Last Row" disabled={ro} onPress={() => p.editTable({ deleteRow: (p.tableCells?.length ?? 1) - 1 })} />
								<Small icon={Trash2} label="Last Col" disabled={ro} onPress={() => p.editTable({ deleteCol: (p.tableCells?.[0]?.length ?? 1) - 1 })} />
							</Row>
						</Rows>
						{p.tableCells && (
							<Popover trigger={(open, isOpen) => <Big icon={TableIcon} label="Cells" title="Type into the cells of the table" disabled={ro} active={isOpen} onPress={open} />}>
								<TableCellsPanel key={JSON.stringify(p.tableCells)} cells={p.tableCells} apply={(cells) => p.editTable({ cells })} />
							</Popover>
						)}
					</Group>
				)}
			</>
		);

	if (tab === "insert")
		return (
			<>
				<Group label="Slides">
					<Big icon={Plus} label="New Slide" disabled={ro} menu={layoutMenu(p.newSlide)} />
				</Group>
				<Group label="Tables">
					<Big icon={Grid3x3} label="Table" title="Insert a table" disabled={ro} menu={tableMenu} />
				</Group>
				<Group label="Images">
					<Big icon={ImageIcon} label="Picture" title="Insert a PNG, JPEG or GIF picture" disabled={ro} onPress={p.pickPicture} />
				</Group>
				<Group label="Illustrations">
					<Big icon={Shapes} label="Shapes" disabled={ro} menu={shapeMenu} />
				</Group>
				<Group label="Text">
					<Big icon={Type} label="Text Box" disabled={ro} onPress={() => p.addShape("textBox")} />
				</Group>
			</>
		);

	if (tab === "design")
		return (
			<>
				<Group label="Layout">
					<Big icon={LayoutTemplate} label="Layout" title="Change the layout of this slide" disabled={ro || defaultLayout === undefined} menu={layoutMenu(p.changeLayout, p.layout)} />
				</Group>
				<Group label="Variants">
					<Big
						icon={Paintbrush}
						label="Background"
						disabled={ro}
						menu={
							<div role="menu" className="w-52">
								<MenuTitle>This slide</MenuTitle>
								<div className="grid grid-cols-6 gap-1 p-1">
									{BACKGROUNDS.map((c) => (
										<button key={c} type="button" aria-label={`Background #${c}`} onClick={() => p.setBackground(c, false)} className="size-6 rounded-sm border outline-none hover:scale-110 focus-visible:ring-2 focus-visible:ring-ring" style={{ background: `#${c}` }} />
									))}
								</div>
								<MenuItem label="Follow the layout" onPress={() => p.setBackground("", false)} />
								<MenuRule />
								<MenuTitle>Every slide</MenuTitle>
								<div className="grid grid-cols-6 gap-1 p-1">
									{BACKGROUNDS.map((c) => (
										<button key={c} type="button" aria-label={`Every slide #${c}`} onClick={() => p.setBackground(c, true)} className="size-6 rounded-sm border outline-none hover:scale-110 focus-visible:ring-2 focus-visible:ring-ring" style={{ background: `#${c}` }} />
									))}
								</div>
								<MenuItem label="Follow the layout, everywhere" onPress={() => p.setBackground("", true)} />
							</div>
						}
					/>
				</Group>
			</>
		);

	if (tab === "transitions")
		return (
			<>
				<Group label="Transition to This Slide">
					<Gallery
						label="Transitions"
						width={64}
						items={TRANSITIONS.map(([id, label]) => ({ id, label, preview: <span aria-hidden className="block h-6 w-10 rounded-sm border bg-white" /> }))}
						current={p.transition}
						onPick={(id) => !ro && p.setTransition(id, false)}
					/>
				</Group>
				<Group label="Timing">
					<Rows>
						<Row>
							<span className="w-24 text-[12px] text-muted-foreground">Duration</span>
							<Choice label="Transition duration" value={String(p.timing.seconds)} width={74} disabled={ro} options={DURATIONS.map((d) => ({ value: String(d), label: `${d} s` }))} onChange={(v) => p.setTiming({ duration: Number(v) }, false)} />
						</Row>
						<Row>
							<span className="w-24 text-[12px] text-muted-foreground">Advance after</span>
							<Choice label="Advance after" value={String(p.timing.after)} width={74} disabled={ro} options={AFTER.map((a) => ({ value: String(a), label: a ? `${a} s` : "Never" }))} onChange={(v) => p.setTiming({ advanceAfter: Number(v) }, false)} />
						</Row>
						<Row>
							<Small icon={MousePointerClick} label="On Mouse Click" title="Move on when the presenter clicks" active={p.timing.click} disabled={ro} onPress={() => p.setTiming({ advanceOnClick: !p.timing.click }, false)} />
						</Row>
					</Rows>
					<Big icon={Copy} label="Apply To All" title="Use this slide's transition and timing on every slide" disabled={ro} onPress={() => p.setTiming({ transition: p.transition, advanceAfter: p.timing.after, advanceOnClick: p.timing.click, duration: p.timing.seconds }, true)} />
				</Group>
			</>
		);

	if (tab === "show")
		return (
			<>
				<Group label="Start Slide Show">
					<Big icon={MonitorPlay} label="From Beginning" onPress={() => p.present(true)} />
					<Big icon={Play} label="From Current Slide" onPress={() => p.present(false)} />
				</Group>
				<Group label="Set Up">
					<Big icon={EyeOff} label={p.hidden ? "Show Slide" : "Hide Slide"} disabled={ro} onPress={() => p.setHidden(!p.hidden)} />
					<Big icon={Presentation} label="Presenter View" title="Show the slide to the audience in a second window, and the next slide, notes and a timer here" active={p.presenterView} onPress={() => p.setPresenterView(!p.presenterView)} />
				</Group>
			</>
		);

	return (
		<>
			<Group label="Presentation Views">
				<Big icon={Presentation} label="Normal" active={!p.view.sorter} onPress={() => p.setView({ sorter: false })} />
				<Big icon={LayoutGrid} label="Slide Sorter" title="See every slide at once and drag them into order" active={p.view.sorter} onPress={() => p.setView({ sorter: true })} />
			</Group>
			<Group label="Show">
				<Big icon={NotebookPen} label="Notes" disabled={p.view.sorter} onPress={() => p.setView({ notes: !p.view.notes })} active={p.view.notes} />
			</Group>
		</>
	);
}
