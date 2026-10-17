// A short single line of a message, for "replying to…" lines and lists: mentions as @Name, formatting marks and line breaks gone.

import { decodeMentions, type Person } from "@/features/chat/lib/mentions";

export function plainPreview(text: string, people: Person[], max = 90): string {
	const flat = decodeMentions(text, people)
		.replace(/\[\[(task|card):[\w-]+\]\]/g, (_m, kind: string) => `a ${kind}`)
		.replace(/\[\[file:[^\]]*\]\]/g, "an attachment")
		.replace(/```[\w]*\n?/g, "")
		.replace(/[*`]/g, "")
		.replace(/\s+/g, " ")
		.trim();
	return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}
