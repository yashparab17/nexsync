import { useState } from "react";

import { MessageSquareText } from "@/components/animate-icons";
import { Button } from "@/components/ui/button";
import { Dialog, DialogHeading } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

// Starts a thread on the selected words. The words are shown so the writer sees what the comment will be attached to.
export default function NewCommentDialog({ quote, onClose, onSubmit }: { quote: string; onClose: () => void; onSubmit: (text: string) => Promise<void> }) {
	const [text, setText] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	const submit = async () => {
		if (!text.trim() || busy) return;
		setBusy(true);
		try {
			await onSubmit(text.trim());
			onClose();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
			setBusy(false);
		}
	};

	return (
		<Dialog isOpen onOpenChange={(open) => !open && onClose()} className="sm:max-w-lg">
			<div className="flex flex-col gap-4">
				<DialogHeading icon={<MessageSquareText className="size-6" />} title="New Comment" />
				<pre className="max-h-32 overflow-auto bg-muted/40 p-2 font-mono text-[13px] whitespace-pre-wrap">{quote}</pre>
				<div className="space-y-1">
					<Label htmlFor="comment-text">Comment</Label>
					<textarea
						id="comment-text"
						autoFocus
						value={text}
						maxLength={4000}
						onChange={(e) => setText(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
								e.preventDefault();
								void submit();
							}
						}}
						placeholder="Say what you think. Type @ and a name to mention someone."
						className="min-h-24 w-full resize-y rounded-md bg-input p-2 text-sm outline-none placeholder:text-muted-foreground"
					/>
				</div>
				{error && (
					<p role="alert" className="bg-destructive/10 p-2 text-sm text-destructive">
						{error}
					</p>
				)}
				<div className="flex justify-end gap-2">
					<Button variant="ghost" onPress={onClose}>
						Cancel
					</Button>
					<Button onPress={() => void submit()} isDisabled={!text.trim() || busy}>
						Comment
					</Button>
				</div>
			</div>
		</Dialog>
	);
}
