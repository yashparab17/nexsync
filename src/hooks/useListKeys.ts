import { useEffect, useRef } from "react";

// Keys for any list page, the Linear way: j and k move through the rows marked `data-nav`, Enter opens the one focused
// (it is a button), n makes a new one and / jumps to the page's search box. Typing in a field, an open popup or any
// modifier key leaves them alone.
export function useListKeys(onNew?: () => void) {
	const newRef = useRef(onNew);
	newRef.current = onNew;
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
			if ((e.target as HTMLElement | null)?.closest?.("input,textarea,select,[contenteditable]:not([contenteditable=false]),.cm-editor,[role=menu]")) return;
			if (document.querySelector("[role=dialog]")) return;
			if (e.key === "/") {
				const box = document.querySelector<HTMLInputElement>("input[type=search]");
				if (box) (e.preventDefault(), box.focus());
			} else if (e.key === "n" && newRef.current) {
				e.preventDefault();
				newRef.current();
			} else if (e.key === "j" || e.key === "k") {
				const rows = [...document.querySelectorAll<HTMLElement>("[data-nav]")].filter((el) => !el.closest("[hidden]"));
				if (!rows.length) return;
				const at = rows.indexOf(document.activeElement as HTMLElement);
				const next = rows[at < 0 ? 0 : Math.min(rows.length - 1, Math.max(0, at + (e.key === "j" ? 1 : -1)))];
				e.preventDefault();
				next.focus();
				next.scrollIntoView?.({ block: "nearest" });
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);
}
