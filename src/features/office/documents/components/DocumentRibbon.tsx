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
	PenLine,
	AlignVerticalSpaceAround,
	CaseSensitive,
	Paintbrush,
	Pilcrow,
	Moon,
	Focus,
	Stamp,
	Sigma,
	Brush,
	Check,
	ChevronLeft,
	ChevronRight,
	GitCompareArrows,
	X as XIcon,
} from "lucide-react";
import { useRef, useState } from "react";

import { Big, Choice, ColorButton, Gallery, GridPicker, Group, MenuItem, MenuTitle, Row, Rows, Sep, Small } from "@/features/office/shared/Ribbon";
import { type CaseKind, FONTS, HIGHLIGHTS, MARGINS, PALETTE, PAPER, SIZES, STYLES, type MarginName, type PageSetup, type PaperName, type StyleId } from "@/features/office/documents/lib/documentFormat";
import ReferencesRibbon, { TextForm, type ReferencesProps } from "@/features/office/documents/components/ReferencesRibbon";
import type { Fmt, useDocumentActions } from "@/features/office/documents/components/useDocumentActions";

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
	view: { ruler: boolean; navigation: boolean; mode: "print" | "edit" | "web" | "read"; spelling: boolean; focus: boolean; marks: boolean; dark: boolean };
	setView: (v: Partial<RibbonProps["view"]>) => void;
	zoom: number;
	setZoom: (z: number) => void;
	openFind: (replace: boolean) => void;
	openHeaderFooter: () => void;
	openCounts: () => void;
	openProofing: () => void;
	comments: { open: boolean; count: number; canComment: boolean; start: () => void; toggle: () => void };
	review: { suggesting: boolean; count: number; toggle: () => void; accept: () => void; reject: () => void; acceptAll: () => void; rejectAll: () => void; next: () => void; previous: () => void };
	openCompare: () => void;
	pickImage: () => void;
	paste: () => void;
	hasHeaderFooter: boolean;
	// Text the fields of the Insert tab put in
	fieldValues: () => { title: string; author: string; pages: number; words: number };
	refs: Omit<ReferencesProps, "tab" | "a" | "readOnly">;
}

