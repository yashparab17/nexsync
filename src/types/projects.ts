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
	// Asks questions or needs a real terminal: runs in one
	interactive: boolean;
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

export interface TemplateChoice {
	value: string;
	label: string;
}

export interface TemplateField {
	id: string;
	label: string;
	choices: TemplateChoice[];
}

export interface Template {
	id: string;
	label: string;
	group: string;
	about: string;
	fields: TemplateField[];
	requires: string[];
}

export interface ImportPreview {
	files: number;
	bytes: number;
	// What the project's rules keep on a device: dependencies, build output, local environment files
	left: { path: string; folder: boolean; files: number; bytes: number }[];
	scan: Scan;
}

export interface DepsStatus {
	state: "none" | "current" | "changed" | "never";
	files: string[];
}

export interface Finding {
	package: string;
	version: string;
	severity: "critical" | "high" | "moderate" | "low" | "unknown";
	id: string;
	title: string;
	fix: string;
}

export interface Audit {
	ecosystem: "npm" | "cargo" | "python";
	findings: Finding[];
	outdated: { package: string; current: string; latest: string }[];
	notes: string[];
}

export interface Generator {
	id: string;
	label: string;
	description: string;
	inputs: { id: string; label: string; default: string }[];
	files: { path: string; template: string }[];
}

export interface GeneratorList {
	generators: Generator[];
	error: string | null;
}

export interface Planned {
	path: string;
	exists: boolean;
}

export interface HttpRequest {
	name: string;
	method: string;
	url: string;
	headers: [string, string][];
	body: string;
}

export interface HttpFile {
	path: string;
	requests: HttpRequest[];
	envs: string[];
}

export interface HttpResponse {
	status: number;
	headers: [string, string][];
	body: string;
	ms: number;
	truncated: boolean;
}

export interface SearchMatch {
	path: string;
	line: number;
	text: string;
	start: number;
	end: number;
}

export interface Found {
	matches: SearchMatch[];
	files: number;
	truncated: boolean;
}

export interface Impact {
	language: "js" | "python" | "other";
	tests: string[];
	skipped: number;
	changed: string[];
	everything: boolean;
	why: string;
}

export interface Edit {
	versionId: number;
	path: string;
	hash: string;
	createdAt: string;
	source: string;
	label: string | null;
	author: string | null;
	beforeId: number | null;
}

export interface Bisected {
	outcome: "found" | "baseline-fails" | "now-passes" | "nothing-recorded" | "too-many" | "cancelled";
	culprit: Edit | null;
	edits: number;
	steps: [string, boolean][];
	log: string;
}

export interface ContainerService {
	name: string;
	state: string;
	status: string;
	ports: number[];
}

export interface Containers {
	docker: { state: "missing" | "stopped" | "running"; version: string; note: string };
	composeFile: string | null;
	services: ContainerService[];
	dockerfiles: string[];
	devcontainer: { name: string; image: string; dockerfile: string; composeFile: string; forwardPorts: number[]; postCreate: string } | null;
}

export interface RuntimeInfo {
	distros: string[];
	wsl: string | null;
}

export interface LspStatus {
	enabled: boolean;
	servers: { id: string; label: string; installed: boolean; url: string; extensions: string[] }[];
}

export interface ReportFile {
	// Inside the project
	path: string;
	kind: "junit" | "trx" | "lcov" | "cobertura";
	size: number;
	modified: number;
}
