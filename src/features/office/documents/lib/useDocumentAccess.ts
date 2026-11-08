// Who may do what in an open document: the Restrict Editing choice and the locked sections, both kept in the shared document so every
// device reads the same, and the person's role. One place answers "may this person edit, comment, change the rules?".

import { useEffect, useMemo, useState } from "react";
import type * as Y from "yjs";

import { access, isRestriction, type Restriction } from "@/features/office/documents/lib/documentRestrict";
import { useChat } from "@/store/chat/ChatContext";

const readRestriction = (settings: Y.Map<string>): Restriction => {
	const v = settings.get("restrict");
	return isRestriction(v) ? v : "none";
};

const readLocked = (settings: Y.Map<string>): string[] => {
	try {
		const list = JSON.parse(settings.get("lockedSections") ?? "[]");
		return Array.isArray(list) ? list.filter((k): k is string => typeof k === "string") : [];
	} catch {
		return [];
	}
};

// A value read from the shared settings, read again when they change
function useSetting<T>(settings: Y.Map<string>, read: (s: Y.Map<string>) => T): T {
	const [value, setValue] = useState(() => read(settings));
	useEffect(() => {
		const update = () => setValue(read(settings));
		update();
		settings.observe(update);
		return () => settings.unobserve(update);
		// eslint-disable-next-line react-hooks/exhaustive-deps -- `read` is one of the two functions above, which never change
	}, [settings]);
	return value;
}

export function useDocumentAccess(doc: Y.Doc, base: { readOnly: boolean; canComment: boolean }) {
	const role = useChat().role;
	const isAdmin = role === "Owner" || role === "Admin";
	const settings = useMemo(() => doc.getMap<string>("docSettings"), [doc]);
	const restriction = useSetting(settings, readRestriction);
	const lockedKeys = useSetting(settings, readLocked);
	const { readOnly, canComment } = access(restriction, isAdmin, base);
	// Setting the rules is for an Owner or an Admin who can edit the document at all
	const canSetRules = isAdmin && !base.readOnly;
	return {
		isAdmin,
		readOnly,
		canComment,
		restriction,
		restricted: restriction !== "none" && !isAdmin,
		canSetRules,
		setRestriction: (r: Restriction) => settings.set("restrict", r),
		lockedKeys,
		toggleSectionLock: (key: string) => settings.set("lockedSections", JSON.stringify(lockedKeys.includes(key) ? lockedKeys.filter((k) => k !== key) : [...lockedKeys, key])),
	};
}
