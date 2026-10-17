// Where things live in a workspace folder (the same layout as src-tauri/src/commands/workspace/layout.rs, which says it in full):
// office/{documents,sheets,slides}, notes, projects, assets and others. Name a folder by what it is for, never by spelling a path out.

export const LAYOUT = {
	office: "office",
	documents: "office/documents",
	sheets: "office/sheets",
	slides: "office/slides",
	notes: "notes",
	projects: "projects",
	assets: "assets",
	others: "others",
} as const;

// The folders whose contents are shared with collaborators, and the ones the Editor offers to open files from
export const SHARED_FOLDERS = [LAYOUT.notes, LAYOUT.office, LAYOUT.others, LAYOUT.assets, LAYOUT.projects] as const;
export const EDITOR_FOLDERS = [LAYOUT.projects, LAYOUT.office, LAYOUT.others, LAYOUT.notes] as const;

const bare = (path: string) => path.replace(/^\/+/, "");

// Is this workspace path (with or without a leading slash) inside the folder?
export const isIn = (path: string, folder: string) => bare(path).startsWith(`${folder}/`);

// A new file's place inside a folder
export const placeIn = (folder: string, name: string) => `${folder}/${name}`;
