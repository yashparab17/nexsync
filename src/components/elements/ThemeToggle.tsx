import { Moon, Sun } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useThemeContext } from "@/store/ThemeContext";

// Toggle button to switch between dark and light mode
export default function ThemeToggle() {
	const { isDark, toggleTheme } = useThemeContext();

	return (
		<Button
			variant="ghost"
			size="icon"
			onPress={toggleTheme}
			aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
		>
			{isDark ?
				<Sun className="size-5" />
			:	<Moon className="size-5" />}
		</Button>
	);
}
