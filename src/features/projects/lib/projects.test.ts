import { describe, expect, it } from "vitest";

import { ignoreRule, insideProject, problemPath, recipeFromDetected, tasksOf } from "@/features/projects/lib/projects";
import type { ProjectInfo } from "@/features/projects/types";

const task = (id: string, watch = false, ports: number[] = []) => ({ id, label: id, command: id, cwd: "", env: [], ports, dependsOn: [], watch, interactive: false, readyWhen: "" });
const project = (over: Partial<ProjectInfo> = {}): ProjectInfo => ({
	id: "app", path: "projects/app", name: "app", scratch: false, recipe: null, recipeError: null,
	detected: { kinds: [{ id: "vite", label: "Vite", group: "Web" }], packageManager: "pnpm", tasks: [task("install"), task("dev", true, [5173])], tools: [{ name: "node", range: ">=20" }], env: [] },
	...over,
});

describe("projects", () => {
	it("starts a recipe from what was found, with the preview at the dev server's port", () => {
		const r = recipeFromDetected(project());
		expect(r.kinds).toEqual(["vite"]);
		expect(r.preview).toEqual({ port: 5173, path: "" });
		expect(recipeFromDetected(project({ detected: { ...project().detected, tasks: [task("build")] } })).preview).toBeNull();
	});
	it("prefers the team's recipe to what was found", () => {
		expect(tasksOf(project()).map((t) => t.id)).toEqual(["install", "dev"]);
		expect(tasksOf(project({ recipe: { ...recipeFromDetected(project()), tasks: [task("only")] } })).map((t) => t.id)).toEqual(["only"]);
	});
	it("writes a rule anchored at the project, and tells which paths belong to it", () => {
		expect(ignoreRule(project(), "projects/app/generated", true)).toBe("/generated/");
		expect(ignoreRule(project(), "projects/app/src/big.bin", false)).toBe("/src/big.bin");
		expect(insideProject(project(), "projects/app/x")).toBe(true);
		expect(insideProject(project(), "projects/other/x")).toBe(false);
		expect(insideProject(project({ scratch: true, path: "projects" }), "projects/loose.py")).toBe(true);
		expect(insideProject(project({ scratch: true, path: "projects" }), "projects/app/x.ts")).toBe(false);
	});
	it("finds the file named in output relative to where the task ran, or in full", () => {
		const p = project();
		expect(problemPath("C:\\w\\ws", p, "", "src/app.ts")).toBe("projects/app/src/app.ts");
		expect(problemPath("C:\\w\\ws", p, "web", "./src/app.ts")).toBe("projects/app/web/src/app.ts");
		expect(problemPath("C:\\w\\ws", p, "web", "../api/main.go")).toBe("projects/app/api/main.go");
		expect(problemPath("C:\\w\\ws", p, "", "C:/w/ws/projects/app/src/a.ts")).toBe("projects/app/src/a.ts");
		expect(problemPath("C:\\w\\ws", p, "", "C:\\Users\\me\\.cargo\\x.rs")).toBeNull();
	});
});
