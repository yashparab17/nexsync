// Runs the research scripts through Vite, which resolves the project's packages the way the app does
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: { include: ["research/**/*.test.ts"], environment: "node", testTimeout: 30 * 60 * 1000 },
});
