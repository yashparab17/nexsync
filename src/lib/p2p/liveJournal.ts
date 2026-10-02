// Turns a collaborator's live typing into a few catch-up entries instead of one per keystroke.
//
// Each remote change arrives as (text before, text after). Changes that follow one another with nothing local in
// between are one burst; a local edit in between, or a quiet spell, ends it. That keeps the burst's before/after
// free of this device's own typing, so the author is never credited with it.

export type TextSink = (docId: string, who: string | null, before: string, after: string) => void;

interface Burst {
	who: string | null;
	before: string;
	after: string;
	timer: ReturnType<typeof setTimeout>;
}

export const QUIET_MS = 4000;

export class LiveJournal {
	private bursts = new Map<string, Burst>();

	constructor(
		private sink: TextSink,
		private quietMs = QUIET_MS,
	) {}

	// A peer's update changed the text of an open document from `before` to `after`
	record(docId: string, who: string | null, before: string, after: string) {
		if (before === after) return;
		const open = this.bursts.get(docId);
		if (open && open.who === who && open.after === before) {
			clearTimeout(open.timer);
			open.after = after;
			open.timer = setTimeout(() => this.flush(docId), this.quietMs);
			return;
		}
		this.flush(docId);
		this.bursts.set(docId, { who, before, after, timer: setTimeout(() => this.flush(docId), this.quietMs) });
	}

	// Writes down what is pending for one document, or for all of them
	flush(docId?: string) {
		for (const id of docId === undefined ? [...this.bursts.keys()] : [docId]) {
			const burst = this.bursts.get(id);
			if (!burst) continue;
			clearTimeout(burst.timer);
			this.bursts.delete(id);
			this.sink(id, burst.who, burst.before, burst.after);
		}
	}
}
