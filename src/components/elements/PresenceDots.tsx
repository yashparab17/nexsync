// Small initials for the people who are somewhere, in a colour that stays the same for each person

const COLORS = ["bg-emerald-500", "bg-sky-500", "bg-violet-500", "bg-amber-500", "bg-rose-500", "bg-teal-500"];

export const colorOf = (name: string) => COLORS[[...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % COLORS.length];

// `doing` finishes the hover text: "Raven is here", "Raven is editing"
export default function PresenceDots({ names, doing = "here" }: { names: string[]; doing?: string }) {
	if (names.length === 0) return null;
	const shown = names.slice(0, 3);
	return (
		<span className="inline-flex shrink-0 items-center -space-x-1" title={`${names.join(", ")} ${names.length === 1 ? "is" : "are"} ${doing}`}>
			{shown.map((n) => (
				<span key={n} className={`flex size-4 items-center justify-center text-[9px] font-bold text-white ring-1 ring-background ${colorOf(n)}`}>
					{n.slice(0, 1).toUpperCase()}
				</span>
			))}
			{names.length > shown.length && <span className="pl-1.5 text-[9px] text-muted-foreground">+{names.length - shown.length}</span>}
		</span>
	);
}
