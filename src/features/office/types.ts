// Office documents: what a file holds, and what the editor was given from it

// How a document sits on paper: written into the file with the text
export interface OfficeLayout {
	width: number;
	height: number;
	landscape: boolean;
	top: number;
	right: number;
	bottom: number;
	left: number;
	columns: number;
	spacing: number;
	header: string;
	footer: string;
	pageNumbers: boolean;
	// Where the text sits between the top and bottom margins: top, center, bottom or justify
	valign: string;
}

export interface OfficeInspect {
	words: number;
	images: number;
	comments: number;
	revisions: number;
	// Everyone named in the file's properties, comments and tracked changes
	people: string[];
	title: string;
	created: string;
	modified: string;
	macros: boolean;
	embedded: string[];
	// Addresses the file points at outside itself; none is fetched
	external: string[];
	// Parts of the file that did not come into the editor
	leftOut: string[];
}

export interface Imported {
	html: string;
	title: string;
	inspect: OfficeInspect;
	// The page set-up the file has
	layout: OfficeLayout;
	// The file as it was read, kept by the backend so that drawing or saving brings back what the editor does not hold
	sourceId: string | null;
}

export interface ImportAnswer {
	imported: Imported | null;
	error: string | null;
	// A password would open it
	password: boolean;
}
