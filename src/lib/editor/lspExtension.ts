// The editor side of language intelligence: the text of the open file goes to the file's language server as it changes, and what
// the server says comes back as problem marks, hover cards, completions and go to definition (Ctrl or Cmd+click, or F12).

import type { CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { forceLinting, linter, type Diagnostic } from "@codemirror/lint";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, hoverTooltip, keymap, ViewPlugin, type ViewUpdate } from "@codemirror/view";

import { completionsOf, diagnosticsOf, firstPlace, hoverText, offsetOf, onFileDiagnostics, severityOf, type LspPosition } from "@/lib/lsp";
import { lspClose, lspRequest, lspSync } from "@/lib/tauri";

export interface LspOptions {
	workspacePath: string;
	project: string;
	// Inside the project
	rel: string;
	// Called with a place in the project to show (Ctrl or Cmd+click, F12)
	onOpen: (rel: string, line: number) => void;
	// Called when the file has no server, or the server failed, with a sentence for the person
	onNotice?: (text: string) => void;
}

const positionAt = (state: EditorState, pos: number): LspPosition => {
	const line = state.doc.lineAt(pos);
	return { line: line.number - 1, character: pos - line.from };
};

export function lspExtension(o: LspOptions): Extension {
	let version = 0;
	let timer: ReturnType<typeof setTimeout> | null = null;
	let current: EditorView | null = null;
	let dirty = false;
	let inFlight: Promise<unknown> = Promise.resolve();

	// Sends the text now if it changed since the last time; every question waits for this, so the server answers about what is on screen
	const flush = (): Promise<unknown> => {
		if (timer) clearTimeout(timer);
		timer = null;
		if (!current || !dirty) return inFlight;
		dirty = false;
		const text = current.state.doc.toString();
		inFlight = lspSync(o.workspacePath, o.project, o.rel, text, ++version).catch((e) => o.onNotice?.(String(e?.message ?? e)));
		return inFlight;
	};

	const ask = async <T>(view: EditorView, method: string, pos: number, extra: object = {}): Promise<T | null> => {
		await flush();
		try {
			return await lspRequest<T>(o.workspacePath, o.project, o.rel, method, { position: positionAt(view.state, pos), ...extra });
		} catch {
			return null;
		}
	};

	const sync = ViewPlugin.fromClass(
		class {
			offDiagnostics: () => void;
			constructor(view: EditorView) {
				current = view;
				dirty = true;
				void flush();
				// Problems arrive when the server has them: lint again so they are drawn
				this.offDiagnostics = onFileDiagnostics(o.project, o.rel, () => forceLinting(view));
			}
			update(u: ViewUpdate) {
				if (!u.docChanged) return;
				dirty = true;
				if (timer) clearTimeout(timer);
				timer = setTimeout(() => void flush(), 300);
			}
			destroy() {
				this.offDiagnostics();
				if (timer) clearTimeout(timer);
				if (current) current = null;
				void lspClose(o.workspacePath, o.project, o.rel).catch(() => {});
			}
		},
	);

	// The server's problems, merged with the editor's own syntax problems by the lint extension
	const problems = linter(
		(view): Diagnostic[] =>
			diagnosticsOf(o.project, o.rel).map((d) => {
				const from = offsetOf(view.state.doc, d.range.start);
				const to = Math.max(offsetOf(view.state.doc, d.range.end), from);
				return { from, to: to === from ? Math.min(from + 1, view.state.doc.length) : to, severity: severityOf(d.severity), message: d.message, source: d.source };
			}),
		{ delay: 50 },
	);

	const hover = hoverTooltip(
		async (view, pos) => {
			const result = await ask<unknown>(view, "textDocument/hover", pos);
			const text = hoverText(result);
			if (!text) return null;
			return {
				pos,
				above: true,
				create() {
					const dom = document.createElement("div");
					dom.className = "cm-tooltip-section";
					dom.style.cssText = "max-width:480px;max-height:240px;overflow:auto;padding:6px 8px;white-space:pre-wrap;font-size:12px";
					dom.textContent = text;
					return { dom };
				},
			};
		},
		{ hideOnChange: true },
	);

	const complete = async (ctx: CompletionContext): Promise<CompletionResult | null> => {
		const word = ctx.matchBefore(/[\w$]*/);
		const after = ctx.pos > 0 ? ctx.state.doc.sliceString(ctx.pos - 1, ctx.pos) : "";
		if (!ctx.explicit && (!word || (word.from === word.to && !/[.:>"'/@<]/.test(after)))) return null;
		const view = current;
		if (!view) return null;
		const result = await ask<unknown>(view, "textDocument/completion", ctx.pos);
		if (ctx.aborted) return null;
		const items = completionsOf(result, ctx.state.doc);
		if (items.length === 0) return null;
		return {
			from: word ? word.from : ctx.pos,
			options: items.map((i) => ({ label: i.label, detail: i.detail, type: i.type, apply: i.from !== undefined && i.to !== undefined ? (v: EditorView) => v.dispatch({ changes: { from: i.from!, to: i.to!, insert: i.apply } }) : i.apply })),
			// The server filters by what is typed; ask again as the word grows only when it turns out to be a different word
			validFor: /^[\w$]*$/,
		};
	};

	const definition = async (view: EditorView, pos: number): Promise<boolean> => {
		const place = firstPlace(await ask<unknown>(view, "textDocument/definition", pos));
		if (!place) {
			o.onNotice?.("No definition found.");
			return false;
		}
		if (!place.rel) {
			o.onNotice?.("That is defined outside this project.");
			return true;
		}
		if (place.rel === o.rel) {
			const target = offsetOf(view.state.doc, { line: place.line, character: place.character });
			view.dispatch({ selection: { anchor: target }, scrollIntoView: true });
			view.focus();
		} else {
			o.onOpen(place.rel, place.line + 1);
		}
		return true;
	};

	return [
		sync,
		problems,
		hover,
		EditorState.languageData.of(() => [{ autocomplete: complete }]),
		EditorView.domEventHandlers({
			mousedown(e, view) {
				if (!(e.ctrlKey || e.metaKey) || e.button !== 0) return false;
				const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
				if (pos === null) return false;
				e.preventDefault();
				void definition(view, pos);
				return true;
			},
		}),
		keymap.of([{ key: "F12", run: (view) => (void definition(view, view.state.selection.main.head), true) }]),
	];
}
