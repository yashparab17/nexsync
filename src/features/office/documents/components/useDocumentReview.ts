import { TextSelection } from "@tiptap/pm/state";
import { useEffect, useMemo, useState } from "react";

import type { DocumentEditorType } from "@/features/office/documents/lib/documentSchema";
import { changesOf, nextChange, resolveChanges, type Change, type ReviewStore } from "@/features/office/documents/lib/documentReview";

// Tracked changes for the Review tab: whether this person is suggesting, the changes in the text, and accepting, rejecting and moving
// between them. The marks are in the shared text (see `documentReview`).
export function useDocumentReview(editor: DocumentEditorType, store: ReviewStore) {
	const [suggesting, setSuggesting] = useState(false);
	const [tick, setTick] = useState(0);
	useEffect(() => {
		let timer: ReturnType<typeof setTimeout> | undefined;
		const off = editor.onChange(() => {
			clearTimeout(timer);
			timer = setTimeout(() => setTick((t) => t + 1), 150);
		});
		return () => {
			off?.();
			clearTimeout(timer);
		};
	}, [editor]);
	const changes = useMemo<Change[]>(() => {
		try {
			return changesOf(editor.prosemirrorState.doc);
		} catch {
			return [];
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [editor, tick]);

	// The changes the selection touches, or, with the caret in none, the next one
	const target = (): Change[] => {
		const { from, to } = editor.prosemirrorState.selection;
		const live = changesOf(editor.prosemirrorState.doc);
		const hit = live.filter((c) => c.to >= from && c.from <= to);
		if (hit.length) return hit;
		const next = nextChange(live, to);
		return next ? [next] : [];
	};
	const go = (backwards: boolean) => {
		const view = editor.prosemirrorView;
		const { from, to } = view.state.selection;
		const c = nextChange(changesOf(view.state.doc), backwards ? from : to, backwards);
		if (!c) return;
		view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, c.from, c.to)).scrollIntoView());
		view.focus();
	};
	const resolve = (list: Change[], accept: boolean) => {
		if (list.length) resolveChanges(editor.prosemirrorView, list, accept, store);
	};
	// One change by itself, found again in the text as it is now
	const live = (c: Change) => changesOf(editor.prosemirrorState.doc).find((x) => x.kind === c.kind && x.from === c.from);
	return {
		suggesting,
		changes,
		count: changes.length,
		goTo: (c: Change) => {
			const view = editor.prosemirrorView;
			const now = live(c) ?? c;
			view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, Math.min(now.from, view.state.doc.content.size), Math.min(now.to, view.state.doc.content.size))).scrollIntoView());
			view.focus();
		},
		resolveOne: (c: Change, accept: boolean) => {
			const now = live(c);
			if (now) resolve([now], accept);
		},
		toggle: () => {
			store.suggesting = !store.suggesting;
			setSuggesting(store.suggesting);
		},
		accept: () => resolve(target(), true),
		reject: () => resolve(target(), false),
		acceptAll: () => resolve(changesOf(editor.prosemirrorState.doc), true),
		rejectAll: () => resolve(changesOf(editor.prosemirrorState.doc), false),
		next: () => go(false),
		previous: () => go(true),
	};
}
