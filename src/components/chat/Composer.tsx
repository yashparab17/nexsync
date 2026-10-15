// The box at the bottom of a channel: type, @ to mention someone, Enter to send, Shift+Enter for a new line.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { X } from "lucide-react";

import { CornerUpLeft, Paperclip, SendHorizontal } from "@/components/animate-icons";
import Avatar from "@/components/elements/Avatar";
import { Button } from "@/components/ui/button";
import { completeMention, mentionMatches, mentionQuery, type Person } from "@/lib/chat/mentions";
import { cn } from "@/lib/utils";

interface ComposerProps {
	channelName: string;
	canPost: boolean;
	people: Person[];
	// The message being answered, shown above the box
	reply: { name: string; text: string } | null;
	onCancelReply: () => void;
	onSend: (text: string) => void;
	// What was typed and not sent, kept per channel by the page
	draft: string;
	onDraft: (text: string) => void;
	focusKey: string; // Changes when the box should take focus again (a new channel, a reply)
	cooldownUntil?: number; // Slow mode: when this person may send again
	symbol?: string; // "#" for a channel, "@" for a person
	// Files waiting to be sent with the message; absent where attaching is not offered
	pending?: File[];
	onAttach?: (files: File[]) => void;
	onRemoveAttachment?: (index: number) => void;
}

export const MAX_MESSAGE = 4000;

export default function Composer({ channelName, canPost, people, reply, onCancelReply, onSend, draft, onDraft, focusKey, cooldownUntil = 0, symbol = "#", pending = [], onAttach, onRemoveAttachment }: ComposerProps) {
	const picker = useRef<HTMLInputElement>(null);
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		if (cooldownUntil <= Date.now()) return;
		const t = setInterval(() => setNow(Date.now()), 500);
		return () => clearInterval(t);
	}, [cooldownUntil]);
	const waiting = Math.max(0, Math.ceil((cooldownUntil - now) / 1000));
	const box = useRef<HTMLTextAreaElement>(null);
	const [caret, setCaret] = useState(0);
	const [pick, setPick] = useState(0);
	const query = canPost ? mentionQuery(draft, caret) : null;
	const matches = query ? mentionMatches(query.query, people) : [];

	useEffect(() => {
		if (canPost) box.current?.focus();
	}, [focusKey, canPost]);

	// The box grows with what is typed, up to a limit. It is measured again when its width changes: at first it may have none yet.
	useLayoutEffect(() => {
		const el = box.current;
		if (!el) return;
		const fit = () => {
			el.style.height = "auto";
			el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
		};
		fit();
		let width = el.clientWidth;
		const watcher = new ResizeObserver(() => {
			if (el.clientWidth === width) return;
			width = el.clientWidth;
			fit();
		});
		watcher.observe(el);
		return () => watcher.disconnect();
	}, [draft]);

	const send = () => {
		const text = draft.trim();
		if ((!text && pending.length === 0) || !canPost || waiting > 0) return;
		onSend(text);
	};

	const choose = (person: Person) => {
		if (!query) return;
		const next = completeMention(draft, query.start, caret, person.name);
		onDraft(next.text);
		setPick(0);
		requestAnimationFrame(() => {
			box.current?.setSelectionRange(next.caret, next.caret);
			setCaret(next.caret);
		});
	};

	if (!canPost) {
		return (
			<div className="mx-4 mb-4 rounded-md bg-input px-4 py-3 text-sm text-muted-foreground">
				You can read {symbol}
				{channelName}. Only Commenters and above can write here.
			</div>
		);
	}

	return (
		<div className="relative mx-4 mb-4">
			{matches.length > 0 && (
				<ul role="listbox" aria-label="People to mention" className="absolute bottom-full left-0 z-20 mb-1 w-64 overflow-hidden rounded-lg bg-popover p-1 ring-1 ring-foreground/10">
					{matches.map((p, i) => (
						<li key={p.deviceId} role="option" aria-selected={i === pick}>
							<button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => choose(p)} className={cn("flex h-8 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left text-sm outline-none", i === pick ? "bg-muted" : "hover:bg-muted/60")}>
								<Avatar name={p.name} className="size-6 text-xs" />
								<span className="truncate">{p.name}</span>
							</button>
						</li>
					))}
				</ul>
			)}
			<div className="field-focus rounded-md bg-input">
				{reply && (
					<div className="flex items-center gap-2 border-b px-4 py-2 text-[13px] text-muted-foreground">
						<CornerUpLeft className="size-3.5 shrink-0" />
						<span className="min-w-0 flex-1 truncate">
							Replying to <span className="font-semibold text-foreground">{reply.name}</span>: {reply.text}
						</span>
						<Button variant="ghost" size="icon-xs" aria-label="Cancel reply" onPress={onCancelReply}>
							<X className="size-4" />
						</Button>
					</div>
				)}
				{pending.length > 0 && (
					<ul aria-label="Files to send" className="flex flex-wrap gap-2 border-b px-4 py-2">
						{pending.map((f, i) => (
							<li key={`${f.name}${i}`} className="flex h-7 items-center gap-1 rounded-md bg-muted pr-1 pl-2 text-[13px]">
								<Paperclip className="size-3.5" />
								{f.name}
								<Button variant="ghost" size="icon-xs" aria-label={`Remove ${f.name}`} onPress={() => onRemoveAttachment?.(i)}>
									<X className="size-3.5" />
								</Button>
							</li>
						))}
					</ul>
				)}
				<div className="flex items-end gap-2 px-2 py-2">
					{onAttach && (
						<>
							<input
								ref={picker}
								type="file"
								multiple
								hidden
								aria-label="Choose files to attach"
								onChange={(e) => {
									onAttach(Array.from(e.target.files ?? []));
									e.target.value = "";
								}}
							/>
							<Button variant="ghost" size="icon-sm" aria-label="Attach files" onPress={() => picker.current?.click()}>
								<Paperclip className="size-4" />
							</Button>
						</>
					)}
					<textarea
						ref={box}
						rows={1}
						value={draft}
						maxLength={MAX_MESSAGE}
						aria-label={`Message ${symbol}${channelName}`}
						placeholder={`Message ${symbol}${channelName}`}
						onChange={(e) => {
							onDraft(e.target.value);
							setCaret(e.target.selectionStart);
							setPick(0);
						}}
						onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
						onKeyDown={(e) => {
							if (matches.length > 0) {
								if (e.key === "ArrowDown" || e.key === "ArrowUp") {
									e.preventDefault();
									setPick((p) => (p + (e.key === "ArrowDown" ? 1 : matches.length - 1)) % matches.length);
									return;
								}
								if (e.key === "Enter" || e.key === "Tab") {
									e.preventDefault();
									choose(matches[Math.min(pick, matches.length - 1)]);
									return;
								}
							}
							if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
								e.preventDefault();
								send();
							} else if (e.key === "Escape" && reply) {
								e.stopPropagation();
								onCancelReply();
							}
						}}
						className="max-h-[200px] min-h-8 flex-1 resize-none bg-transparent px-2 py-1 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:outline-none"
					/>
					<Button variant="ghost" size="icon-sm" aria-label="Send message" onPress={send} isDisabled={(!draft.trim() && pending.length === 0) || waiting > 0} className="text-primary">
						<SendHorizontal className="size-4" />
					</Button>
				</div>
			</div>
			<p className="mt-1 px-1 font-mono text-[13px] text-muted-foreground">{waiting > 0 ? `Slow mode: you can send again in ${waiting}s` : "Enter to send, Shift+Enter for a new line, @ to mention"}</p>
		</div>
	);
}
