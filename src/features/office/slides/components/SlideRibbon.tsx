import {
	AlignCenter,
	AlignJustify,
	AlignLeft,
	AlignRight,
	ArrowDownToLine,
	ArrowUpToLine,
	Bold,
	Copy,
	EyeOff,
	Image as ImageIcon,
	Italic,
	MonitorPlay,
	NotebookPen,
	PaintBucket,
	Play,
	Plus,
	Shapes,
	SquareDashed,
	Trash2,
	Type,
	Underline,
	ChevronDown,
	ChevronUp,
	LayoutTemplate,
	Paintbrush,
} from "lucide-react";

import { Big, Choice, ColorButton, Gallery, Group, MenuItem, MenuRule, MenuTitle, Row, Rows, Sep, Small } from "@/features/office/shared/Ribbon";
import { FONTS, PALETTE } from "@/features/office/documents/lib/documentFormat";
import type { ShapeEdit } from "@/lib/tauri";

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

export interface SlideRibbonProps {
	tab: string;
	readOnly: boolean;
	hasSelection: boolean;
	hasText: boolean;
	layouts: { id: number; name: string }[];
	hidden: boolean;
	transition: string;
	newSlide: (layout: number) => void;
	duplicate: () => void;
	deleteSlide: () => void;
	moveSlide: (by: number) => void;
	addShape: (kind: string) => void;
	pickPicture: () => void;
	change: (e: ShapeEdit) => void;
	arrange: (to: "front" | "back") => void;
	deleteShape: () => void;
	setBackground: (hex: string, all: boolean) => void;
	setTransition: (kind: string, all: boolean) => void;
	setHidden: (h: boolean) => void;
	present: (fromStart: boolean) => void;
	view: { notes: boolean };
	setView: (v: Partial<SlideRibbonProps["view"]>) => void;
}

export default function SlideRibbon(p: SlideRibbonProps) {
	const { tab, readOnly: ro } = p;
	const textOff = ro || !p.hasText;
	const shapeOff = ro || !p.hasSelection;
	const defaultLayout = p.layouts.find((l) => /title and content/i.test(l.name))?.id ?? p.layouts[1]?.id ?? p.layouts[0]?.id;

	const layoutMenu = (
		<div role="menu" className="max-h-72 w-52 overflow-auto">
			<MenuTitle>Office Theme</MenuTitle>
			{p.layouts.map((l) => (
				<MenuItem key={l.id} icon={LayoutTemplate} label={l.name} onPress={() => p.newSlide(l.id)} />
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

	if (tab === "home")
		return (
			<>
				<Group label="Slides">
					<Big icon={Plus} label="New Slide" disabled={ro || defaultLayout === undefined} menu={layoutMenu} />
					<Rows>
						<Small icon={Copy} label="Duplicate" disabled={ro} onPress={p.duplicate} />
						<Small icon={ChevronUp} label="Move Up" disabled={ro} onPress={() => p.moveSlide(-1)} />
						<Small icon={ChevronDown} label="Move Down" disabled={ro} onPress={() => p.moveSlide(1)} />
					</Rows>
					<Big icon={Trash2} label="Delete" disabled={ro} onPress={p.deleteSlide} />
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
							<Small icon={AlignLeft} title="Align left" disabled={textOff} onPress={() => p.change({ align: "left" })} />
							<Small icon={AlignCenter} title="Center" disabled={textOff} onPress={() => p.change({ align: "center" })} />
							<Small icon={AlignRight} title="Align right" disabled={textOff} onPress={() => p.change({ align: "right" })} />
							<Small icon={AlignJustify} title="Justify" disabled={textOff} onPress={() => p.change({ align: "justify" })} />
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
					<Rows>
						<Small icon={ArrowUpToLine} label="Bring to Front" disabled={shapeOff} onPress={() => p.arrange("front")} />
						<Small icon={ArrowDownToLine} label="Send to Back" disabled={shapeOff} onPress={() => p.arrange("back")} />
						<Small icon={Trash2} label="Delete Shape" disabled={shapeOff} onPress={p.deleteShape} />
					</Rows>
				</Group>
			</>
		);

	if (tab === "insert")
		return (
			<>
				<Group label="Slides">
					<Big icon={Plus} label="New Slide" disabled={ro} menu={layoutMenu} />
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
										<button key={c} type="button" aria-label={`Background #${c}`} onClick={() => p.setBackground(c, false)} className="size-6 border border-black/20 outline-none hover:scale-110 focus-visible:ring-2 focus-visible:ring-ring" style={{ background: `#${c}` }} />
									))}
								</div>
								<MenuItem label="Follow the layout" onPress={() => p.setBackground("", false)} />
								<MenuRule />
								<MenuTitle>Every slide</MenuTitle>
								<div className="grid grid-cols-6 gap-1 p-1">
									{BACKGROUNDS.map((c) => (
										<button key={c} type="button" aria-label={`Every slide #${c}`} onClick={() => p.setBackground(c, true)} className="size-6 border border-black/20 outline-none hover:scale-110 focus-visible:ring-2 focus-visible:ring-ring" style={{ background: `#${c}` }} />
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
						items={TRANSITIONS.map(([id, label]) => ({ id, label, preview: <span aria-hidden className="block h-6 w-10 border border-black/25 bg-white" /> }))}
						current={p.transition}
						onPick={(id) => !ro && p.setTransition(id, false)}
					/>
				</Group>
				<Group label="Timing">
					<Big icon={Copy} label="Apply To All" title="Use this slide's transition on every slide" disabled={ro} onPress={() => p.setTransition(p.transition, true)} />
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
				</Group>
			</>
		);

	return (
		<>
			<Group label="Show">
				<Big icon={NotebookPen} label="Notes" onPress={() => p.setView({ notes: !p.view.notes })} active={p.view.notes} />
			</Group>
		</>
	);
}
