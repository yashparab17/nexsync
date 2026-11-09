import { invoke } from "@tauri-apps/api/core";
import { writeExportFile } from "@/lib/tauri";
import type { LspServerInfo, LspStatus } from "@/features/projects/types";
import type { Audit, Bisected, Containers, RuntimeInfo, DepsStatus, Found, Impact, GeneratorList, HttpFile, HttpResponse, Planned, Doctor, EnvState, ImportPreview, ProjectInfo, Recipe, ReportFile, RunRecord, Scan, Template, ToolReq, Trust } from "@/features/projects/types";

// ── Projects ──
export function projectsList(path: string): Promise<ProjectInfo[]> {
	return invoke("projects_list", { path });
}
export function projectSaveRecipe(path: string, project: string, recipe: Recipe): Promise<Recipe> {
	return invoke("project_save_recipe", { path, project, recipe });
}
export function projectCreate(path: string, name: string): Promise<string> {
	return invoke("project_create", { path, name });
}
export function projectAddIgnore(path: string, project: string, line: string): Promise<void> {
	return invoke("project_add_ignore", { path, project, line });
}
// `wsl` asks inside that Windows Subsystem for Linux distribution instead of on this system
export function projectDoctor(path: string, tools: ToolReq[], wsl?: string | null): Promise<Doctor> {
	return invoke("project_doctor", { path, tools, wsl: wsl ?? null });
}
export function projectContainers(path: string, project: string): Promise<Containers> {
	return invoke("project_containers", { path, project });
}
export function lspStatus(path: string, project: string): Promise<LspStatus> {
	return invoke("lsp_status", { path, project });
}
// The language servers this device has and could have; they belong to the device, not to a workspace
export function lspServers(): Promise<LspServerInfo[]> {
	return invoke("lsp_servers");
}
// Installs one by running its fixed command; resolves to the last lines of what it printed
export function lspInstall(id: string): Promise<string> {
	return invoke("lsp_install", { id });
}
export function lspEnable(path: string, project: string, on: boolean): Promise<void> {
	return invoke("lsp_enable", { path, project, on });
}
// Tells the language server the text of an open file; returns its name, or null when none handles the file
export function lspSync(path: string, project: string, rel: string, text: string, version: number): Promise<string | null> {
	return invoke("lsp_sync", { path, project, rel, text, version });
}
export function lspClose(path: string, project: string, rel: string): Promise<void> {
	return invoke("lsp_close", { path, project, rel });
}
export function lspRequest<T = unknown>(path: string, project: string, rel: string, method: string, params: unknown): Promise<T> {
	return invoke("lsp_request", { path, project, rel, method, params });
}
export function projectRuntime(path: string, project: string): Promise<RuntimeInfo> {
	return invoke("project_runtime", { path, project });
}
export function projectRuntimeSet(path: string, project: string, wsl: string | null): Promise<void> {
	return invoke("project_runtime_set", { path, project, wsl });
}
export function projectScan(path: string): Promise<Scan> {
	return invoke("project_scan", { path });
}
export function projectTaskTrust(path: string, project: string, taskId: string): Promise<Trust> {
	return invoke("project_task_trust", { path, project, taskId });
}
export function projectTaskApprove(path: string, project: string, taskId: string): Promise<void> {
	return invoke("project_task_approve", { path, project, taskId });
}
// Starts a task; `once` says the person just chose Run Once for this command
// `args` are added after the approved command, each in quotes (a test's name, to run just that test)
export function projectTaskStart(path: string, project: string, taskId: string, once: boolean, args?: string[]): Promise<string> {
	return invoke("project_task_start", { path, project, taskId, once, args: args ?? null });
}
// Known-vulnerable and out-of-date packages; contacts the package registries, so only when asked
export function projectAudit(path: string, project: string): Promise<Audit[]> {
	return invoke("project_audit", { path, project });
}
export function projectGenerators(path: string, project: string): Promise<GeneratorList> {
	return invoke("project_generators", { path, project });
}
// The files a generator would write for these values (`dryRun`), or writes them; nothing is written if one exists
export function projectGenerate(path: string, project: string, generator: string, values: Record<string, string>, dryRun: boolean): Promise<Planned[]> {
	return invoke("project_generate", { path, project, generator, values, dryRun });
}
// The test files that changes since `since` (milliseconds; 0 for none known) can reach
export function projectTestImpact(path: string, project: string, since: number): Promise<Impact> {
	return invoke("project_test_impact", { path, project, since });
}
// Puts the edits since the last pass (`since`, milliseconds) back one at a time in a copy and runs the task to find the one that broke it
export function projectBisect(path: string, project: string, taskId: string, since: number): Promise<Bisected> {
	return invoke("project_bisect", { path, project, taskId, since });
}
export function projectBisectCancel(): Promise<void> {
	return invoke("project_bisect_cancel");
}
export function projectSearch(path: string, project: string, query: string, regex: boolean, caseSensitive: boolean): Promise<Found> {
	return invoke("project_search", { path, project, query, regex, caseSensitive });
}
// Replaces in the files named (from a search); returns how many replacements were made
export function projectReplace(path: string, project: string, query: string, regex: boolean, caseSensitive: boolean, replacement: string, files: string[]): Promise<number> {
	return invoke("project_replace", { path, project, query, regex, caseSensitive, replacement, files });
}
export function projectHttpFiles(path: string, project: string): Promise<HttpFile[]> {
	return invoke("project_http_files", { path, project });
}
// Sends request number `index` of a .http file, with the variables of one environment (empty for none)
export function projectHttpSend(path: string, project: string, file: string, index: number, env: string): Promise<HttpResponse> {
	return invoke("project_http_send", { path, project, file, index, env });
}
export function projectReports(path: string, project: string): Promise<ReportFile[]> {
	return invoke("project_reports", { path, project });
}
export function projectReadReport(path: string, project: string, file: string): Promise<string> {
	return invoke("project_read_report", { path, project, file });
}
export function projectSecretAllow(path: string, relPath: string): Promise<void> {
	return invoke("project_secret_allow", { path, relPath });
}
export function projectTemplates(): Promise<Template[]> {
	return invoke("project_templates");
}
export function projectScaffoldPreview(template: string, name: string, options: [string, string][]): Promise<string> {
	return invoke("project_scaffold_preview", { template, name, options });
}
// Runs a template in the projects folder; the output streams under the new project's name
export function projectScaffold(path: string, template: string, name: string, options: [string, string][]): Promise<string> {
	return invoke("project_scaffold", { path, template, name, options });
}
export function projectImportPreview(path: string, source: string): Promise<ImportPreview> {
	return invoke("project_import_preview", { path, source });
}
export function projectImport(path: string, source: string, name: string, skipKept: boolean): Promise<number> {
	return invoke("project_import", { path, source, name, skipKept });
}
export function projectTaskStop(runId: string): Promise<void> {
	return invoke("project_task_stop", { runId });
}
export function projectRuns(path: string, project: string): Promise<RunRecord[]> {
	return invoke("project_runs", { path, project });
}
export function projectRunLog(path: string, runId: string): Promise<string> {
	return invoke("project_run_log", { path, runId });
}
export function projectEnvStatus(path: string, project: string): Promise<EnvState[]> {
	return invoke("project_env_status", { path, project });
}
export function projectEnvSet(path: string, project: string, name: string, value: string, store: "file" | "credential"): Promise<void> {
	return invoke("project_env_set", { path, project, name, value, store });
}
export function projectEnvClear(path: string, project: string, name: string): Promise<void> {
	return invoke("project_env_clear", { path, project, name });
}
export function projectDepsStatus(path: string, project: string): Promise<DepsStatus> {
	return invoke("project_deps_status", { path, project });
}
export function projectDepsMark(path: string, project: string): Promise<void> {
	return invoke("project_deps_mark", { path, project });
}
// Pauses or resumes changes other devices make inside projects/; returns how many are waiting
export function p2pHoldIncoming(hold: boolean): Promise<number> {
	return invoke("p2p_hold_incoming", { hold });
}
export function p2pHeldCount(): Promise<[boolean, number]> {
	return invoke("p2p_held_count");
}
// Saves plain text to a path chosen in the save dialog
export function writeExportText(path: string, dest: string, text: string): Promise<void> {
	const bytes = new TextEncoder().encode(text);
	let binary = "";
	for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	return writeExportFile(path, dest, btoa(binary));
}

// Spelling and grammar of a text: each distinct problem once, with what to write instead
export interface ProofProblem {
	text: string;
	kind: "spelling" | "grammar";
	message: string;
	suggestions: string[];
}
export function proofCheck(text: string): Promise<ProofProblem[]> {
	return invoke("proof_check", { text });
}

