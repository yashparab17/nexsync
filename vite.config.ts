/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { readFileSync } from "node:fs";
import path from "node:path";

const host = process.env.TAURI_DEV_HOST;

// The version in package.json is the one the app shows; the desktop shell and the Rust crate are checked against it in a test
const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

// https://vite.dev/config/
export default defineConfig(async () => ({
	plugins: [react(), tailwindcss(), tsconfigPaths()],
	define: { __APP_VERSION__: JSON.stringify(version) },

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

	// Split the big libraries out of the app code so each is cached on its own and the first screen loads only what it uses. The editors
	// (CodeMirror, BlockNote) and the terminal are loaded when their pages open.
	build: {
		rollupOptions: {
			output: {
				manualChunks(id: string) {
					if (!id.includes("node_modules")) return undefined;
					const pkg = (re: RegExp) => re.test(id);
					if (pkg(/node_modules\/(react|react-dom|react-router|react-router-dom|scheduler)\//)) return "react";
					if (pkg(/node_modules\/(react-aria|react-aria-components|react-stately|@react-aria|@react-stately|@react-types|@internationalized)\//)) return "aria";
					if (pkg(/node_modules\/(motion|motion-dom|motion-utils|framer-motion)\//)) return "motion";
					if (pkg(/node_modules\/(yjs|lib0|y-protocols|y-codemirror\.next)\//)) return "yjs";
					if (pkg(/node_modules\/@tauri-apps\//)) return "tauri";
					// The rich-text notes editor, in four pieces so none is huge
					if (pkg(/node_modules\/(prosemirror-[a-z-]+|@tiptap|orderedmap|rope-sequence|w3c-keyname|y-prosemirror)\//)) return "prosemirror";
					if (pkg(/node_modules\/@mantine\//)) return "mantine";
					if (pkg(/node_modules\/(@floating-ui|@emoji-mart|tabbable|react-remove-scroll|react-remove-scroll-bar|react-style-singleton|use-callback-ref|use-sidecar|aria-hidden|get-nonce)\//)) return "popovers";
					if (pkg(/node_modules\/@blocknote\//)) return "blocknote";
					return undefined;
				},
			},
		},
	},

	test: {
		environment: "jsdom",
		include: ["src/**/*.test.{ts,tsx}"],
		setupFiles: ["src/test-setup.ts"],
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
