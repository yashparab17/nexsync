// Security hardening policies: disables right-click, developer tools shortcuts, and OS webview history tracking

export function initSecurityPolicies(): void {
	// 1. Disable right-click context menu across the application
	document.addEventListener(
		"contextmenu",
		(event) => {
			event.preventDefault();
		},
		{ capture: true },
	);

	// 2. Disable browser developer tools and debug keyboard shortcuts
	document.addEventListener(
		"keydown",
		(event) => {
			// Disable F12
			if (event.key === "F12" || event.keyCode === 123) {
				event.preventDefault();
				return;
			}

			// Disable Ctrl+Shift+I / Cmd+Opt+I (DevTools Inspect)
			// Disable Ctrl+Shift+J / Cmd+Opt+J (DevTools Console)
			// Disable Ctrl+Shift+C / Cmd+Opt+C (Inspect Element)
			// Disable Ctrl+Shift+K / Cmd+Opt+K (Firefox console)
			if ((event.ctrlKey || event.metaKey) && event.shiftKey) {
				const key = event.key.toLowerCase();
				if (key === "i" || key === "j" || key === "c" || key === "k") {
					event.preventDefault();
					return;
				}
			}

			// Disable Ctrl+U / Cmd+U (View page source)
			if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "u") {
				event.preventDefault();
				return;
			}

			// Disable Ctrl+P / Cmd+P (Print page)
			if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "p") {
				event.preventDefault();
				return;
			}

			// Disable F5 / Ctrl+R / Cmd+R (Page refresh to prevent dropped mesh states)
			if (
				event.key === "F5" ||
				((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "r")
			) {
				event.preventDefault();
				return;
			}

			// Disable Alt+Left / Alt+Right navigation history traversal
			if (
				event.altKey &&
				(event.key === "ArrowLeft" || event.key === "ArrowRight")
			) {
				event.preventDefault();
				return;
			}
		},
		{ capture: true },
	);

	// 3. Disable default file drop navigation across the window
	window.addEventListener(
		"dragover",
		(event) => {
			event.preventDefault();
		},
		false,
	);

	window.addEventListener(
		"drop",
		(event) => {
			const target = event.target as HTMLElement | null;
			if (!target?.closest("[data-dropzone='true']")) {
				event.preventDefault();
			}
		},
		false,
	);
}
