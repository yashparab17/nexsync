import { Moon, Sun } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useTheme } from "@/hooks/useTheme";

// Toggle button to switch between dark and light mode
export default function ThemeToggle() {
	const { isDark, toggleTheme } = useTheme();

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
