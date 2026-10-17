import {
	AlignCenter,
	AlignJustify,
	AlignLeft,
	AlignRight,
	Bold,
	CalendarDays,
	ClipboardPaste,
	Columns2,
	Copy,
	CornerDownLeft,
	FileText,
	Highlighter,
	Image as ImageIcon,
	IndentDecrease,
	IndentIncrease,
	Italic,
	Link as LinkIcon,
	List,
	ListChecks,
	ListOrdered,
	MessageSquareText,
	PanelLeft,
	Ruler,
	Scissors,
	Search,
	SpellCheck,
	Strikethrough,
	Table as TableIcon,
	Type,
	Underline,
	ALargeSmall,
	Eraser,
	Rows3,
	Smile,
	StretchHorizontal,
	BookOpen,
	Globe,
	Printer,
	Hash,
	PanelTop,
	RectangleHorizontal,
	RectangleVertical,
	Space,
} from "lucide-react";
import { useRef, useState } from "react";

import { Big, Choice, ColorButton, Gallery, GridPicker, Group, MenuItem, MenuTitle, Row, Rows, Sep, Small } from "@/components/office/Ribbon";
import { FONTS, HIGHLIGHTS, MARGINS, PALETTE, PAPER, SIZES, STYLES, type MarginName, type PageSetup, type PaperName, type StyleId } from "@/lib/documentFormat";
import type { Fmt, useDocumentActions } from "@/components/documents/useDocumentActions";

type Actions = ReturnType<typeof useDocumentActions>;

const SYMBOLS = ["©", "®", "™", "§", "¶", "†", "‡", "•", "…", "–", "—", "°", "±", "×", "÷", "≠", "≤", "≥", "≈", "∞", "√", "∑", "π", "Ω", "µ", "€", "£", "¥", "¢", "←", "→", "↑", "↓", "✓", "✗", "★"];
const LINE_SPACING = [1, 1.15, 1.5, 2, 2.5, 3];

// A look in the Styles gallery, drawn the way it will look
const previews: Record<StyleId, React.ReactNode> = {
	normal: <span className="text-[13px]">AaBbCc</span>,
	h1: <span className="text-[17px] font-semibold text-[var(--office)]">AaBbCc</span>,
	h2: <span className="text-[15px] font-semibold text-[var(--office)]">AaBbCc</span>,
	h3: <span className="text-[13px] font-semibold text-[var(--office-dark)]">AaBbCc</span>,
	quote: <span className="border-l-2 pl-1 text-[13px] italic text-muted-foreground">AaBbCc</span>,
	code: <span className="font-mono text-[12px]">AaBbCc</span>,
};

export interface RibbonProps {
	tab: string;
	a: Actions;
	fmt: Fmt;
	readOnly: boolean;
	page: PageSetup;
	setPage: (p: Partial<PageSetup>) => void;
	view: { ruler: boolean; navigation: boolean; mode: "print" | "web" | "read"; spelling: boolean };
	setView: (v: Partial<RibbonProps["view"]>) => void;
	zoom: number;
	setZoom: (z: number) => void;
	openFind: (replace: boolean) => void;
	openHeaderFooter: () => void;
	openCounts: () => void;
	openProofing: () => void;
	pickImage: () => void;
	paste: () => void;
	hasHeaderFooter: boolean;
}

