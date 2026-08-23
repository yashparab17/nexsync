import { useThemeContext } from "@/store/ThemeContext";

// Hook to access current theme and toggle function
export function useTheme() {
	return useThemeContext();
}
