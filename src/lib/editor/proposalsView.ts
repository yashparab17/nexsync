// Shows the open suggestions of a file inside the editor: the words they would replace are struck through, and what
// they propose appears right after, with the author's name and buttons to accept or reject it.

import { StateEffect, type Extension, type Range } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import * as Y from "yjs";

import { accept, isCurrent, locate, openProposals, reject, type Proposal } from "@/lib/proposals";

const refresh = StateEffect.define<null>();

type Act = (kind: "accept" | "reject", p: Proposal, stale: boolean) => void;

class ProposalWidget extends WidgetType {
	constructor(
		readonly p: Proposal,
		readonly stale: boolean,
		readonly canEdit: boolean,
		readonly act: Act,
	) {
		super();
	}

	eq(other: ProposalWidget) {
		return other.p.id === this.p.id && other.p.text === this.p.text && other.stale === this.stale && other.canEdit === this.canEdit;
	}

	toDOM() {
		const wrap = document.createElement("span");
		wrap.className = "cm-proposal";
		wrap.setAttribute("data-proposal", this.p.id);

		const text = document.createElement("ins");
		text.className = "cm-proposal-new";
		text.textContent = this.p.text || "(remove)";
		wrap.append(text);

		const who = document.createElement("span");
		who.className = "cm-proposal-by";
		who.textContent = `${this.p.by}${this.stale ? " · text changed since" : ""}`;
		wrap.append(who);

		if (this.canEdit) {
			for (const [kind, label] of [
				["accept", this.stale ? "Apply anyway" : "Accept"],
				["reject", "Reject"],
			] as const) {
				const button = document.createElement("button");
				button.type = "button";
				button.textContent = label;
				button.setAttribute("data-action", kind);
				// Keeps the editor's selection and focus where they were
				button.addEventListener("mousedown", (e) => e.preventDefault());
				button.addEventListener("click", () => this.act(kind, this.p, this.stale));
				wrap.append(button);
			}
		}
		return wrap;
	}

	ignoreEvent() {
		return true;
	}
}

const theme = EditorView.baseTheme({
	".cm-proposal-old": { textDecoration: "line-through", backgroundColor: "color-mix(in oklch, var(--destructive) 18%, transparent)" },
	".cm-proposal": { display: "inline-flex", alignItems: "baseline", gap: "6px", marginLeft: "2px", padding: "0 4px", backgroundColor: "color-mix(in oklch, var(--success) 15%, transparent)", outline: "1px solid color-mix(in oklch, var(--success) 40%, transparent)" },
	".cm-proposal-new": { textDecoration: "none", color: "var(--success)" },
	".cm-proposal-by": { fontSize: "0.85em", opacity: "0.7" },
	".cm-proposal button": { fontSize: "0.85em", padding: "0 4px", border: "1px solid currentColor", background: "transparent", color: "inherit", cursor: "pointer" },
});

// `me` is the name an accept or reject is recorded under; without `canEdit` the suggestions can only be read
export function proposalMarks(doc: Y.Doc, ytext: Y.Text, me: string, canEdit: boolean): Extension {
	const plugin = ViewPlugin.fromClass(
		class {
			decorations: DecorationSet;
			private gone = false;
			private readonly changed = () => {
				// A change made while the editor is mid-update cannot be dispatched straight away
				queueMicrotask(() => !this.gone && this.view.dispatch({ effects: refresh.of(null) }));
			};

			constructor(readonly view: EditorView) {
				this.decorations = this.build();
				doc.getMap("proposals").observe(this.changed);
			}

			update(update: ViewUpdate) {
				if (update.docChanged || update.viewportChanged || update.transactions.some((tr) => tr.effects.some((e) => e.is(refresh)))) this.decorations = this.build();
			}

			destroy() {
				this.gone = true;
				doc.getMap("proposals").unobserve(this.changed);
			}

			private build(): DecorationSet {
				const act: Act = (kind, p, stale) => {
					if (kind === "accept") accept(doc, ytext, p.id, me, stale);
					else reject(doc, p.id, me);
				};
				const length = this.view.state.doc.length;
				const ranges: Range<Decoration>[] = [];
				for (const p of openProposals(doc)) {
					const at = locate(doc, p);
					if (!at || at.to > length) continue;
					if (at.to > at.from) ranges.push(Decoration.mark({ class: "cm-proposal-old" }).range(at.from, at.to));
					ranges.push(Decoration.widget({ widget: new ProposalWidget(p, !isCurrent(doc, ytext, p), canEdit, act), side: 1 }).range(at.to));
				}
				return Decoration.set(ranges, true);
			}
		},
		{ decorations: (v) => v.decorations },
	);
	return [plugin, theme];
}
