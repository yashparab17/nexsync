// A small marker on a task or card that breaks a rule the workspace turned on

import { ShieldAlert } from "lucide-react";

import type { Violation } from "@/types/workspace";

export default function RuleFlag({ violations }: { violations?: Violation[] }) {
	if (!violations || violations.length === 0) return null;
	const text = violations.map((v) => v.message).join(" ");
	return (
		<span className="inline-flex items-center gap-1 text-amber-500" title={text}>
			<ShieldAlert className="size-3" aria-hidden />
			Needs attention
			<span className="sr-only">: {text}</span>
		</span>
	);
}
