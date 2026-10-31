// What one open file in the Editor tells the page about itself, and what the page can ask it to do

export interface CodeTabStatus {
	language: string;
	dirty: boolean;
	saving: boolean;
	readOnly: boolean;
	// The name of the branch being worked on, if any
	branch: string | null;
	// Lines that have a syntax problem
	problemLines: number[];
	canFormat: boolean;
	canSuggest: boolean;
	hasBranches: boolean;
}

export interface CodeTabHandle {
	save: () => Promise<void>;
	format: () => Promise<void>;
	find: () => void;
	history: () => void;
	branches: () => void;
	suggest: () => void;
	undo: () => void;
	redo: () => void;
	goToLine: (line: number) => void;
	focus: () => void;
}
