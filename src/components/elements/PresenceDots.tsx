import Avatar from "@/components/elements/Avatar";

// Small initials for the people who are somewhere, in the colour that goes with their name everywhere else

// `doing` finishes the hover text: "Raven is here", "Raven is editing"
export default function PresenceDots({ names, doing = "here" }: { names: string[]; doing?: string }) {
	if (names.length === 0) return null;
	const shown = names.slice(0, 3);
	return (
		<span className="inline-flex shrink-0 items-center -space-x-1" title={`${names.join(", ")} ${names.length === 1 ? "is" : "are"} ${doing}`}>
			{shown.map((n) => (
				<Avatar key={n} name={n} className="size-4 text-xs ring-1 ring-background" />
			))}
			{names.length > shown.length && <span className="pl-1.5 text-xs text-muted-foreground">+{names.length - shown.length}</span>}
		</span>
	);
}
