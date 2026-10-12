// A few lines of code in the colours of a scheme (or, with no colours given, the ones in use now), so a choice can be seen.

import { SYNTAX_TOKENS, type SyntaxVars } from "@/lib/codeSchemes";
import { cn } from "@/lib/utils";

const c = (k: string) => ({ color: `var(--syn-${k})` });

export default function CodeSample({ vars, className }: { vars?: SyntaxVars; className?: string }) {
	const style = vars ? (Object.fromEntries(SYNTAX_TOKENS.map((t) => [`--syn-${t.key}`, vars[t.key]])) as React.CSSProperties) : undefined;
	return (
		<pre style={style} aria-label="Sample code" className={cn("overflow-x-auto border bg-background p-3 font-mono text-[13px] leading-relaxed text-foreground", className)}>
			<span style={c("comment")}>{"// Adds up the open tasks"}</span>
			{"\n"}
			<span style={c("keyword")}>export function</span> <span style={c("function")}>countOpen</span>
			<span style={c("operator")}>(</span>
			<span style={c("variable")}>tasks</span>
			<span style={c("operator")}>:</span> <span style={c("type")}>Task</span>
			<span style={c("operator")}>[]) {"{"}</span>
			{"\n  "}
			<span style={c("keyword")}>const</span> <span style={c("variable")}>label</span> <span style={c("operator")}>=</span> <span style={c("string")}>{'"open"'}</span>
			<span style={c("operator")}>;</span>
			{"\n  "}
			<span style={c("keyword")}>return</span> <span style={c("variable")}>tasks</span>
			<span style={c("operator")}>.</span>
			<span style={c("function")}>filter</span>
			<span style={c("operator")}>((</span>
			<span style={c("variable")}>t</span>
			<span style={c("operator")}>{") =>"}</span> <span style={c("operator")}>!</span>
			<span style={c("variable")}>t</span>
			<span style={c("operator")}>.</span>
			<span style={c("variable")}>done</span> <span style={c("operator")}>&amp;&amp;</span> <span style={c("variable")}>t</span>
			<span style={c("operator")}>.</span>
			<span style={c("variable")}>days</span> <span style={c("operator")}>&gt;</span> <span style={c("number")}>0</span>
			<span style={c("operator")}>).</span>
			<span style={c("variable")}>length</span>
			<span style={c("operator")}>;</span>
			{"\n"}
			<span style={c("operator")}>{"}"}</span> <span style={c("comment")}>{"// "}</span>
			<span style={c("constant")}>true</span>
			<span style={c("comment")}>{" if any"}</span>
			{"\n"}
			<span style={c("tag")}>{"<Badge>"}</span>
			<span style={c("variable")}>label</span>
			<span style={c("tag")}>{"</Badge>"}</span>
		</pre>
	);
}
