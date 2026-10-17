// A message's text with its little formatting: bold, italic, code, note links and mentions. Built from React elements, never
// from HTML, so nothing a person types can add markup to the page.

import { parseMessage } from "@/features/chat/lib/format";
import type { Person } from "@/features/chat/lib/mentions";
import { cn } from "@/lib/utils";

interface RichTextProps {
	text: string;
	people: Person[];
	me: string; // This device's key: a mention of me is highlighted more
	onOpenNote?: (name: string) => void;
	// A [[task:id]] or [[card:id]] reference shows the item's title and opens it
	refTitle?: (entity: "task" | "card", id: string) => string | undefined;
	onOpenRef?: (entity: "task" | "card", id: string) => void;
	// An attachment shows as whatever this makes of its path in the workspace
	renderFile?: (path: string) => React.ReactNode;
}

export default function RichText({ text, people, me, onOpenNote, refTitle, onOpenRef, renderFile }: RichTextProps) {
	return (
		<div className="min-w-0 space-y-1 text-sm whitespace-pre-wrap [overflow-wrap:anywhere]">
			{parseMessage(text, people).map((block, i) =>
				block.type === "code" ? (
					<pre key={i} className="overflow-x-auto rounded-md bg-muted/60 p-3 font-mono text-[13px] whitespace-pre">
						{block.text}
					</pre>
				) : (
					<p key={i}>
						{block.inline.map((part, j) => {
							switch (part.type) {
								case "bold":
									return <strong key={j}>{part.text}</strong>;
								case "italic":
									return <em key={j}>{part.text}</em>;
								case "code":
									return (
										<code key={j} className="rounded-sm bg-muted px-1 font-mono text-[13px]">
											{part.text}
										</code>
									);
								case "mention":
									return (
										<span key={j} className={cn("rounded-sm px-1 font-medium", part.key === me ? "bg-primary/25 text-foreground" : "bg-primary/10 text-primary")}>
											{part.text}
										</span>
									);
								case "note":
									return (
										<button key={j} type="button" onClick={() => onOpenNote?.(part.text)} className="cursor-pointer rounded-sm bg-info/10 px-1 text-info hover:bg-info/20">
											{part.text}
										</button>
									);
								case "file":
									return <span key={j}>{renderFile ? renderFile(part.path) : part.path}</span>;
								case "ref":
									return (
										<button key={j} type="button" onClick={() => onOpenRef?.(part.entity, part.id)} className="cursor-pointer rounded-sm bg-success/10 px-1 text-success hover:bg-success/20">
											{refTitle?.(part.entity, part.id) ?? `a ${part.entity} this device does not have`}
										</button>
									);
								default:
									return <span key={j}>{part.text}</span>;
							}
						})}
					</p>
				),
			)}
		</div>
	);
}
