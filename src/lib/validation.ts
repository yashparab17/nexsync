// Checks on names people type into dialogs, so a mistake is explained on the spot instead of failing later on disk.

// Most file systems cap a name at 255 bytes
export const MAX_NAME_BYTES = 255;
export const MAX_WORKSPACE_NAME = 80;
export const MAX_TITLE = 200;

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
// eslint-disable-next-line no-control-regex
const BAD_CHARACTERS = /[<>:"/\\|?*\u0000-\u001f]/;

const bytes = (text: string) => new TextEncoder().encode(text).length;

// The reason a file or folder name cannot be used, or null when it is fine. An empty name is not an error here: the
// dialogs leave their button off until something is typed.
export function validateFileName(name: string): string | null {
	if (name.trim() === "") return null;
	if (bytes(name) > MAX_NAME_BYTES) return `That name is too long. Names can be up to ${MAX_NAME_BYTES} characters.`;
	const bad = name.match(BAD_CHARACTERS);
	if (bad) return `Names cannot contain ${bad[0] === "/" || bad[0] === "\\" ? "slashes" : /[\u0000-\u001f]/.test(bad[0]) ? "control characters" : `“${bad[0]}”`}.`;
	if (name === "." || name === "..") return "That name is not allowed.";
	if (/[. ]$/.test(name)) return "Names cannot end with a dot or a space.";
	if (WINDOWS_RESERVED.test(name.trim())) return "That name is reserved by Windows. Choose another.";
	return null;
}

// A workspace name becomes a folder name too, so it follows the file rules and a shorter limit
export function validateWorkspaceName(name: string): string | null {
	if (name.trim().length > MAX_WORKSPACE_NAME) return `Workspace names can be up to ${MAX_WORKSPACE_NAME} characters.`;
	return validateFileName(name.trim());
}

// A name for an uploaded file: unusual characters become underscores and a very long name is cut, keeping its extension
export function safeUploadName(name: string, max = 200): string {
	const clean = name.replace(/[^\w.-]/g, "_");
	if (clean.length <= max) return clean;
	const dot = clean.lastIndexOf(".");
	const ext = dot > 0 && clean.length - dot <= 10 ? clean.slice(dot) : "";
	return clean.slice(0, max - ext.length) + ext;
}
