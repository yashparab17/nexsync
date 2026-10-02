// One avatar for a person everywhere in the app: the first letter of their name on a colour that comes from the name,
// the same colour their cursor has in a shared note

import { colorForName } from "@/lib/collabColor";
import { cn } from "@/lib/utils";

// Shown when someone has no name yet
export const NO_NAME = "Collaborator";

export const initialOf = (name: string) => ([...name.trim()][0] ?? [...NO_NAME][0]).toUpperCase();

export default function Avatar({ name, className }: { name: string; className?: string }) {
	return (
		<span
			aria-hidden
			data-slot="avatar"
			style={{ background: colorForName(name.trim() || NO_NAME) }}
			className={cn("flex size-8 shrink-0 items-center justify-center text-sm font-bold text-white", className)}
		>
			{initialOf(name)}
		</span>
	);
}
