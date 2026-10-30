// Restrict Editing: an Owner or Admin can make a document comments-only or read-only for everyone else. The choice is kept in the shared
// document, so every device sees it. It is enforced by this app on each device (a changed copy of the app could ignore it), the same as
// Protect Sheet; the roles of the workspace are still what the host's links check.

export type Restriction = "none" | "comments" | "read";

export const RESTRICTIONS: [Restriction, string][] = [
	["none", "Everyone who can edit"],
	["comments", "Comments only"],
	["read", "Read only"],
];

export const isRestriction = (v: unknown): v is Restriction => v === "none" || v === "comments" || v === "read";

// What a person may do: Owners and Admins are never restricted; for everyone else a restriction takes away editing, and "read" also commenting
export function access(restriction: Restriction, isAdmin: boolean, base: { readOnly: boolean; canComment: boolean }): { readOnly: boolean; canComment: boolean } {
	if (isAdmin || restriction === "none") return base;
	if (restriction === "comments") return { readOnly: true, canComment: base.canComment };
	return { readOnly: true, canComment: false };
}
