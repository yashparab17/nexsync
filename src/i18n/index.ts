// Looking up app text by key, so a new language is a new catalog and not a change to every component.
//
// Scaffold: components still holding English text directly are moved over as they are touched. The language
// is picked once at startup (the browser's language if a catalog for it is registered), so changing it
// takes effect after a restart.

import en from "./en";

export type MessageKey = keyof typeof en;
export type Catalog = Partial<Record<MessageKey, string>>;

const catalogs: Record<string, Catalog> = { en };
let current = "en";

// Adds the text for a language, such as `registerLocale("fr", { "nav.notes": "Notes" })`; missing keys show English
export function registerLocale(code: string, messages: Catalog): void {
	catalogs[code.toLowerCase()] = messages;
}

// Switches to a registered language (`fr-CA` falls back to `fr`); returns the one now in use
export function setLocale(code: string): string {
	const wanted = code.toLowerCase();
	const found = [wanted, wanted.split("-")[0]].find((c) => c in catalogs);
	current = found ?? "en";
	if (typeof document !== "undefined") document.documentElement.lang = current;
	return current;
}

export const locale = () => current;

// The text for a key in the current language, with {name} placeholders filled from `vars`
export function t(key: MessageKey, vars?: Record<string, string | number>): string {
	const text: string = catalogs[current]?.[key] ?? en[key];
	return vars ? text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole)) : text;
}

// Dates and numbers in the current language's conventions
export const formatDate = (value: Date | number | string, options?: Intl.DateTimeFormatOptions) =>
	new Intl.DateTimeFormat(current, options).format(new Date(value));
export const formatNumber = (value: number, options?: Intl.NumberFormatOptions) => new Intl.NumberFormat(current, options).format(value);

// Start in the language of the system when there is a catalog for it
if (typeof navigator !== "undefined" && navigator.language) setLocale(navigator.language);
