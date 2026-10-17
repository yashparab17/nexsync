import { useEffect, useState } from "react";
import type { Awareness } from "y-protocols/awareness";

export interface Person {
	name: string;
	color: string;
}

// Who else has this document open: the names and colours they set on the shared document's awareness
export function usePeople(awareness: Awareness | null | undefined, field = "user"): Person[] {
	const [people, setPeople] = useState<Person[]>([]);
	useEffect(() => {
		if (!awareness) return;
		const read = () => {
			const out: Person[] = [];
			awareness.getStates().forEach((st, client) => {
				const u = (st[field] ?? st.user) as { name?: string; color?: string } | undefined;
				if (client !== awareness.clientID && u?.name && !out.some((o) => o.name === u.name)) out.push({ name: u.name, color: u.color ?? "#888" });
			});
			setPeople(out);
		};
		awareness.on("change", read);
		read();
		return () => awareness.off("change", read);
	}, [awareness, field]);
	return people;
}

// Round initials, overlapping, for the title bar
export function PeopleStack({ people, max = 4 }: { people: Person[]; max?: number }) {
	if (people.length === 0) return null;
	return (
		<span className="flex items-center -space-x-1.5" role="group" aria-label={`Also here: ${people.map((p) => p.name).join(", ")}`}>
			{people.slice(0, max).map((p) => (
				<span key={p.name} title={p.name} className="flex size-6 items-center justify-center rounded-full text-[11px] font-semibold text-white ring-2 ring-white/80" style={{ background: p.color }}>
					{p.name.trim().charAt(0).toUpperCase()}
				</span>
			))}
			{people.length > max && <span className="flex size-6 items-center justify-center rounded-full bg-white/30 text-[11px] font-semibold text-white ring-2 ring-white/80">+{people.length - max}</span>}
		</span>
	);
}
