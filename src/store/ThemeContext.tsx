import {
	createContext,
	useContext,
	useEffect,
	useLayoutEffect,
	useMemo,
	useState,
	type ReactNode,
} from "react";

import { BUILTIN_THEMES, DEFAULT_THEME, cleanCustomThemes, themeCss, type ThemeDef, type ThemeMode } from "@/lib/themes";

type Theme = ThemeMode;
// What the person picked; "system" follows the operating system
export type ThemePreference = Theme | "system";

interface ThemeContextValue {
	theme: Theme;
	isDark: boolean;
	preference: ThemePreference;
	setPreference: (preference: ThemePreference) => void;
	toggleTheme: () => void;
	// Which theme each mode uses, by id: "default", "latte", "custom-ab12cd" ...
	lightTheme: string;
	darkTheme: string;
	setLightTheme: (id: string) => void;
	setDarkTheme: (id: string) => void;
	// The theme on screen now
	themeId: string;
	// Every theme of a mode, the built-in ones first and then the ones people made
	themesFor: (mode: ThemeMode) => ThemeDef[];
	customThemes: ThemeDef[];
	// Adds a custom theme, or replaces the one with the same id
	saveCustomTheme: (theme: ThemeDef) => void;
	deleteCustomTheme: (id: string) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

interface ThemeProviderProps {
	children: ReactNode;
}

const DARK_QUERY = "(prefers-color-scheme: dark)";
const CUSTOM_KEY = "theme.custom";
const STYLE_ID = "nexsync-themes";

const systemTheme = (): Theme =>
	typeof window.matchMedia === "function" && !window.matchMedia(DARK_QUERY).matches ? "light" : "dark";

const readString = (key: string): string | null => {
	try {
		return localStorage.getItem(key);
	} catch {
		return null;
	}
};

const readCustom = (): ThemeDef[] => {
	try {
		return cleanCustomThemes(JSON.parse(readString(CUSTOM_KEY) ?? "[]"));
	} catch {
		return [];
	}
};

// Provider that manages light/dark mode and the theme of each, and syncs them to the root HTML element
export function ThemeProvider({ children }: ThemeProviderProps) {
	// Initialize the preference from localStorage, falling back to dark
	const [preference, setPreference] = useState<ThemePreference>(() => {
		const saved = readString("theme");
		return saved === "light" || saved === "system" ? saved : "dark";
	});
	const [system, setSystem] = useState<Theme>(systemTheme);
	const [customThemes, setCustomThemes] = useState<ThemeDef[]>(readCustom);
	const [lightId, setLightTheme] = useState(() => readString("theme.light") ?? DEFAULT_THEME);
	const [darkId, setDarkTheme] = useState(() => readString("theme.dark") ?? DEFAULT_THEME);

	// Follow the operating system while the preference is "system"
	useEffect(() => {
		if (typeof window.matchMedia !== "function") return;
		const query = window.matchMedia(DARK_QUERY);
		const onChange = () => setSystem(query.matches ? "dark" : "light");
		query.addEventListener("change", onChange);
		return () => query.removeEventListener("change", onChange);
	}, []);

	const theme: Theme = preference === "system" ? system : preference;

	const all = useMemo(() => [...BUILTIN_THEMES, ...customThemes], [customThemes]);
	const themesFor = (mode: ThemeMode) => all.filter((t) => t.mode === mode);
	// A choice that no longer exists (a deleted custom theme) falls back to the original
	const valid = (id: string, mode: ThemeMode) => (all.some((t) => t.id === id && t.mode === mode) ? id : DEFAULT_THEME);
	const lightTheme = valid(lightId, "light");
	const darkTheme = valid(darkId, "dark");
	const themeId = theme === "dark" ? darkTheme : lightTheme;

	// Every theme except the originals is a style rule; the page switches between them with data-theme. This runs before the
	// first paint, so a chosen theme never flashes the original.
	useLayoutEffect(() => {
		let style = document.getElementById(STYLE_ID);
		if (!style) {
			style = document.createElement("style");
			style.id = STYLE_ID;
			document.head.appendChild(style);
		}
		style.textContent = all.filter((t) => t.id !== DEFAULT_THEME).map(themeCss).join("\n");
	}, [all]);

	useLayoutEffect(() => {
		const root = document.documentElement;
		root.classList.toggle("dark", theme === "dark");
		if (themeId === DEFAULT_THEME) root.removeAttribute("data-theme");
		else root.setAttribute("data-theme", themeId);
	}, [theme, themeId]);

	// Remember the choices
	useEffect(() => {
		try {
			localStorage.setItem("theme", preference);
			localStorage.setItem("theme.light", lightTheme);
			localStorage.setItem("theme.dark", darkTheme);
			localStorage.setItem(CUSTOM_KEY, JSON.stringify(customThemes));
		} catch {
			// Not remembered this time
		}
	}, [preference, lightTheme, darkTheme, customThemes]);

	const saveCustomTheme = (next: ThemeDef) => setCustomThemes((prev) => (prev.some((t) => t.id === next.id) ? prev.map((t) => (t.id === next.id ? next : t)) : [...prev, next]));
	const deleteCustomTheme = (id: string) => setCustomThemes((prev) => prev.filter((t) => t.id !== id));

	// Switch to the opposite of what is showing now
	const toggleTheme = () => setPreference(theme === "dark" ? "light" : "dark");

	return (
		<ThemeContext.Provider
			value={{
				theme,
				isDark: theme === "dark",
				preference,
				setPreference,
				toggleTheme,
				lightTheme,
				darkTheme,
				setLightTheme,
				setDarkTheme,
				themeId,
				themesFor,
				customThemes,
				saveCustomTheme,
				deleteCustomTheme,
			}}
		>
			{children}
		</ThemeContext.Provider>
	);
}

// Hook to access the theme context
export function useThemeContext() {
	const context = useContext(ThemeContext);

	if (!context) {
		throw new Error("useThemeContext must be used inside a ThemeProvider");
	}

	return context;
}