export default function DocumentRibbon(p: RibbonProps) {
	const { tab, a, fmt, readOnly: ro } = p;
	const [link, setLink] = useState("");
	const linkInput = useRef<HTMLInputElement>(null);

	if (tab === "home")
		return (
			<>
				<Group label="Clipboard">
					<Big icon={ClipboardPaste} label="Paste" disabled={ro} onPress={p.paste} />
					<Rows>
						<Small icon={Scissors} label="Cut" disabled={ro} onPress={() => document.execCommand("cut")} />
						<Small icon={Copy} label="Copy" onPress={() => document.execCommand("copy")} />
					</Rows>
				</Group>
				<Group label="Font">
					<Rows>
						<Row>
							<Choice label="Font" value={fmt.font} width={132} disabled={ro} options={FONTS.map((f) => ({ value: f.name, label: f.name, style: { fontFamily: f.stack } }))} onChange={a.setFont} />
							<Choice label="Font size" value={String(fmt.size)} width={60} disabled={ro} options={SIZES.map((s) => ({ value: String(s), label: String(s) }))} onChange={(v) => a.setSize(Number(v))} />
							<Small icon={ALargeSmall} title="Grow font" disabled={ro} onPress={() => a.stepSize(1)} />
							<Small icon={Type} title="Shrink font" disabled={ro} onPress={() => a.stepSize(-1)} />
							<Small icon={Eraser} title="Clear all formatting" disabled={ro} onPress={a.clearFormatting} />
						</Row>
						<Row>
							<Small icon={Bold} title="Bold (Ctrl+B)" active={fmt.bold} disabled={ro} onPress={() => a.toggle("bold")} />
							<Small icon={Italic} title="Italic (Ctrl+I)" active={fmt.italic} disabled={ro} onPress={() => a.toggle("italic")} />
							<Small icon={Underline} title="Underline (Ctrl+U)" active={fmt.underline} disabled={ro} onPress={() => a.toggle("underline")} />
							<Small icon={Strikethrough} title="Strikethrough" active={fmt.strike} disabled={ro} onPress={() => a.toggle("strike")} />
							<Sep />
							<ColorButton icon={Highlighter} title="Text highlight color" color={fmt.highlight.replace("#", "") || "FFFF00"} colors={HIGHLIGHTS} none="No Color" onPick={a.setHighlight} />
							<ColorButton icon={Type} title="Font color" color={fmt.color.replace("#", "") || "C00000"} colors={PALETTE} none="Automatic" onPick={a.setColor} />
						</Row>
					</Rows>
				</Group>
				<Group label="Paragraph">
					<Rows>
						<Row>
							<Small icon={List} title="Bullets" active={fmt.list === "bullet"} disabled={ro} onPress={() => a.list("bullet")} />
							<Small icon={ListOrdered} title="Numbering" active={fmt.list === "number"} disabled={ro} onPress={() => a.list("number")} />
							<Small icon={ListChecks} title="Checklist" active={fmt.list === "check"} disabled={ro} onPress={() => a.list("check")} />
							<Sep />
							<Small icon={IndentDecrease} title="Decrease indent" disabled={ro || !fmt.canUnnest} onPress={() => a.indent(-1)} />
							<Small icon={IndentIncrease} title="Increase indent" disabled={ro || !fmt.canNest} onPress={() => a.indent(1)} />
						</Row>
						<Row>
							<Small icon={AlignLeft} title="Align left" active={fmt.align === "left"} disabled={ro} onPress={() => a.align("left")} />
							<Small icon={AlignCenter} title="Center" active={fmt.align === "center"} disabled={ro} onPress={() => a.align("center")} />
							<Small icon={AlignRight} title="Align right" active={fmt.align === "right"} disabled={ro} onPress={() => a.align("right")} />
							<Small icon={AlignJustify} title="Justify" active={fmt.align === "justify"} disabled={ro} onPress={() => a.align("justify")} />
							<Sep />
							<Small
								icon={StretchHorizontal}
								title="Line and paragraph spacing"
								menu={LINE_SPACING.map((s) => (
									<MenuItem key={s} label={s.toFixed(s % 1 ? 2 : 1)} checked={p.page.spacing === s} onPress={() => p.setPage({ spacing: s })} />
								))}
							/>
						</Row>
					</Rows>
				</Group>
				<Group label="Styles">
					<Gallery label="Styles" items={STYLES.map((s) => ({ id: s.id, label: s.label, preview: previews[s.id] }))} current={fmt.style} onPick={(id) => !ro && a.style(id as StyleId)} width={78} className="w-[330px]" />
				</Group>
				<Group label="Editing">
					<Rows>
						<Small icon={Search} label="Find" onPress={() => p.openFind(false)} />
						<Small icon={CornerDownLeft} label="Replace" disabled={ro} onPress={() => p.openFind(true)} />
					</Rows>
				</Group>
			</>
		);

	if (tab === "insert")
		return (
			<>
				<Group label="Tables">
					<Big icon={TableIcon} label="Table" disabled={ro} menu={<GridPicker onPick={a.insertTable} />} />
				</Group>
				<Group label="Illustrations">
					<Big icon={ImageIcon} label="Picture" disabled={ro} onPress={p.pickImage} />
				</Group>
				<Group label="Links">
					<Big
						icon={LinkIcon}
						label="Link"
						disabled={ro}
						menu={
							<form
								className="flex w-64 items-center gap-1 p-1"
								onSubmit={(e) => {
									e.preventDefault();
									if (link.trim()) a.insertLink(/^[a-z]+:/i.test(link.trim()) ? link.trim() : `https://${link.trim()}`);
									setLink("");
								}}
							>
								<input ref={linkInput} autoFocus aria-label="Web address" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://" className="h-7 flex-1 border bg-background px-1.5 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring" />
								<button type="submit" className="h-7 bg-[var(--office)] px-2 text-[13px] text-white">
									Add
								</button>
							</form>
						}
					/>
				</Group>
				<Group label="Header & Footer">
					<Big icon={PanelTop} label="Header & Footer" disabled={ro} active={p.hasHeaderFooter} onPress={p.openHeaderFooter} />
					<Big icon={Hash} label="Page Number" disabled={ro} onPress={p.openHeaderFooter} />
				</Group>
				<Group label="Text">
					<Rows>
						<Small icon={CalendarDays} label="Date & Time" disabled={ro} onPress={() => a.insertText(new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }))} />
						<Small
							icon={Smile}
							label="Symbol"
							disabled={ro}
							menu={
								<div className="grid w-[210px] grid-cols-9 gap-px p-1">
									{SYMBOLS.map((s) => (
										<MenuItemChar key={s} ch={s} onPress={() => a.insertText(s)} />
									))}
								</div>
							}
						/>
					</Rows>
				</Group>
			</>
		);

	if (tab === "layout")
		return (
			<>
				<Group label="Page Setup">
					<Big
						icon={Rows3}
						label="Margins"
						disabled={ro}
						menu={
							<>
								<MenuTitle>Margins</MenuTitle>
								{(Object.keys(MARGINS) as MarginName[]).map((m) => (
									<MenuItem key={m} label={`${MARGINS[m].label}  ·  ${MARGINS[m].note}`} checked={p.page.margins === m} onPress={() => p.setPage({ margins: m })} />
								))}
							</>
						}
					/>
					<Big
						icon={p.page.landscape ? RectangleHorizontal : RectangleVertical}
						label="Orientation"
						disabled={ro}
						menu={
							<>
								<MenuItem icon={RectangleVertical} label="Portrait" checked={!p.page.landscape} onPress={() => p.setPage({ landscape: false })} />
								<MenuItem icon={RectangleHorizontal} label="Landscape" checked={p.page.landscape} onPress={() => p.setPage({ landscape: true })} />
							</>
						}
					/>
					<Big
						icon={FileText}
						label="Size"
						disabled={ro}
						menu={
							<>
								<MenuTitle>Paper size</MenuTitle>
								{(Object.keys(PAPER) as PaperName[]).map((k) => (
									<MenuItem key={k} label={PAPER[k].label} hint={PAPER[k].note} checked={p.page.paper === k} onPress={() => p.setPage({ paper: k })} />
								))}
							</>
						}
					/>
					<Big
						icon={Columns2}
						label="Columns"
						disabled={ro}
						menu={
							<>
								{([1, 2, 3] as const).map((n) => (
									<MenuItem key={n} label={n === 1 ? "One" : n === 2 ? "Two" : "Three"} checked={p.page.columns === n} onPress={() => p.setPage({ columns: n })} />
								))}
							</>
						}
					/>
				</Group>
				<Group label="Paragraph">
					<Big
						icon={StretchHorizontal}
						label="Line Spacing"
						disabled={ro}
						menu={LINE_SPACING.map((s) => (
							<MenuItem key={s} label={s.toFixed(s % 1 ? 2 : 1)} checked={p.page.spacing === s} onPress={() => p.setPage({ spacing: s })} />
						))}
					/>
				</Group>
			</>
		);

	if (tab === "review")
		return (
			<>
				<Group label="Proofing">
					<Big icon={SpellCheck} label="Spelling & Grammar" onPress={p.openProofing} />
					<Big icon={SpellCheck} label="Underline Errors" active={p.view.spelling} onPress={() => p.setView({ spelling: !p.view.spelling })} />
					<Big icon={Space} label="Word Count" onPress={p.openCounts} />
				</Group>
				<Group label="Comments">
					<Big icon={MessageSquareText} label="Comments" disabled title="Comments on a document are not built yet" />
				</Group>
			</>
		);

	// View
	return (
		<>
			<Group label="Views">
				<Big icon={BookOpen} label="Read Mode" active={p.view.mode === "read"} onPress={() => p.setView({ mode: "read" })} />
				<Big icon={Printer} label="Print Layout" active={p.view.mode === "print"} onPress={() => p.setView({ mode: "print" })} />
				<Big icon={Globe} label="Web Layout" active={p.view.mode === "web"} onPress={() => p.setView({ mode: "web" })} />
			</Group>
			<Group label="Show">
				<Rows>
					<Small icon={Ruler} label="Ruler" active={p.view.ruler} onPress={() => p.setView({ ruler: !p.view.ruler })} />
					<Small icon={PanelLeft} label="Navigation Pane" active={p.view.navigation} onPress={() => p.setView({ navigation: !p.view.navigation })} />
				</Rows>
			</Group>
			<Group label="Zoom">
				<Big icon={Search} label="100%" onPress={() => p.setZoom(100)} />
				<Rows>
					<Small icon={StretchHorizontal} label="Page Width" onPress={() => p.setZoom(-1)} />
					<Small icon={Search} label="Zoom In" onPress={() => p.setZoom(Math.min(200, p.zoom + 10))} />
					<Small icon={Search} label="Zoom Out" onPress={() => p.setZoom(Math.max(50, p.zoom - 10))} />
				</Rows>
			</Group>
		</>
	);
}

const MenuItemChar = ({ ch, onPress }: { ch: string; onPress: () => void }) => (
	<button type="button" role="menuitem" onClick={onPress} className="size-5 text-center text-[14px] leading-5 outline-none hover:bg-muted focus-visible:bg-muted">
		{ch}
	</button>
);
