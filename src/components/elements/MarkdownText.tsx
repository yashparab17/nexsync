// Markdown from another person, shown without ever becoming HTML. The text is read into tokens and each is built as a React
// element, so nothing in it can add markup or script to the page. Links are shown as their words and their address in mono,
// not made clickable; pictures show their description; raw HTML shows as text.

import { Fragment, type ReactNode } from "react";
import { marked, type Token, type Tokens } from "marked";

import { cn } from "@/lib/utils";

function inline(tokens: Token[] | undefined, keyBase: string): ReactNode {
	return (tokens ?? []).map((t, i) => {
		const key = `${keyBase}.${i}`;
		switch (t.type) {
			case "strong":
				return <strong key={key}>{inline((t as Tokens.Strong).tokens, key)}</strong>;
			case "em":
				return <em key={key}>{inline((t as Tokens.Em).tokens, key)}</em>;
			case "del":
				return <del key={key}>{inline((t as Tokens.Del).tokens, key)}</del>;
			case "codespan":
				return (
					<code key={key} className="rounded-sm bg-muted px-1 font-mono text-[13px]">
						{(t as Tokens.Codespan).text}
					</code>
				);
			case "br":
				return <br key={key} />;
			case "link": {
				const link = t as Tokens.Link;
				return (
					<span key={key}>
						{inline(link.tokens, key)} <span className="font-mono text-[13px] text-muted-foreground">({link.href})</span>
					</span>
				);
			}
			case "image":
				return <span key={key}>{(t as Tokens.Image).text}</span>;
			case "text":
			case "escape": {
				const text = t as Tokens.Text;
				return <Fragment key={key}>{text.tokens ? inline(text.tokens, key) : text.text}</Fragment>;
			}
			default:
				return <Fragment key={key}>{(t as { raw?: string }).raw ?? ""}</Fragment>;
		}
	});
}

function blocks(tokens: Token[], keyBase: string): ReactNode {
	return tokens.map((t, i) => {
		const key = `${keyBase}.${i}`;
		switch (t.type) {
			case "space":
				return null;
			case "heading": {
				const h = t as Tokens.Heading;
				return (
					<p key={key} className={cn("font-semibold", h.depth <= 1 ? "text-xl" : "text-sm")}>
						{inline(h.tokens, key)}
					</p>
				);
			}
			case "paragraph":
				return <p key={key}>{inline((t as Tokens.Paragraph).tokens, key)}</p>;
			case "text":
				return <p key={key}>{inline((t as Tokens.Text).tokens ?? [t], key)}</p>;
			case "list": {
				const list = t as Tokens.List;
				const Tag = list.ordered ? "ol" : "ul";
				return (
					<Tag key={key} className={cn("space-y-1 pl-5", list.ordered ? "list-decimal" : "list-disc")}>
						{list.items.map((item, j) => (
							<li key={`${key}.${j}`}>{blocks(item.tokens, `${key}.${j}`)}</li>
						))}
					</Tag>
				);
			}
			case "code":
				return (
					<pre key={key} className="overflow-x-auto rounded-md bg-muted/60 p-3 font-mono text-[13px] whitespace-pre">
						{(t as Tokens.Code).text}
					</pre>
				);
			case "blockquote":
				return (
					<blockquote key={key} className="border-l-2 border-primary pl-3 text-muted-foreground">
						{blocks((t as Tokens.Blockquote).tokens, key)}
					</blockquote>
				);
			case "hr":
				return <hr key={key} className="border-border" />;
			default:
				return (
					<p key={key} className="whitespace-pre-wrap">
						{(t as { raw?: string }).raw ?? ""}
					</p>
				);
		}
	});
}

export default function MarkdownText({ text, className }: { text: string; className?: string }) {
	return <div className={cn("min-w-0 space-y-2 text-sm break-words", className)}>{blocks(marked.lexer(text), "m")}</div>;
}
