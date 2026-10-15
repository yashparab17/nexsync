// Small rules for the Projects page: what a project's recipe holds before anyone has written one, and what to add to
// .nexignore for a folder the scan found.

import type { ProjectInfo, Recipe, TaskSpec } from "@/types/projects";

// The recipe a project would start with: what Nexsync found in the folder
export function recipeFromDetected(p: ProjectInfo): Recipe {
	return { schema: 1, name: p.name, kinds: p.detected.kinds.map((k) => k.id), tasks: p.detected.tasks, tools: p.detected.tools, env: p.detected.env, preview: portOf(p.detected.tasks) };
}

// The first port a long-running task says it listens on, as the place to look at the running app
function portOf(tasks: TaskSpec[]): Recipe["preview"] {
	const port = tasks.find((t) => t.watch && t.ports.length > 0)?.ports[0];
	return port ? { port, path: "" } : null;
}

// What the team shares when there is a recipe, and what Nexsync found when there is not
export const tasksOf = (p: ProjectInfo): TaskSpec[] => p.recipe?.tasks ?? p.detected.tasks;
export const toolsOf = (p: ProjectInfo) => p.recipe?.tools ?? p.detected.tools;
export const envOf = (p: ProjectInfo) => p.recipe?.env ?? p.detected.env;

// A path of the workspace as a .nexignore rule for its project: anchored at the project folder, and for a folder, ending in a slash
export function ignoreRule(project: ProjectInfo, path: string, folder: boolean): string {
	const inside = path.startsWith(`${project.path}/`) ? path.slice(project.path.length + 1) : path;
	return `/${inside}${folder ? "/" : ""}`;
}

// Scratch is the loose files directly in projects/, not what is inside the project folders
export const insideProject = (project: ProjectInfo, path: string) => (project.scratch ? /^projects\/[^/]+$/.test(path) : path.startsWith(`${project.path}/`));

// Where a file named in compiler output is, as a path of the workspace the editor can open. Output names files relative to the
// folder the task ran in, or in full; a full path outside the workspace cannot be opened and gives null.
export function problemPath(workspacePath: string, project: ProjectInfo, cwd: string, file: string): string | null {
	const norm = (p: string) => p.replace(/\\/g, "/");
	const root = norm(workspacePath).replace(/\/+$/, "");
	const f = norm(file).replace(/^\.\//, "");
	if (/^([A-Za-z]:)?\//.test(f)) {
		if (!f.toLowerCase().startsWith(`${root.toLowerCase()}/`)) return null;
		return f.slice(root.length + 1);
	}
	const base = [project.path, cwd.replace(/^\/+|\/+$/g, "")].filter(Boolean).join("/");
	const parts: string[] = [];
	for (const part of `${base}/${f}`.split("/")) {
		if (part === "..") parts.pop();
		else if (part && part !== ".") parts.push(part);
	}
	return parts.join("/");
}
