// One avatar for a person everywhere in the app: the first letter of their name on a colour that comes from the name,
// the same colour their cursor has in a shared note

import { colorOf } from "@/lib/collabColor";
import { useProfile, type Profile } from "@/lib/profile";
import { cn } from "@/lib/utils";

// Shown when someone has no name yet
export const NO_NAME = "Collaborator";

export const initialOf = (name: string) => ([...name.trim()][0] ?? [...NO_NAME][0]).toUpperCase();

// `profile` is passed where the person's own choice is known before it has reached the workspace (their Settings)
export default function Avatar({ name, className, profile }: { name: string; className?: string; profile?: Profile }) {
	const chosen = useProfile(name);
	const image = (profile ?? chosen)?.image;
	if (image) return <img aria-hidden data-slot="avatar" src={image} alt="" className={cn("size-8 shrink-0 rounded-md object-cover", className)} />;
	return (
		<span
			aria-hidden
			data-slot="avatar"
			style={{ background: profile?.color ?? colorOf(name.trim() || NO_NAME) }}
			className={cn("flex size-8 shrink-0 items-center justify-center rounded-md text-sm font-bold text-white", className)}
		>
			{initialOf(name)}
		</span>
	);
}
