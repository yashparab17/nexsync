// A comment thread for a task or card: who said what, @mentions highlighted, and a box to add one

import { useState } from "react";
import { Trash2 } from "@/components/animate-icons";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { completeMention, makeComment, MAX_COMMENT_LENGTH, mentionSuggestions, splitMentions } from "@/lib/comments";
import type { Comment } from "@/types/workspace";

interface CommentsProps {
	comments: Comment[];
	me: string;
	memberNames: string[];
	canComment: boolean;
	// Receives the whole new list; the page saves it and shares it
	onChange: (comments: Comment[]) => void;
}

export default function Comments({ comments, me, memberNames, canComment, onChange }: CommentsProps) {
	const [draft, setDraft] = useState("");
	const suggestions = mentionSuggestions(draft, memberNames);

	const add = () => {
		const next = makeComment(draft, me);
		if (!next) return;
		onChange([...comments, next]);
		setDraft("");
	};

	return (
		<section aria-label="Comments" className="space-y-2">
			<p className="text-xs font-semibold text-muted-foreground">Comments ({comments.length})</p>
			{comments.length > 0 && (
				<ul className="max-h-48 space-y-2 overflow-y-auto">
					{comments.map((c) => (
						<li key={c.id} className="border border-border/60 bg-muted/30 px-2.5 py-1.5 text-sm">
							<div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
								<span>
									<span className="font-semibold text-foreground">{c.author}</span> · {new Date(c.at).toLocaleString()}
								</span>
								{canComment && c.author === me && (
									<button
										type="button"
										aria-label="Delete comment"
										onClick={() => onChange(comments.filter((x) => x.id !== c.id))}
										className="cursor-pointer hover:text-destructive"
									>
										<Trash2 className="size-3.5" />
									</button>
								)}
							</div>
							<p className="mt-0.5 whitespace-pre-wrap break-words">
								{splitMentions(c.text, memberNames).map((s, i) =>
									s.mention ? (
										<span key={i} className="font-semibold text-primary">
											{s.text}
										</span>
									) : (
										<span key={i}>{s.text}</span>
									),
								)}
							</p>
						</li>
					))}
				</ul>
			)}
			{canComment && (
				<div className="space-y-1.5">
					<Textarea
						aria-label="Write a comment"
						value={draft}
						maxLength={MAX_COMMENT_LENGTH}
						rows={2}
						placeholder="Write a comment. Type @ to mention someone."
						onChange={(e) => setDraft(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
								e.preventDefault();
								add();
							}
						}}
					/>
					{suggestions.length > 0 && (
						<div className="flex flex-wrap gap-1.5">
							{suggestions.map((name) => (
								<button
									key={name}
									type="button"
									onClick={() => setDraft(completeMention(draft, name))}
									className="cursor-pointer border border-border px-1.5 py-0.5 text-xs hover:bg-muted"
								>
									@{name}
								</button>
							))}
						</div>
					)}
					<Button type="button" size="sm" variant="outline" onPress={add} isDisabled={!draft.trim()}>
						Comment
					</Button>
				</div>
			)}
		</section>
	);
}
