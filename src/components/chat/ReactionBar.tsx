// Emoji under a comment: the ones already given, with who gave them, and a small picker to add more.

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { SmilePlus } from "@/components/animate-icons";

import { EMOJI } from "@/components/chat/MessageList";
import type { Reaction } from "@/lib/chat/entries";
import { cn } from "@/lib/utils";

interface ReactionBarProps {
	reactions: Reaction[];
	me: string;
	canReact: boolean;
	onReact: (emoji: string) => void;
}

export default function ReactionBar({ reactions, me, canReact, onReact }: ReactionBarProps) {
	const [picking, setPicking] = useState(false);
	if (reactions.length === 0 && !canReact) return null;
	return (
		<div className="mt-1 flex flex-wrap items-center gap-1">
			{reactions.map((r) => {
				const mine = r.authors.includes(me);
				return (
					<button
						key={r.emoji}
						type="button"
						disabled={!canReact}
						aria-pressed={mine}
						aria-label={`${r.emoji} ${r.authors.length}${mine ? ", you reacted" : ""}`}
						onClick={() => onReact(r.emoji)}
						className={cn("flex h-6 cursor-pointer items-center gap-1 rounded-md px-2 text-[13px] outline-none disabled:cursor-default", mine ? "bg-primary/20 outline outline-1 -outline-offset-1 outline-primary" : "bg-muted hover:bg-muted/70")}
					>
						<span>{r.emoji}</span>
						<span className="font-mono tabular-nums">{r.authors.length}</span>
					</button>
				);
			})}
			{canReact &&
				(picking ? (
					EMOJI.map((e) => (
						<button
							key={e}
							type="button"
							aria-label={`React with ${e}`}
							onClick={() => {
								onReact(e);
								setPicking(false);
							}}
							className="flex size-6 cursor-pointer items-center justify-center rounded-md text-[13px] hover:bg-muted"
						>
							{e}
						</button>
					))
				) : (
					<Button variant="ghost" size="icon-xs" aria-label="Add reaction" onPress={() => setPicking(true)} className="size-6 text-muted-foreground">
						<SmilePlus className="size-3.5" />
					</Button>
				))}
		</div>
	);
}
