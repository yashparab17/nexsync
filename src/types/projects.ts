// Projects: the folders under projects/, what kind each is, the recipe a team shares for it, and what this device has

export interface TaskSpec {
	id: string;
	label: string;
	command: string;
	cwd: string;
	env: string[];
	ports: number[];
	dependsOn: string[];
	watch: boolean;
	readyWhen: string;
}

export interface ToolReq {
	name: string;
	range: string;
}

export interface EnvVar {
	name: string;
	description: string;
}

export interface Recipe {
	schema: number;
	name: string;
	kinds: string[];
	tasks: TaskSpec[];
	tools: ToolReq[];
	env: EnvVar[];
	preview?: { port?: number; path: string } | null;
	// Fields a newer Nexsync wrote are kept as they are
	[extra: string]: unknown;
}

export interface Kind {
	id: string;
	label: string;
	group: string;
}

export interface Detected {
	kinds: Kind[];
	packageManager: string | null;
	tasks: TaskSpec[];
	tools: ToolReq[];
	env: EnvVar[];
}

export interface ProjectInfo {
	id: string;
	// Workspace-relative, such as projects/app
	path: string;
	name: string;
	// Loose files directly in projects/, not a folder of their own
	scratch: boolean;
	detected: Detected;
	recipe: Recipe | null;
	recipeError: string | null;
}

export interface ToolStatus {
	name: string;
	range: string;
	found: string | null;
	state: "ok" | "old" | "missing" | "unknown";
	url: string | null;
}

export interface Doctor {
	tools: ToolStatus[];
	managers: string[];
}

export interface Scan {
	// Lines that look like a secret in files that would be shared
	secrets: { path: string; line: number; kind: string }[];
	heavy: { path: string; files: number; bytes: number }[];
	held: { path: string; size: number }[];
	hazards: { path: string; problem: string }[];
	truncated: boolean;
}

export interface Trust {
	trusted: boolean;
	command: string;
	cwd: string;
	env: string[];
	// The command approved before, when this one is not the same
	changedFrom: string | null;
}

export interface RunRecord {
	runId: string;
	project: string;
	task: string;
	started: number;
	durationMs: number;
	code: number | null;
	stopped: boolean;
	restarts: number;
}

export interface Problem {
	file: string;
	line: number;
	column: number;
	severity: "error" | "warning";
	message: string;
}

export interface EnvState {
	name: string;
	description: string;
	state: "missing" | "file" | "credential";
}

export interface DepsStatus {
	state: "none" | "current" | "changed" | "never";
	files: string[];
}
