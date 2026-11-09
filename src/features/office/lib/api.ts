// The Office commands of the backend (documents, workbooks, decks), kept with the Office feature that owns their types.

import { invoke } from "@tauri-apps/api/core";

import type { ImportAnswer, OfficeInspect, OfficeLayout } from "@/features/office/types";
import type { ChartPrim, SheetIn, SheetOut } from "@/features/office/sheets/lib/sheet";
import type { Frame } from "@/features/office/slides/lib/deck";

// Opens a document file of the workspace (.docx, .odt, .rtf, .md, .html, .txt) as HTML for the editor, with what it holds
export function officeImport(path: string, rel: string, password?: string | null): Promise<ImportAnswer> {
	return invoke("office_import", { path, rel, password: password ?? null });
}
// The lines of a kept version of a document (a paragraph, or a table row with tabs between its cells), for Compare
// The lines of another document of the workspace, for Compare
export function officeFileLines(path: string, relPath: string): Promise<string[]> {
	return invoke("office_file_lines", { path, relPath });
}
export function officeVersionLines(path: string, id: number, ext: string): Promise<string[]> {
	return invoke("office_version_lines", { path, id, ext });
}
// Writes the editor's HTML as the file `dest` names (.docx, .odt, .rtf, .md, .html, .txt, .tex); `author` empty leaves the file unnamed
export function officeExport(path: string, dest: string, html: string, title: string, author: string, layout?: OfficeLayout | null, sourceId?: string | null, password?: string | null): Promise<number> {
	return invoke("office_export", { path, dest, html, title, author, layout: layout ?? null, sourceId: sourceId ?? null, password: password || null });
}
export function officeInspect(path: string, rel: string): Promise<OfficeInspect> {
	return invoke("office_inspect", { path, rel });
}
// What each cell of a workbook shows, worked out by the spreadsheet engine from what was typed
export function sheetCalculate(sheets: SheetIn[]): Promise<{ sheets: SheetOut[]; truncated: boolean; refused: [string, string, string][] }> {
	return invoke("sheet_calculate", { sheets });
}
// Inserts or deletes rows or columns (at is 0-based); the engine rewrites the formulas that point at moved cells
export function sheetRestructure(sheets: SheetIn[], sheet: string, op: "insertRows" | "deleteRows" | "insertCols" | "deleteCols", at: number, count: number): Promise<SheetIn[]> {
	return invoke("sheet_restructure", { sheets, sheet, op, at, count });
}
export function sheetOpen(path: string, rel: string): Promise<{ sheets: SheetIn[]; notes: string[] }> {
	return invoke("sheet_open", { path, rel });
}
// Saves the workbook as .xlsx, or the named sheet as .csv or .tsv
export function sheetSave(path: string, dest: string, sheets: SheetIn[], sheet: string): Promise<number> {
	return invoke("sheet_save", { path, dest, sheets, sheet });
}
// Sorts the rows of a range by one column, keeping each row's looks with it
export function sheetSort(sheets: SheetIn[], sheet: string, range: string, column: string, descending: boolean, header: boolean): Promise<SheetIn[]> {
	return invoke("sheet_sort", { sheets, sheet, range, column, descending, header });
}
// A chart of a range, as shapes and text to paint
export function sheetChart(sheets: SheetIn[], sheet: string, spec: { range: string; kind: string; title: string; w: number; h: number; opts?: object }): Promise<ChartPrim[]> {
	return invoke("sheet_chart", { sheets, sheet, spec });
}
// Slide decks: the pieces of a deck from a file, a slide drawn as a picture, and the small edits the slide editor makes
export interface DeckParts {
	base: string;
	slides: string[];
}
export interface DeckRendered {
	png: string;
	widthPt: number;
	heightPt: number;
	frames: Frame[];
}
export function deckNew(): Promise<{ parts: DeckParts; notes: string[] }> {
	return invoke("deck_new");
}
export function deckOpen(path: string, rel: string): Promise<{ parts: DeckParts; notes: string[] }> {
	return invoke("deck_open", { path, rel });
}
// Keeps the deck's base on the backend for drawing; returns its id
export function deckRegister(base: string): Promise<string> {
	return invoke("deck_register", { base });
}
export function deckRender(baseId: string, slide: string, scale: number): Promise<DeckRendered> {
	return invoke("deck_render", { baseId, slide, scale });
}
export function deckLayouts(baseId: string): Promise<{ id: number; name: string }[]> {
	return invoke("deck_layouts", { baseId });
}
export function deckNewSlide(baseId: string, layout: number): Promise<string> {
	return invoke("deck_new_slide", { baseId, layout });
}
export function deckNewShape(kind: string, id: number, x: number, y: number, w: number, h: number): Promise<string> {
	return invoke("deck_new_shape", { kind, id, x, y, w, h });
}
export interface ShapeEdit {
	text?: string;
	// RRGGBB, or "" for no fill
	fill?: string;
	bold?: boolean;
	italic?: boolean;
	size?: number;
	color?: string;
	x?: number;
	y?: number;
	w?: number;
	h?: number;
	rot?: number;
	underline?: boolean;
	font?: string;
	align?: "left" | "center" | "right" | "justify";
	// The outline: RRGGBB, or "" for none
	line?: string;
	lineWidth?: number;
	// The characters [start, end) of the text the look edits apply to; all of it when left out
	range?: [number, number];
	bullet?: "none" | "dot" | "dash" | "num" | "alpha" | "roman";
	// A multiple of the text's height; 1 is single
	lineSpacing?: number;
	// Points
	spaceBefore?: number;
	spaceAfter?: number;
	// Moves the paragraphs in (+1) or out (-1) a level
	level?: number;
}
export interface TableEdit {
	insertRow?: number;
	deleteRow?: number;
	insertCol?: number;
	deleteCol?: number;
	// The text of every cell, row by row
	cells?: string[][];
	header?: boolean;
	banded?: boolean;
}
// The settings of a slide that are not its shapes
export interface SlideEdit {
	notes?: string;
	transition?: string;
	hidden?: boolean;
	// RRGGBB, or "" to follow the layout
	background?: string;
	// Seconds after which the slide moves on by itself; 0 for never
	advanceAfter?: number;
	advanceOnClick?: boolean;
	// Seconds the transition takes
	duration?: number;
}
export function deckEditSlide(slide: string, edit: SlideEdit): Promise<string> {
	return invoke("deck_edit_slide", { slide, edit });
}
// A picture for the deck: the new base that holds it, and the picture shape for a slide
export function deckAddPicture(base: string, name: string, data: string, id: number, x: number, y: number, w: number, h: number): Promise<[string, string]> {
	return invoke("deck_add_picture", { base, name, data, id, x, y, w, h });
}
export function deckEditShape(shape: string, edit: ShapeEdit): Promise<string> {
	return invoke("deck_edit_shape", { shape, edit });
}
export function deckNewTable(id: number, rows: number, cols: number, x: number, y: number, w: number, h: number): Promise<string> {
	return invoke("deck_new_table", { id, rows, cols, x, y, w, h });
}
export function deckEditTable(shape: string, edit: TableEdit): Promise<string> {
	return invoke("deck_edit_table", { shape, edit });
}
export function deckGroup(shapes: string[], id: number): Promise<string> {
	return invoke("deck_group", { shapes, id });
}
export function deckUngroup(shape: string): Promise<string[]> {
	return invoke("deck_ungroup", { shape });
}
// A slide moved to another layout (the new placeholders get ids from firstId)
export function deckApplyLayout(baseId: string, slide: string, layout: number, firstId: number): Promise<string> {
	return invoke("deck_apply_layout", { baseId, slide, layout, firstId });
}
// The shape with `find` replaced, and how many were
export function deckReplace(shape: string, find: string, withText: string, matchCase: boolean, first: boolean): Promise<[string, number]> {
	return invoke("deck_replace", { shape, find, with: withText, matchCase, first });
}
export function deckSave(path: string, dest: string, base: string, slides: string[]): Promise<number> {
	return invoke("deck_save", { path, dest, base, slides });
}

