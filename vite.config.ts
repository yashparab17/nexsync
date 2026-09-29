/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import path from "node:path";

const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
	plugins: [react(), tailwindcss(), tsconfigPaths()],

	resolve: {
		alias: {
			"@": path.resolve(__dirname, "./src"),
		},
	},

	// Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
	//
	// 1. prevent Vite from obscuring rust errors
	clearScreen: false,

	// The Editor loads languages and formatters on demand. Left to Vite it finds them only when the tab
	// first opens and re-bundles mid-session, which can leave the page with two copies of React.
	optimizeDeps: {
		include: [
			"@codemirror/language-data",
			"@codemirror/search",
			"@codemirror/lint",
			"@uiw/codemirror-theme-vscode",
			"@blocknote/code-block",
			"prettier/standalone",
			"prettier/plugins/babel",
			"prettier/plugins/estree",
			"prettier/plugins/typescript",
			"prettier/plugins/postcss",
			"prettier/plugins/html",
			"prettier/plugins/markdown",
			"prettier/plugins/yaml",
		],
	},

	test: {
		environment: "jsdom",
		include: ["src/**/*.test.{ts,tsx}"],
	},
	// 2. tauri expects a fixed port, fail if that port is not available
	server: {
		port: 1420,
		strictPort: true,
		host: host || false,
		hmr:
			host ?
				{
					protocol: "ws",
					host,
					port: 1421,
				}
			:	undefined,
		watch: {
			// 3. tell Vite to ignore watching `src-tauri`
			ignored: ["**/src-tauri/**"],
		},
	},
}));
