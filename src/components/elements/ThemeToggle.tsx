import { Moon, Sun } from "@/components/animate-icons";

import { IconButton } from "@/components/ui/icon-button";
import { useThemeContext } from "@/store/ThemeContext";

// Toggle button to switch between dark and light mode
export default function ThemeToggle() {
	const { isDark, toggleTheme } = useThemeContext();

	return (
		<IconButton size="md" onPress={toggleTheme} label={isDark ? "Switch to light mode" : "Switch to dark mode"}>
			{isDark ?
				<Sun className="size-5" />
			:	<Moon className="size-5" />}
		</IconButton>
	);
}
