import {
	createContext,
	useContext,
	useEffect,
	useState,
	type ReactNode,
} from "react";

type Theme = "dark" | "light";

// The four themes: each mode has the original look and one Catppuccin flavour. The swatch shows its page, panel and accent
// colours in the picker.
export type LightThemeId = "default" | "latte";
export type DarkThemeId = "default" | "mocha";
export const THEMES = {
	light: [
		{ id: "default", name: "Original light", swatch: ["#ffffff", "#f4f4f5", "#0f766e"] },
		{ id: "latte", name: "Catppuccin Latte", swatch: ["#dce0e8", "#eff1f5", "#0e6269"] },
	],
	dark: [
		{ id: "default", name: "Original dark", swatch: ["#09090b", "#18181b", "#2dd4bf"] },
		{ id: "mocha", name: "Catppuccin Mocha", swatch: ["#11111b", "#1e1e2e", "#94e2d5"] },
	],
} as const;
const read = <T extends string>(key: string, allowed: readonly T[], fallback: T): T => {
	try {
		const saved = localStorage.getItem(key);
		return allowed.find((a) => a === saved) ?? fallback;
	} catch {
		return fallback;
	}
};
// What the person picked; "system" follows the operating system
export type ThemePreference = Theme | "system";

interface ThemeContextValue {
	theme: Theme;
	isDark: boolean;
	preference: ThemePreference;
	setPreference: (preference: ThemePreference) => void;
	toggleTheme: () => void;
	// Which theme each mode uses
	lightTheme: LightThemeId;
	darkTheme: DarkThemeId;
	setLightTheme: (id: LightThemeId) => void;
	setDarkTheme: (id: DarkThemeId) => void;
	// The theme on screen now, such as "default" or "mocha"
	themeId: string;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

interface ThemeProviderProps {
	children: ReactNode;
}

const DARK_QUERY = "(prefers-color-scheme: dark)";

const systemTheme = (): Theme =>
	typeof window.matchMedia === "function" && !window.matchMedia(DARK_QUERY).matches ? "light" : "dark";

// Provider that manages light/dark mode and syncs class on root HTML element
export function ThemeProvider({ children }: ThemeProviderProps) {
	// Initialize the preference from localStorage, falling back to dark
	const [preference, setPreference] = useState<ThemePreference>(() => {
		const saved = localStorage.getItem("theme");
		return saved === "light" || saved === "system" ? saved : "dark";
	});
	const [system, setSystem] = useState<Theme>(systemTheme);
	const [lightTheme, setLightTheme] = useState<LightThemeId>(() => read("theme.light", ["default", "latte"], "default"));
	const [darkTheme, setDarkTheme] = useState<DarkThemeId>(() => read("theme.dark", ["default", "mocha"], "default"));

	// Follow the operating system while the preference is "system"
	useEffect(() => {
		if (typeof window.matchMedia !== "function") return;
		const query = window.matchMedia(DARK_QUERY);
		const onChange = () => setSystem(query.matches ? "dark" : "light");
		query.addEventListener("change", onChange);
		return () => query.removeEventListener("change", onChange);
	}, []);

	const theme: Theme = preference === "system" ? system : preference;

	const themeId = theme === "dark" ? darkTheme : lightTheme;

	// Synchronize the dark class and the theme name on the document element, and save the choices
	useEffect(() => {
		const root = document.documentElement;
		root.classList.toggle("dark", theme === "dark");
		if (themeId === "default") root.removeAttribute("data-theme");
		else root.setAttribute("data-theme", themeId);
		try {
			localStorage.setItem("theme", preference);
			localStorage.setItem("theme.light", lightTheme);
			localStorage.setItem("theme.dark", darkTheme);
		} catch {
			// Not remembered this time
		}
	}, [theme, themeId, preference, lightTheme, darkTheme]);

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