// A document's pages as pictures, laid out and drawn by the word-processor engine (for Print Layout)
export interface PageImage {
	png: string;
	widthPt: number;
	heightPt: number;
	// Where the text goes on the page: between the margins, less what a header or footer reaches into them
	bodyTopPt: number;
	bodyHeightPt: number;
}
export function officeRender(html: string, title: string, layout: OfficeLayout | null, scale: number, sourceId?: string | null): Promise<PageImage[]> {
	return invoke("office_render", { html, title, layout, scale, sourceId: sourceId ?? null });
}

// A document laid out once (the slow part), kept on the backend under a session id; its pages are then drawn one at a time as they scroll into view
export interface PageList {
	session: number;
	sizes: [number, number][];
}
export function officeLayout(html: string, title: string, layout: OfficeLayout | null, sourceId?: string | null): Promise<PageList> {
	return invoke("office_layout", { html, title, layout, sourceId: sourceId ?? null });
}
export function officePage(session: number, index: number, scale: number): Promise<PageImage> {
	return invoke("office_page", { session, index, scale });
}
// Page `index` of a document the editor shows on `pages` pages, with only the header and footer of the file it came from drawn on it
export function officeMargins(sourceId: string, pages: number, index: number, scale: number): Promise<PageImage> {
	return invoke("office_margins", { sourceId, pages, index, scale });
}
