import { useState } from "react";
import * as Y from "yjs";

import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MAX_PROPOSAL_TEXT, propose } from "@/lib/proposals";

interface SuggestEditDialogProps {
	doc: Y.Doc;
	userName: string;
	// The part of the text the suggestion is about; an empty range suggests adding text at that spot
	from: number;
	to: number;
	onClose: () => void;
}

// Writes down a change to part of a text for the others to accept or reject, without changing the text itself
export default function SuggestEditDialog({ doc, userName, from, to, onClose }: SuggestEditDialogProps) {
	const ytext = doc.getText("content");
	const original = ytext.toString().slice(from, to);
	const [text, setText] = useState(original);
	const [error, setError] = useState<string | null>(null);

	const submit = () => {
		try {
			propose(doc, ytext, from, to, text, userName);
			onClose();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	};

	return (
		<Dialog isOpen onOpenChange={(open) => !open && onClose()} className="sm:max-w-lg">
			<div className="flex flex-col gap-4">
				<DialogHeader>
					<DialogTitle>Suggest an edit</DialogTitle>
					<DialogDescription>
						{from === to ? "Write what should be added here." : "Change what is below to what you want it to say."} The text is not changed. The others see your suggestion in the file and can accept or
						reject it.
					</DialogDescription>
				</DialogHeader>
				{original && <pre className="max-h-32 overflow-auto border bg-muted/40 p-2 text-xs whitespace-pre-wrap">{original}</pre>}
				<div className="space-y-1">
					<Label htmlFor="suggested-text">{from === to ? "Add" : "Replace with"}</Label>
					<Textarea id="suggested-text" autoFocus value={text} maxLength={MAX_PROPOSAL_TEXT} onChange={(e) => setText(e.target.value)} placeholder="Leave empty to suggest removing the text" className="min-h-24 border-input px-2" />
				</div>
				{error && (
					<p role="alert" className="border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
						{error}
					</p>
				)}
				<div className="flex justify-end gap-2">
					<Button variant="ghost" onPress={onClose}>
						Cancel
					</Button>
					<Button onPress={submit} isDisabled={text === original}>
						Suggest
					</Button>
				</div>
			</div>
		</Dialog>
	);
}
