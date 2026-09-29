import {
	createContext,
	useContext,
	useEffect,
	useState,
	type ReactNode,
} from "react";

type Theme = "dark" | "light";
// What the person picked; "system" follows the operating system
export type ThemePreference = Theme | "system";

interface ThemeContextValue {
	theme: Theme;
	isDark: boolean;
	preference: ThemePreference;
	setPreference: (preference: ThemePreference) => void;
	toggleTheme: () => void;
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

	// Follow the operating system while the preference is "system"
	useEffect(() => {
		if (typeof window.matchMedia !== "function") return;
		const query = window.matchMedia(DARK_QUERY);
		const onChange = () => setSystem(query.matches ? "dark" : "light");
		query.addEventListener("change", onChange);
		return () => query.removeEventListener("change", onChange);
	}, []);

	const theme: Theme = preference === "system" ? system : preference;

	// Synchronize dark class on document element and save to localStorage
	useEffect(() => {
		document.documentElement.classList.toggle("dark", theme === "dark");
		localStorage.setItem("theme", preference);
	}, [theme, preference]);

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