export default function DocumentRibbon(p: RibbonProps) {
	const { tab, a, fmt, readOnly: ro } = p;
	const [link, setLink] = useState("");
	const linkInput = useRef<HTMLInputElement>(null);

	if (tab === "references" || tab === "mailings") return <ReferencesRibbon tab={tab} a={a} readOnly={ro} {...p.refs} />;

	if (tab === "home")
		return (
			<>
				<Group label="Clipboard">
					<Big icon={ClipboardPaste} label="Paste" disabled={ro} onPress={p.paste} />
					<Rows>
						<Small icon={Scissors} label="Cut" disabled={ro} onPress={() => document.execCommand("cut")} />
						<Small icon={Copy} label="Copy" onPress={() => document.execCommand("copy")} />
						<Small icon={Paintbrush} label="Format Painter" title={a.painter ? "Select text, then press again to paint the look onto it" : "Pick up the look at the caret"} active={!!a.painter} disabled={ro} onPress={a.formatPainter} />
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
							<Small
								icon={CaseSensitive}
								title="Change case of the selected text"
								disabled={ro || !fmt.hasSelection}
								menu={(
									[
										["sentence", "Sentence case."],
										["lower", "lowercase"],
										["upper", "UPPERCASE"],
										["title", "Capitalize Each Word"],
									] as [CaseKind, string][]
								).map(([k, l]) => (
									<MenuItem key={k} label={l} onPress={() => a.changeCase(k)} />
								))}
							/>
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
				<Group label="Style">
					<Big icon={Brush} label="Update Style" title="Give the look at the caret to every paragraph in the same style" disabled={ro} onPress={a.updateStyle} />
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
					<Rows>
						<Small icon={TableIcon} label="Header Row" active={fmt.headerRow} disabled={ro || !fmt.inTable} onPress={a.toggleHeaderRow} />
						<Small icon={TableIcon} label="Merge Cells" title="Select cells by dragging across them" disabled={ro || !fmt.inTable} onPress={() => a.table("merge")} />
						<Small icon={TableIcon} label="Split Cell" disabled={ro || !fmt.inTable} onPress={() => a.table("split")} />
					</Rows>
					<Rows>
						<Small icon={TableIcon} label="Sort A to Z" title="By the column the caret is in" disabled={ro || !fmt.inTable} onPress={() => a.sortTable(true)} />
						<Small icon={TableIcon} label="Sort Z to A" disabled={ro || !fmt.inTable} onPress={() => a.sortTable(false)} />
						<Small icon={TableIcon} label="Banded Rows" title="Shade every other row, shown in the editor and not written to the file" active={!!p.page.banded} disabled={ro} onPress={() => p.setPage({ banded: !p.page.banded })} />
					</Rows>
					<Rows>
						<Small
							icon={TableIcon}
							label="Formula"
							title="Add up or average the numbers above or to the left of the caret"
							disabled={ro || !fmt.inTable}
							menu={
								<>
									<MenuItem label="Sum above" onPress={() => a.tableFormula("sumAbove")} />
									<MenuItem label="Sum to the left" onPress={() => a.tableFormula("sumLeft")} />
									<MenuItem label="Average above" onPress={() => a.tableFormula("avgAbove")} />
									<MenuItem label="Average to the left" onPress={() => a.tableFormula("avgLeft")} />
								</>
							}
						/>
					</Rows>
					<Rows>
						<Small icon={TableIcon} label="Row Above" disabled={ro || !fmt.inTable} onPress={() => a.table("rowAbove")} />
						<Small icon={TableIcon} label="Row Below" disabled={ro || !fmt.inTable} onPress={() => a.table("rowBelow")} />
						<Small icon={TableIcon} label="Delete Row" disabled={ro || !fmt.inTable} onPress={() => a.table("delRow")} />
					</Rows>
					<Rows>
						<Small icon={TableIcon} label="Column Left" disabled={ro || !fmt.inTable} onPress={() => a.table("colLeft")} />
						<Small icon={TableIcon} label="Column Right" disabled={ro || !fmt.inTable} onPress={() => a.table("colRight")} />
						<Small icon={TableIcon} label="Delete Column" disabled={ro || !fmt.inTable} onPress={() => a.table("delCol")} />
					</Rows>
				</Group>
				<Group label="Illustrations">
					<Big icon={ImageIcon} label="Picture" disabled={ro} onPress={p.pickImage} />
					<Rows>
						<Small
							icon={ImageIcon}
							label="Picture Size"
							title="The picture the caret is in"
							disabled={ro || !fmt.inPicture}
							menu={
								<>
									{[200, 320, 420, 560].map((w) => (
										<MenuItem key={w} label={`${w} px wide`} onPress={() => a.picture({ width: w })} />
									))}
									<MenuItem label="Align left" onPress={() => a.picture({ align: "left" })} />
									<MenuItem label="Center" onPress={() => a.picture({ align: "center" })} />
									<MenuItem label="Align right" onPress={() => a.picture({ align: "right" })} />
									<MenuItem label="Text wraps on the right" onPress={() => a.picture({ wrap: "left" })} />
									<MenuItem label="Text wraps on the left" onPress={() => a.picture({ wrap: "right" })} />
									<MenuItem label="No wrapping" onPress={() => a.picture({ wrap: "none" })} />
								</>
							}
						/>
						<Small
							icon={ImageIcon}
							label="Crop"
							title="Crop the picture the caret is in"
							disabled={ro || !fmt.inPicture}
							menu={
								<>
									<MenuItem label="Square" onPress={() => void a.cropPicture("square")} />
									<MenuItem label="Wide (16:9)" onPress={() => void a.cropPicture("wide")} />
									<MenuItem label="Trim a tenth from each side" onPress={() => void a.cropPicture("trim")} />
								</>
							}
						/>
						<Small icon={ImageIcon} label="Alt Text" title="Describe the picture for people who cannot see it" disabled={ro || !fmt.inPicture} menu={<TextForm label="Description" button="Set" onSubmit={(t) => a.picture({ alt: t })} />} />
					</Rows>
					<Rows>
						<Small icon={TableIcon} label="Text Box" title="A box for text" disabled={ro} onPress={a.textBox} />
						<Small
							icon={ImageIcon}
							label="Shapes"
							title="A shape, drawn as a picture"
							disabled={ro}
							menu={
								<>
									{(
										[
											["rect", "Rectangle"],
											["round", "Rounded Rectangle"],
											["ellipse", "Ellipse"],
											["triangle", "Triangle"],
											["arrow", "Right Arrow"],
											["line", "Line"],
										] as const
									).map(([k, label]) => (
										<MenuItem key={k} label={label} onPress={() => a.insertShape(k, "#9DC3E6")} />
									))}
								</>
							}
						/>
					</Rows>
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
						<Small icon={Sigma} label="Equation" title="Write it as x^2, a_1, \frac{a}{b}, \sqrt{x} or \alpha" disabled={ro} menu={<TextForm label="Equation" button="Insert" onSubmit={a.insertEquation} />} />
						<Small icon={FileText} label="Page Break" disabled={ro} onPress={a.pageBreak} />
						<Small
							icon={FileText}
							label="Field"
							disabled={ro}
							menu={
								<>
									<MenuItem label="Title" onPress={() => a.insertField("title", p.fieldValues().title)} />
									<MenuItem label="Author" onPress={() => a.insertField("author", p.fieldValues().author)} />
									<MenuItem label="Date" onPress={() => a.insertField("date", new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }))} />
									<MenuItem label="Page count" onPress={() => a.insertField("pages", String(p.fieldValues().pages))} />
									<MenuItem label="Word count" onPress={() => a.insertField("words", String(p.fieldValues().words))} />
									<MenuItem label="Update all fields" onPress={() => a.updateFields({ title: p.fieldValues().title, author: p.fieldValues().author, date: new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }), pages: String(p.fieldValues().pages), words: String(p.fieldValues().words) })} />
									<MenuItem label="Text form field" onPress={a.formField} />
								</>
							}
						/>
					</Rows>
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
						icon={AlignVerticalSpaceAround}
						label="Vertical Align"
						title="Where the text sits between the top and bottom margins of each page"
						disabled={ro}
						menu={
							<>
								<MenuTitle>Vertical alignment</MenuTitle>
								{(["top", "center", "bottom", "justify"] as const).map((v) => (
									<MenuItem key={v} label={v[0].toUpperCase() + v.slice(1)} checked={p.page.valign === v} onPress={() => p.setPage({ valign: v })} />
								))}
							</>
						}
					/>
					<Big
							icon={ListOrdered}
							label="Line Numbers"
							title="A number beside each line, shown in the editor and not written to the file"
							disabled={ro}
							active={!!p.page.lineNumbers}
							onPress={() => p.setPage({ lineNumbers: !p.page.lineNumbers })}
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
				<Group label="Page Background">
					<Rows>
						<Small icon={FileText} label="Drop Cap" title="Enlarge the first letter of the document, shown in the editor and not written to the file" active={!!p.page.dropCap} disabled={ro} onPress={() => p.setPage({ dropCap: !p.page.dropCap })} />
						<Small icon={FileText} label="Page Border" title="A border inside each page, shown in the editor and not written to the file" active={!!p.page.border} disabled={ro} onPress={() => p.setPage({ border: !p.page.border })} />
						<Small icon={FileText} label="Hyphenation" title="Break long words at the end of a line, shown in the editor" active={!!p.page.hyphenate} disabled={ro} onPress={() => p.setPage({ hyphenate: !p.page.hyphenate })} />
					</Rows>
						<Big
							icon={Stamp}
							label="Watermark"
							title="Text across each page, shown in the editor and not written to the file"
							disabled={ro}
							menu={
								<>
									<MenuTitle>Watermark</MenuTitle>
									{["DRAFT", "CONFIDENTIAL", "DO NOT COPY"].map((w) => (
										<MenuItem key={w} label={w} checked={p.page.watermark === w} onPress={() => p.setPage({ watermark: w })} />
									))}
									<MenuItem label="No watermark" checked={!p.page.watermark} onPress={() => p.setPage({ watermark: "" })} />
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
					<Big icon={MessageSquareText} label="New Comment" disabled={!p.comments.canComment} title="Comment on the selected text" onPress={p.comments.start} />
					<Big icon={MessageSquareText} label={p.comments.count ? `Show Comments (${p.comments.count})` : "Show Comments"} active={p.comments.open} onPress={p.comments.toggle} />
				</Group>
				<Group label="Tracking">
					<Big icon={PenLine} label="Track Changes" title="What you type and delete is marked, for others to accept or reject" disabled={p.readOnly} active={p.review.suggesting} onPress={p.review.toggle} />
					<Rows>
						<Small icon={Check} label="Accept" disabled={p.readOnly || !p.review.count} onPress={p.review.accept} />
						<Small icon={XIcon} label="Reject" disabled={p.readOnly || !p.review.count} onPress={p.review.reject} />
					</Rows>
					<Rows>
						<Small icon={ChevronLeft} label="Previous" disabled={!p.review.count} onPress={p.review.previous} />
						<Small icon={ChevronRight} label={p.review.count ? `Next (${p.review.count})` : "Next"} disabled={!p.review.count} onPress={p.review.next} />
					</Rows>
					<Rows>
						<Small icon={Check} label="Accept All" disabled={p.readOnly || !p.review.count} onPress={p.review.acceptAll} />
						<Small icon={XIcon} label="Reject All" disabled={p.readOnly || !p.review.count} onPress={p.review.rejectAll} />
					</Rows>
				</Group>
				<Group label="Compare">
					<Big icon={GitCompareArrows} label="Compare" title="Compare this document with a saved version" onPress={p.openCompare} />
				</Group>
			</>
		);

	// View
	return (
		<>
			<Group label="Views">
				<Big icon={BookOpen} label="Read Mode" active={p.view.mode === "read"} onPress={() => p.setView({ mode: "read" })} />
				<Big icon={Printer} label="Print Layout" title="The pages as they print (read-only)" active={p.view.mode === "print"} onPress={() => p.setView({ mode: "print" })} />
				<Big icon={PenLine} label="Edit Layout" title="Type on the page" active={p.view.mode === "edit"} onPress={() => p.setView({ mode: "edit" })} />
				<Big icon={Globe} label="Web Layout" active={p.view.mode === "web"} onPress={() => p.setView({ mode: "web" })} />
			</Group>
			<Group label="Show">
				<Rows>
					<Small icon={Ruler} label="Ruler" active={p.view.ruler} onPress={() => p.setView({ ruler: !p.view.ruler })} />
					<Small icon={PanelLeft} label="Navigation Pane" active={p.view.navigation} onPress={() => p.setView({ navigation: !p.view.navigation })} />
					<Small icon={Pilcrow} label="Formatting Marks" active={p.view.marks} onPress={() => p.setView({ marks: !p.view.marks })} />
					<Small icon={Focus} label="Focus" title="Hide the ruler and the navigation pane" active={p.view.focus} onPress={() => p.setView({ focus: !p.view.focus })} />
					<Small icon={Moon} label="Dark Page" title="Light text on a dark page" active={p.view.dark} onPress={() => p.setView({ dark: !p.view.dark })} />
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
