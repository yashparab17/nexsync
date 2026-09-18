import {
	createContext,
	useContext,
	useEffect,
	useState,
	type ReactNode,
} from "react";

type Theme = "dark" | "light";

interface ThemeContextValue {
	theme: Theme;
	isDark: boolean;
	toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

interface ThemeProviderProps {
	children: ReactNode;
}

// Provider that manages light/dark mode and syncs class on root HTML element
export function ThemeProvider({ children }: ThemeProviderProps) {
	// Initialize theme from localStorage fallback to dark
	const [theme, setTheme] = useState<Theme>(() => {
		const savedTheme = localStorage.getItem("theme");
		return savedTheme === "light" ? "light" : "dark";
	});

	// Synchronize dark class on document element and save to localStorage
	useEffect(() => {
		const root = document.documentElement;
		root.classList.toggle("dark", theme === "dark");
		localStorage.setItem("theme", theme);
	}, [theme]);

	// Toggle between light and dark themes
	const toggleTheme = () => {
		setTheme((current) => (current === "dark" ? "light" : "dark"));
	};

	return (
		<ThemeContext.Provider
			value={{
				theme,
				isDark: theme === "dark",
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
