const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

// "fri", "tomorrow", "next week", "in 3 days" or "2026-12-01" as "YYYY-MM-DD" in local time, or null when it is not a date
export function parseNaturalDate(text: string, from: Date = new Date()): string | null {
	const t = text.trim().toLowerCase();
	if (!t) return null;
	const day = new Date(from.getFullYear(), from.getMonth(), from.getDate());
	if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return Number.isNaN(Date.parse(t)) ? null : t;
	if (t === "today" || t === "tod") return iso(day);
	if (t === "tomorrow" || t === "tom" || t === "tmrw") return iso(addDays(day, 1));
	if (t === "next week") return iso(addDays(day, 7));
	if (t === "next month") return iso(new Date(day.getFullYear(), day.getMonth() + 1, day.getDate()));
	const inN = /^in (\d{1,3}) (day|days|week|weeks)$/.exec(t);
	if (inN) return iso(addDays(day, Number(inN[1]) * (inN[2].startsWith("week") ? 7 : 1)));
	const wd = /^(next )?((sun|mon|tue|wed|thu|fri|sat)(day|s|sday|nesday|rsday|urday|r|rs)?)$/.exec(t);
	if (wd) {
		const target = DAYS.indexOf(wd[3]);
		if (target >= 0) {
			// The coming one; "today" is never the answer for a weekday name, and "next" skips a further week
			let ahead = (target - day.getDay() + 7) % 7 || 7;
			if (wd[1]) ahead += 7;
			return iso(addDays(day, ahead));
		}
	}
	return null;
}
