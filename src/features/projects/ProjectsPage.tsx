// Projects: the folders under projects/, what kind each is, the recipe the team shares for it, and what this device does with it:
// run its tasks (after approving each command), watch their output and problems, keep the environment, and see when the
// dependencies the team changed need installing.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { AlertTriangle, Check, EyeOff, Clock, FolderPlus, Info, Network, Play, RefreshCw, Terminal, X } from "@/components/animate-icons";
import TerminalView from "@/features/editor/components/TerminalView";
import { EmptyState, Page, PageBody, Panel } from "@/components/layout/Page";
import CollapsiblePane from "@/components/layout/CollapsiblePane";
import Toolbar, { ToolbarSelect, ToolbarTabs, ToolbarTitle } from "@/components/layout/Toolbar";
import ContainersPanel from "@/features/projects/components/ContainersPanel";
import AuditPanel from "@/features/projects/components/AuditPanel";
import GeneratorsPanel from "@/features/projects/components/GeneratorsPanel";
import EnvPanel from "@/features/projects/components/EnvPanel";
import NewProjectDialog from "@/features/projects/components/NewProjectDialog";
import PreviewPane from "@/features/projects/components/PreviewPane";
import SearchPanel from "@/features/projects/components/SearchPanel";
import RequestsPanel from "@/features/projects/components/RequestsPanel";
import TeamPanel from "@/features/projects/components/TeamPanel";
import TestsPanel from "@/features/projects/components/TestsPanel";
import RunOutput from "@/features/projects/components/RunOutput";
import TaskTrustDialog from "@/features/projects/components/TaskTrustDialog";
import { Button } from "@/components/ui/button";
import { useErrorLog } from "@/hooks/useErrorLog";
import { useLspProblems } from "@/features/projects/lib/lsp";
import { forgetFinished, listenToRuns, runsNow, sameProblem, useRuns, waitForRun, type Run } from "@/features/projects/lib/projectRuns";
import { ignoreRule, insideProject, problemPath, recipeFromDetected, tasksOf, toolsOf } from "@/features/projects/lib/projects";
import { serverIds, startOrder } from "@/lib/taskOrder";
import { all, envChannel, envShareOf, newest, reproChannel, runChannel, runShareOf, tailOf, type EnvShare, type ReproShare, type RunShare } from "@/features/projects/lib/teamStatus";
import {
	p2pHeldCount,
	p2pHoldIncoming,
	projectAddIgnore,
	projectCreate,
	projectDepsMark,
	projectDepsStatus,
	projectDoctor,
	projectRuntime,
	projectRuntimeSet,
	projectEnvStatus,
	projectRuns,
	projectSaveRecipe,
	projectScan,
	projectSecretAllow,
	projectsList,
	projectTaskApprove,
	projectTaskStart,
	projectTaskStop,
	projectTaskTrust,
} from "@/lib/tauri";
import { cn, errorText, formatBytes } from "@/lib/utils";
import { useChat } from "@/store/chat/ChatContext";
import { useIsViewer } from "@/store/p2p/P2PContext";
import { useWorkspace } from "@/store/workspace/WorkspaceContext";
import type { DepsStatus, Doctor, EnvState, ProjectInfo, Problem, RuntimeInfo, Scan, TaskSpec, Trust } from "@/features/projects/types";

type Tab = "overview" | "output" | "problems" | "preview" | "tests" | "search" | "requests" | "team";

// Whether this device shares its tools and what it runs with the workspace, per workspace; off until chosen
const shareKey = (id: string) => `nexsync-share-setup:${id}`;
const readShare = (id: string) => {
	try {
		return localStorage.getItem(shareKey(id)) === "1";
	} catch {
		return false;
	}
};

const openUrl = (url: string) => void import("@tauri-apps/plugin-opener").then((m) => m.openUrl(url)).catch(() => {});

export default function ProjectsPage() {
	const { workspace } = useWorkspace();
	const navigate = useNavigate();
	const [params, setParams] = useSearchParams();
	const isViewer = useIsViewer();
	const logError = useErrorLog();
	const chat = useChat();
	const path = workspace?.path ?? "";
	const [sharing, setSharing] = useState(() => (workspace ? readShare(workspace.id) : false));

	const [projects, setProjects] = useState<ProjectInfo[] | null>(null);
	const [selected, setSelected] = useState<string | null>(null);
	const [tab, setTab] = useState<Tab>("overview");
	const [scan, setScan] = useState<Scan | null>(null);
	const [doctor, setDoctor] = useState<Doctor | null>(null);
	const [env, setEnv] = useState<EnvState[]>([]);
	const [runtime, setRuntime] = useState<RuntimeInfo>({ distros: [], wsl: null });
	const [deps, setDeps] = useState<DepsStatus | null>(null);
	const [creating, setCreating] = useState(false);
	const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
	const [ask, setAsk] = useState<{ label: string; trust: Trust; resolve: (c: "once" | "always" | null) => void } | null>(null);
	const [held, setHeld] = useState<{ holding: boolean; count: number }>({ holding: false, count: 0 });
	const [, bump] = useState(0);
	// Tasks running in a real terminal (the ones that ask questions), until closed
	const [terminals, setTerminals] = useState<{ key: number; label: string; dir: string; command: string; exited: number | null | undefined }[]>([]);

	useEffect(() => {
		listenToRuns();
	}, []);

	const load = useCallback(async () => {
		if (!path) return;
		try {
			setProjects(await projectsList(path));
		} catch (err) {
			logError(err, { source: "projects", workspace: path });
			setProjects([]);
		}
		projectScan(path).then(setScan).catch(() => setScan(null));
	}, [path, logError]);

	useEffect(() => {
		void load();
	}, [load]);

	const project = useMemo(() => projects?.find((p) => p.path === selected) ?? projects?.[0] ?? null, [projects, selected]);
	const projectId = project && !project.scratch ? project.id : null;
	const tasks = project ? tasksOf(project) : [];
	const tools = project ? toolsOf(project) : [];
	const toolKey = JSON.stringify(tools);
	const runs = useRuns(projectId ?? undefined);
	const running = runs.filter((r) => r.status !== "done");

	// Where this device runs the project's tasks (this system, or a WSL distribution), asked again when the project changes
	useEffect(() => {
		if (!path || !projectId) return setRuntime({ distros: [], wsl: null });
		projectRuntime(path, projectId).then(setRuntime).catch(() => setRuntime({ distros: [], wsl: null }));
	}, [path, projectId]);

	// This device's answer for the project's tools, asked again when the list changes
	const check = useCallback(() => {
		setDoctor(null);
		if (!path || tools.length === 0) return;
		projectDoctor(path, tools, runtime.wsl).then(setDoctor).catch((err) => logError(err, { source: "projects", workspace: path }));
		// eslint-disable-next-line react-hooks/exhaustive-deps -- toolKey stands for the list
	}, [path, toolKey, logError, runtime.wsl]);
	useEffect(check, [check]);

	// The environment and the dependencies of the open project, again when a run ends (an install changes the second)
	const refreshLocal = useCallback(() => {
		if (!path || !projectId) {
			setEnv([]);
			setDeps(null);
			return;
		}
		projectEnvStatus(path, projectId).then(setEnv).catch(() => setEnv([]));
		projectDepsStatus(path, projectId).then(setDeps).catch(() => setDeps(null));
	}, [path, projectId]);
	const finished = runs.filter((r) => r.status === "done").length;
	useEffect(refreshLocal, [refreshLocal, finished, project?.detected.env.length]);

	// Whether incoming changes are paused, and how many wait; asked again while paused
	useEffect(() => {
		const ask = () => void p2pHeldCount().then(([holding, count]) => setHeld({ holding, count })).catch(() => {});
		ask();
		const timer = setInterval(ask, 2000);
		return () => clearInterval(timer);
	}, []);

	const act = async (what: () => Promise<unknown>, done: string) => {
		setNotice(null);
		try {
			await what();
			setNotice({ ok: true, text: done });
			await load();
		} catch (err) {
			setNotice({ ok: false, text: errorText(err, "That did not work.") });
		}
	};

	// Asks, if this device has not approved the task as it is now. Returns whether it may run, and whether that was for once only.
	const approve = useCallback(
		async (task: TaskSpec): Promise<{ once: boolean } | null> => {
			if (!projectId) return null;
			const trust = await projectTaskTrust(path, projectId, task.id);
			if (trust.trusted) return { once: false };
			const choice = await new Promise<"once" | "always" | null>((resolve) => setAsk({ label: task.label, trust, resolve }));
			setAsk(null);
			if (!choice) return null;
			if (choice === "always") await projectTaskApprove(path, projectId, task.id);
			return { once: choice === "once" };
		},
		[path, projectId],
	);

	// The same approval, then the command typed into a real terminal in the task's folder: for tasks that ask questions
	const runInTerminal = async (task: TaskSpec) => {
		if (!projectId || !project) return;
		setNotice(null);
		try {
			if (!(await approve(task))) return;
			const dir = [project.path, task.cwd].filter(Boolean).join("/");
			setTerminals((t) => [...t, { key: Date.now(), label: task.label, dir, command: task.command, exited: undefined }]);
			setTab("output");
		} catch (err) {
			setNotice({ ok: false, text: errorText(err, "The terminal did not open.") });
		}
	};

	// Starts the task, asking first if needed. Returns the run's id, or null when declined.
	const runTask = useCallback(
		async (task: TaskSpec, goToOutput = true, args?: string[]): Promise<string | null> => {
			if (!projectId) return null;
			setNotice(null);
			try {
				const allowed = await approve(task);
				if (!allowed) return null;
				const id = await projectTaskStart(path, projectId, task.id, allowed.once, args);
				if (goToOutput) setTab("output");
				return id;
			} catch (err) {
				setNotice({ ok: false, text: errorText(err, "The task did not start.") });
				return null;
			}
		},
		[path, projectId, approve],
	);

	// The servers and watchers, each after what it waits on, and each ready before the next starts
	const startAll = async () => {
		const order = startOrder(tasks, serverIds(tasks));
		for (const t of order) {
			if (runsNow().some((r) => r.project === projectId && r.task === t.id && r.status !== "done")) continue;
			const id = await runTask(t);
			if (!id) return;
			try {
				await waitForRun(id);
			} catch (err) {
				setNotice({ ok: false, text: `${t.label}: ${errorText(err, "it did not become ready")}` });
				return;
			}
		}
	};

	// `?run=project:task`, from the command palette: open that project and start the task (asking first, as always)
	const wanted = params.get("run");
	const [pending, setPending] = useState<{ project: string; task: string } | null>(null);
	useEffect(() => {
		if (!wanted || !projects) return;
		const [id, taskId] = wanted.split(":");
		const target = projects.find((p) => p.id === id);
		setParams({}, { replace: true });
		if (!target || !tasksOf(target).some((t) => t.id === taskId)) return setNotice({ ok: false, text: "That task is no longer in the project." });
		setSelected(target.path);
		setPending({ project: id, task: taskId });
	}, [wanted, projects, setParams]);
	// It starts once that project is the open one, so the task runs in the right folder
	useEffect(() => {
		if (!pending || projectId !== pending.project) return;
		const task = tasks.find((t) => t.id === pending.task);
		setPending(null);
		if (task) void (task.interactive ? runInTerminal(task) : runTask(task));
		// eslint-disable-next-line react-hooks/exhaustive-deps -- once per request
	}, [pending, projectId]);

	// What this device shares, when it chose to: its tools, and what it is running. An entry is written only when it says
	// something new, so a quiet project adds nothing to the log.
	const posted = useRef(new Map<string, string>());
	const runningKey = running.map((r) => r.task).sort().join(",");
	const installed = !deps || deps.state === "current" || deps.state === "none";
	useEffect(() => {
		if (!sharing || !projectId || !doctor || !chat.canPost || !chat.me) return;
		const env = envShareOf(doctor, installed);
		const last = newest<EnvShare>(chat.entries, "devenv", envChannel(projectId)).find((m) => m.key === chat.me)?.data;
		const body = JSON.stringify(env);
		if (JSON.stringify(last) !== body && posted.current.get("env") !== body) {
			posted.current.set("env", body);
			void chat.post({ kind: "devenv", channel: envChannel(projectId), body }).catch(() => posted.current.delete("env"));
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps -- the entries are read, not watched: a post answers itself
	}, [sharing, projectId, doctor, installed, chat.canPost, chat.me]);
	useEffect(() => {
		if (!sharing || !projectId || !chat.canPost || !chat.me) return;
		let live = true;
		void projectRuns(path, projectId).then((history) => {
			if (!live) return;
			const run = runShareOf(runningKey ? runningKey.split(",") : [], history, Date.now());
			const last = newest<RunShare>(chat.entries, "devrun", runChannel(projectId)).find((m) => m.key === chat.me)?.data;
			const strip = (r?: RunShare) => JSON.stringify(r && { ...r, at: 0 });
			const body = JSON.stringify(run);
			if (strip(last) === strip(run) || posted.current.get("run") === strip(run)) return;
			posted.current.set("run", strip(run));
			void chat.post({ kind: "devrun", channel: runChannel(projectId), body }).catch(() => posted.current.delete("run"));
		}).catch(() => {});
		return () => {
			live = false;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps -- as above
	}, [sharing, projectId, runningKey, finished, chat.canPost, chat.me]);
	const teamEnvs = useMemo(() => (projectId ? newest<EnvShare>(chat.entries, "devenv", envChannel(projectId)) : []), [chat.entries, projectId]);
	const teamRuns = useMemo(() => (projectId ? newest<RunShare>(chat.entries, "devrun", runChannel(projectId)) : []), [chat.entries, projectId]);
	const teamFailures = useMemo(() => (projectId ? all<ReproShare>(chat.entries, "devrepro", reproChannel(projectId)) : []), [chat.entries, projectId]);
	// A failed run, shared as a signed entry: the task, how it ended, the end of its output, and the tools on this device
	const shareFailure = async (run: Run) => {
		if (!projectId) return;
		const task = tasks.find((t) => t.id === run.task);
		const { text, cut } = tailOf(run.lines.map((l) => l.text));
		const repro: ReproShare = {
			task: run.task,
			command: task?.command ?? "",
			code: run.code,
			durationMs: Date.now() - run.startedAt,
			startedAt: run.startedAt,
			os: doctor ? envShareOf(doctor, installed).os : "",
			tools: doctor ? envShareOf(doctor, installed).tools : [],
			log: text,
			cut: cut || run.dropped > 0,
			problems: run.problems.slice(0, 10).map((p) => ({ file: p.file, line: p.line, message: p.message.slice(0, 200) })),
		};
		await chat.post({ kind: "devrepro", channel: reproChannel(projectId), body: JSON.stringify(repro) });
	};
	const share = (on: boolean) => {
		setSharing(on);
		try {
			if (workspace) localStorage.setItem(shareKey(workspace.id), on ? "1" : "0");
		} catch {
			/* blocked storage: the choice lasts until the page closes */
		}
	};

	const stopAll = () => running.forEach((r) => void projectTaskStop(r.runId));

	// The ports a preview can show: those a running task opened, the recipe's, and the ports its servers are declared to use
	const previewPorts = useMemo(() => {
		const ports: number[] = [];
		const add = (p?: number | null) => p && !ports.includes(p) && ports.push(p);
		running.forEach((r) => r.ports.forEach((p) => add(p.port)));
		if (running.length > 0) tasks.filter((t) => t.watch && running.some((r) => r.task === t.id)).forEach((t) => t.ports.forEach(add));
		return ports;
	}, [running, tasks]);

	// What the project's language servers report joins what its tasks reported
	const lspProblems = useLspProblems(projectId);
	const problems = useMemo(() => {
		const all: { problem: Problem; cwd: string }[] = [];
		for (const r of runs) for (const p of r.problems) if (!all.some((x) => sameProblem(x.problem, p))) all.push({ problem: p, cwd: tasks.find((t) => t.id === r.task)?.cwd ?? "" });
		for (const p of lspProblems) if (!all.some((x) => sameProblem(x.problem, p))) all.push({ problem: p, cwd: "" });
		return all;
	}, [runs, tasks, lspProblems]);

	const hold = async (on: boolean) => {
		const count = await p2pHoldIncoming(on).catch(() => 0);
		setHeld({ holding: on, count });
		bump((n) => n + 1);
	};

	const mine = <T extends { path: string }>(list: T[]): T[] => (project ? list.filter((x) => insideProject(project, x.path)) : []);

	return (
		<Page>
			<Toolbar>
				<ToolbarTitle name="Projects" meta={projects ? String(projects.length) : undefined} />
				{projectId && (
					<ToolbarTabs
						label="Project view"
						value={tab}
						onChange={setTab}
						tabs={[
							{ key: "overview", label: "Overview" },
							{ key: "output", label: "Output", count: running.length || undefined },
							{ key: "problems", label: "Problems", count: problems.length || undefined },
							{ key: "preview", label: "Preview" },
								{ key: "tests", label: "Tests" },
								{ key: "search", label: "Search" },
								{ key: "requests", label: "Requests" },
								{ key: "team", label: "Team" },
						]}
					/>
				)}
				<span className="flex-1" />
				{!isViewer && (
					<span title="Changes other people make in projects wait until you resume, so a build or a test run is not disturbed"><Button variant={held.holding ? "default" : "ghost"} size="sm" aria-pressed={held.holding} onPress={() => void hold(!held.holding)}>
						{held.holding ? <Play className="size-4" /> : <Clock className="size-4" />}
						{held.holding ? `Resume Incoming${held.count ? ` (${held.count})` : ""}` : "Pause Incoming"}
					</Button></span>
				)}
				<Button variant="ghost" size="icon-sm" aria-label="Look again" onPress={() => void load()}>
					<RefreshCw className="size-4" />
				</Button>
				{!isViewer && (
					<Button size="sm" onPress={() => setCreating(true)}>
						<FolderPlus className="size-4" />
						New Project
					</Button>
				)}
			</Toolbar>

			<div className="@container flex min-h-0 flex-1">
				{projects && projects.length > 0 && (
					<CollapsiblePane id="projects.list" defaultWidth={240} label="the list of projects" className="hidden @3xl:flex">
					<nav aria-label="Projects" className="flex w-60 shrink-0 flex-col gap-0.5 overflow-y-auto bg-panel p-2">
						{projects.map((p) => (
							<button
								key={p.path}
								type="button"
								aria-current={p.path === project?.path}
								onClick={() => setSelected(p.path)}
								className={cn("flex min-w-0 flex-col items-start gap-0.5 px-3 py-2 text-left outline-none hover:bg-muted focus-visible:bg-muted", p.path === project?.path && "bg-muted")}
							>
								<span className="flex w-full items-center gap-2 text-sm font-medium">
									<span className="min-w-0 flex-1 truncate">{p.name}</span>
									{runsNow().some((r) => r.project === p.id && r.status !== "done") && <span className="size-2 shrink-0 rounded-full bg-success" title="Something is running" />}
								</span>
								<span className="w-full truncate font-mono text-[13px] text-muted-foreground">{p.scratch ? "loose files" : p.detected.kinds.map((k) => k.label).slice(0, 3).join(", ") || "no kind found"}</span>
							</button>
						))}
					</nav>
				</CollapsiblePane>
				)}

				<PageBody className="flex flex-1 flex-col">
					{projects === null ? null : !project ? (
						<EmptyState art="projects" title="No Projects Yet" action={!isViewer && <Button onPress={() => setCreating(true)}>New Project</Button>}>
							A project is a folder in the workspace's projects folder: a Vite site, a Django service, a Rust crate, a Flutter app. Nexsync works out what it is, keeps what belongs to your machine (dependencies, build output, secrets) off everyone else's, and shares the recipe for running it.
						</EmptyState>
					) : (
						<div className={cn("space-y-4", tab === "output" && "flex min-h-0 flex-1 flex-col")}>
							<div className="@3xl:hidden">
								<ToolbarSelect label="Project" value={project.path} onChange={setSelected} options={(projects ?? []).map((p) => ({ value: p.path, label: p.name }))} />
							</div>
							{notice && (
								<p role={notice.ok ? "status" : "alert"} className={notice.ok ? "bg-success/10 p-2 text-sm text-success" : "bg-destructive/10 p-2 text-sm text-destructive"}>
									{notice.text}
								</p>
							)}

							{tab === "output" && projectId ? (
								<>
								{terminals.map((term) => (
									<section key={term.key} aria-label={`${term.label} in a terminal`} className="frame flex h-80 shrink-0 flex-col overflow-hidden">
										<header className="flex h-10 shrink-0 items-center gap-3 border-b px-3">
											<Terminal className="size-4 text-muted-foreground" />
											<span className="min-w-0 flex-1 truncate text-sm font-medium">{term.label}</span>
											<span className="font-mono text-[13px] text-muted-foreground">{term.exited === undefined ? "running" : `ended${term.exited ? ` with code ${term.exited}` : ""}`}</span>
											<Button variant="ghost" size="icon-xs" aria-label="Close the terminal" onPress={() => setTerminals((all) => all.filter((x) => x.key !== term.key))}>
												<X className="size-3.5" />
											</Button>
										</header>
										<div className="min-h-0 flex-1">
											<TerminalView workspacePath={path} dir={term.dir} command={term.command} visible onExit={(code) => setTerminals((all) => all.map((x) => (x.key === term.key ? { ...x, exited: code } : x)))} onFailed={(m) => setNotice({ ok: false, text: m })} />
										</div>
									</section>
								))}
								<RunOutput workspacePath={path} project={projectId} runs={runs} onShare={chat.canPost ? shareFailure : undefined} onRerun={(id) => { const t = tasks.find((x) => x.id === id); if (t) void runTask(t); }} onOpenUrl={(port) => openUrl(`http://localhost:${port}`)} />
								</>
							) : tab === "preview" && projectId ? (
								<PreviewPane
									ports={previewPorts}
									running={running.length > 0}
									startLabel={tasks.find((t) => t.watch) ? `Start ${tasks.find((t) => t.watch)!.label}` : null}
									onStart={() => {
										const t = tasks.find((x) => x.watch);
										if (t) void runTask(t, false);
									}}
									onOpenUrl={openUrl}
								/>
							) : tab === "tests" && projectId ? (
								<TestsPanel
									path={path}
									project={projectId}
									runs={runs}
									tasks={tasks}
										canRun={!isViewer}
										onOpenFile={(rel) => navigate(`/workspace/editor?open=${encodeURIComponent(`/${project.path}/${rel}`)}`)}
										onRunOne={(taskId, args) => {
										const t = tasks.find((x) => x.id === taskId);
										if (t) void runTask(t, true, args);
									}}
								/>
								) : tab === "search" && projectId ? (
									<SearchPanel path={path} project={projectId} canReplace={!isViewer} onOpen={(rel, line) => navigate(`/workspace/editor?open=${encodeURIComponent(`/${project.path}/${rel}#L${line}`)}`)} />
								) : tab === "requests" && projectId ? (
									<RequestsPanel path={path} project={projectId} onOpenFile={(rel) => navigate(`/workspace/editor?open=${encodeURIComponent(`/${project.path}/${rel}`)}`)} />
								) : tab === "team" && projectId ? (
									<TeamPanel
										me={chat.me}
										envs={teamEnvs}
										runs={teamRuns}
										failures={teamFailures}
										myTools={doctor ? envShareOf(doctor, installed).tools : []}
										recipe={{ server: tasks.filter((t) => t.watch).map((t) => t.id), tests: tasks.some((t) => t.id === "test"), install: tasks.some((t) => t.id === "install") }}
										sharing={sharing}
										canShare={chat.canPost}
										onShare={share}
									/>
								) : tab === "problems" && projectId ? (
								<ProblemsList
									items={problems}
									onClear={() => forgetFinished(projectId)}
									onOpen={({ problem, cwd }) => {
										const rel = problemPath(path, project, cwd, problem.file);
										if (rel) navigate(`/workspace/editor?open=${encodeURIComponent(`/${rel}#L${problem.line}`)}`);
									}}
									canOpen={({ problem, cwd }) => problemPath(path, project, cwd, problem.file) !== null}
								/>
							) : (
								<div className="grid gap-4 @4xl:grid-cols-2">
									{projectId && deps && (deps.state === "changed" || (deps.state === "never" && tasks.some((t) => t.id === "install"))) && (
										<Banner className="@4xl:col-span-2">
											<span className="min-w-0 flex-1">
												{deps.state === "changed" ? "The dependencies changed since you last installed them here." : "The dependencies are not installed on this device yet."}{" "}
												<span className="font-mono text-[13px] text-muted-foreground">{deps.files.join(", ")}</span>
											</span>
											{tasks.some((t) => t.id === "install") && !isViewer && (
												<Button size="sm" onPress={() => void runTask(tasks.find((t) => t.id === "install")!)}>
													Install
												</Button>
											)}
											<Button variant="ghost" size="sm" onPress={() => void projectDepsMark(path, projectId).then(refreshLocal)}>
												I Already Did
											</Button>
										</Banner>
									)}

									<Panel title="What This Is" icon={<Network />} className="@4xl:col-span-2">
										<div className="space-y-3 text-sm">
											<div className="flex flex-wrap gap-2">
												{project.scratch ? (
													<p className="text-muted-foreground">Files directly in the projects folder, outside any project.</p>
												) : project.detected.kinds.length === 0 ? (
													<p className="text-muted-foreground">No known kind of project yet. Add its files, or write the recipe yourself.</p>
												) : (
													project.detected.kinds.map((k) => (
														<span key={k.id} title={k.group} className="bg-muted px-2 py-1 font-mono text-[13px]">
															{k.label}
														</span>
													))
												)}
											</div>
											{project.recipeError && (
												<p role="alert" className="bg-destructive/10 p-2 text-destructive">
													The recipe in this folder cannot be used: {project.recipeError}
												</p>
											)}
											{!project.scratch && (
												<div className="flex flex-wrap items-center gap-2">
													<span className="text-muted-foreground">{project.recipe ? "The team shares this project's recipe (nexsync.project.json)." : "No recipe yet: what is shown below is what Nexsync found."}</span>
													<span className="flex-1" />
													{!isViewer && (
														<Button variant={project.recipe ? "outline" : "default"} size="sm" onPress={() => void act(() => projectSaveRecipe(path, project.id, recipeFromDetected(project)), project.recipe ? "The recipe now matches what Nexsync found." : "Recipe saved. It syncs with the project.")}>
															{project.recipe ? "Reset From What Was Found" : "Save as the Team's Recipe"}
														</Button>
													)}
												</div>
											)}
										</div>
									</Panel>

									<Panel
										title="Tasks"
										hint={String(tasks.length)}
										flush={tasks.length > 0}
										right={
											projectId &&
											!isViewer &&
											tasks.some((t) => t.watch) && (
												<>
													<Button variant="outline" size="xs" onPress={() => void startAll()}>
														<Play className="size-3" />
														Start All
													</Button>
													{running.length > 0 && (
														<Button variant="ghost" size="xs" onPress={stopAll}>
															<X className="size-3" />
															Stop All
														</Button>
													)}
												</>
											)
										}
									>
										{tasks.length === 0 ? (
											<p className="text-sm text-muted-foreground">No commands found. A recipe can list them.</p>
										) : (
											<ul className="divide-y">
												{tasks.map((t) => {
													const live = runs.find((r) => r.task === t.id && r.status !== "done");
													return (
														<li key={t.id} className="flex items-center gap-3 px-4 py-3">
															<span className="min-w-0 flex-1">
																<span className="block truncate text-sm font-medium">{t.label}</span>
																<span className="block truncate font-mono text-[13px] text-muted-foreground">{t.command}</span>
															</span>
															{t.ports.length > 0 && <span className="shrink-0 font-mono text-[13px] text-muted-foreground">:{t.ports[0]}</span>}
															{t.watch && <span className="shrink-0 bg-muted px-2 py-0.5 font-mono text-[13px]">keeps running</span>}
															{projectId &&
																!isViewer &&
																(live ? (
																	<Button variant="outline" size="xs" onPress={() => void projectTaskStop(live.runId)}>
																		<X className="size-3" />
																		Stop
																	</Button>
																) : (
																	<Button variant="outline" size="xs" onPress={() => void (t.interactive ? runInTerminal(t) : runTask(t))}>
																		<Play className="size-3" />
																		Run
																	</Button>
																))}
															{projectId && !isViewer && !live && !t.interactive && (
																<Button variant="ghost" size="icon-xs" aria-label={`Run ${t.label} in a terminal`} onPress={() => void runInTerminal(t)}>
																	<Terminal className="size-3.5" />
																</Button>
															)}
														</li>
													);
												})}
											</ul>
										)}
									</Panel>

									<Panel title="Tools on This Device" hint={doctor?.managers.length ? doctor.managers.join(", ") : undefined} right={tools.length > 0 && <Button variant="ghost" size="icon-xs" aria-label="Check again" onPress={check}><RefreshCw className="size-3.5" /></Button>} flush={tools.length > 0}>
										{tools.length === 0 ? (
											<p className="text-sm text-muted-foreground">This project names no tools.</p>
										) : !doctor ? (
											<p className="px-4 py-3 text-sm text-muted-foreground">Checking...</p>
										) : (
											<ul className="divide-y">
												{doctor.tools.map((t) => (
													<li key={t.name} className="flex items-center gap-3 px-4 py-3">
														{t.state === "ok" ? <Check className="size-4 shrink-0 text-success" /> : t.state === "unknown" ? <Info className="size-4 shrink-0 text-muted-foreground" /> : <AlertTriangle className="size-4 shrink-0 text-warning" />}
														<span className="min-w-0 flex-1">
															<span className="block truncate font-mono text-sm">
																{t.name}
																{t.range && <span className="text-muted-foreground"> {t.range}</span>}
															</span>
															<span className="block truncate text-[13px] text-muted-foreground">
																{t.state === "ok" ? `Version ${t.found}` : t.state === "old" ? `Version ${t.found} is not one this project accepts` : t.state === "missing" ? "Not installed, or not on this app's PATH" : "Not a program Nexsync checks"}
															</span>
														</span>
														{t.url && t.state !== "ok" && (
															<Button variant="ghost" size="xs" onPress={() => openUrl(t.url!)}>
																How to Install
															</Button>
														)}
													</li>
												))}
											</ul>
										)}
									</Panel>

									{projectId ? <EnvPanel path={path} project={projectId} vars={env} canEdit={!isViewer} onChanged={refreshLocal} /> : null}

										{projectId && (
											<ContainersPanel
												path={path}
												project={projectId}
												kinds={project.detected.kinds.map((k) => k.id)}
												tasks={tasks}
												runtime={runtime}
												canRun={!isViewer}
												onRun={(t) => void runTask(t)}
												onRuntime={(wsl) => void projectRuntimeSet(path, projectId, wsl).then(() => projectRuntime(path, projectId)).then(setRuntime).catch((e) => setNotice({ ok: false, text: errorText(e, "That did not change.") }))}
											/>
										)}
										{projectId && !isViewer && <GeneratorsPanel key={`g${projectId}`} path={path} project={projectId} onCreated={(first) => navigate(`/workspace/editor?open=${encodeURIComponent(`/${project.path}/${first}`)}`)} />}
										{projectId && <AuditPanel key={projectId} path={path} project={projectId} />}

										<KeptHere
											className="@4xl:col-span-2"
										scan={scan}
										heavy={mine(scan?.heavy ?? [])}
										held={mine(scan?.held ?? [])}
										hazards={mine(scan?.hazards ?? [])}
										secrets={mine(scan?.secrets ?? [])}
										canAct={!isViewer && !project.scratch}
										onIgnore={(p, folder) => void act(() => projectAddIgnore(path, project.id, ignoreRule(project, p, folder)), "Added to this project's .nexignore. It stops syncing.")}
										onAllow={(p) => void act(() => projectSecretAllow(path, p), "Allowed. The file is shared from now on.")}
									/>
								</div>
							)}
						</div>
					)}
				</PageBody>
			</div>

			{ask && <TaskTrustDialog taskLabel={ask.label} trust={ask.trust} onChoose={ask.resolve} />}
			{creating && (
				<NewProjectDialog
					path={path}
					existing={(projects ?? []).map((p) => p.id)}
					onClose={() => setCreating(false)}
					onCreateEmpty={async (name) => {
						await projectCreate(path, name);
						setSelected(`projects/${name}`);
						await load();
					}}
					onDone={(name) => {
						setCreating(false);
						setSelected(`projects/${name}`);
						setTab("overview");
						void load();
					}}
				/>
			)}
		</Page>
	);
}

const Banner = ({ children, className }: { children: ReactNode; className?: string }) => (
	<div role="status" className={cn("flex flex-wrap items-center gap-3 bg-warning/10 p-3 text-sm", className)}>
		<AlertTriangle className="size-4 shrink-0 text-warning" />
		{children}
	</div>
);

// What the runs of this project reported, as places in files that open in the editor
function ProblemsList({ items, onOpen, canOpen, onClear }: { items: { problem: Problem; cwd: string }[]; onOpen: (i: { problem: Problem; cwd: string }) => void; canOpen: (i: { problem: Problem; cwd: string }) => boolean; onClear: () => void }) {
	if (items.length === 0) return <p className="text-sm text-muted-foreground">No problems reported. Errors and warnings from a build, a type check or a test run show up here, with the file and line.</p>;
	const errors = items.filter((i) => i.problem.severity === "error").length;
	return (
		<Panel title="Problems" hint={`${errors} ${errors === 1 ? "error" : "errors"}, ${items.length - errors} ${items.length - errors === 1 ? "warning" : "warnings"}`} flush right={<Button variant="ghost" size="xs" onPress={onClear}>Clear Finished Runs</Button>}>
			<ul className="divide-y">
				{items.map((i, n) => (
					<li key={n}>
						<button type="button" disabled={!canOpen(i)} onClick={() => onOpen(i)} className="flex w-full items-start gap-3 px-4 py-3 text-left outline-none hover:bg-muted focus-visible:bg-muted disabled:cursor-default disabled:hover:bg-transparent">
							<AlertTriangle className={cn("mt-0.5 size-4 shrink-0", i.problem.severity === "error" ? "text-destructive" : "text-warning")} />
							<span className="min-w-0 flex-1">
								<span className="block text-sm">{i.problem.message}</span>
								<span className="block truncate font-mono text-[13px] text-muted-foreground">
									{i.problem.file}:{i.problem.line}
									{i.problem.column ? `:${i.problem.column}` : ""}
								</span>
							</span>
						</button>
					</li>
				))}
			</ul>
		</Panel>
	);
}

// What was found that needs a look before the project is shared: secrets, folders that look generated, files held back for
// size, and paths another operating system cannot hold
function KeptHere({ scan, heavy, held, hazards, secrets, canAct, onIgnore, onAllow, className }: { scan: Scan | null; heavy: Scan["heavy"]; held: Scan["held"]; hazards: Scan["hazards"]; secrets: Scan["secrets"]; canAct: boolean; onIgnore: (path: string, folder: boolean) => void; onAllow: (path: string) => void; className?: string }) {
	const open = secrets;
	const none = heavy.length + held.length + hazards.length + open.length === 0;
	return (
		<Panel title="Before You Share" icon={<EyeOff />} hint={scan?.truncated ? "partial" : undefined} className={className} flush={!none}>
			{!scan ? (
				<p className="text-sm text-muted-foreground">Looking...</p>
			) : none ? (
				<p className="text-sm text-muted-foreground">Nothing to check. Dependencies, build output and .env files stay on this device.</p>
			) : (
				<div className="divide-y">
					{open.length > 0 && (
						<Group title="Look Like Secrets: Not Shared Until You Decide (a guess; it misses some and flags harmless text)">
							{open.map((s) => (
								<Row key={`${s.path}:${s.line}`} main={`${s.path}:${s.line}`} sub={`${s.kind}. This file is held back from everyone else until you decide.`}>
									{canAct && (
										<>
											<Button variant="outline" size="xs" onPress={() => onIgnore(s.path, false)}>
												Keep on This Device
											</Button>
											<Button variant="ghost" size="xs" onPress={() => onAllow(s.path)}>
												It Is Fine, Share It
											</Button>
										</>
									)}
								</Row>
							))}
						</Group>
					)}
					{heavy.length > 0 && (
						<Group title="Look Like Generated Files">
							{heavy.map((h) => (
								<Row key={h.path} main={h.path} sub={`${h.files.toLocaleString()} files, ${formatBytes(h.bytes)}`}>
									{canAct && (
										<Button variant="outline" size="xs" onPress={() => onIgnore(h.path, true)}>
											Keep on This Device
										</Button>
									)}
								</Row>
							))}
						</Group>
					)}
					{held.length > 0 && (
						<Group title="Too Big to Share">
							{held.map((h) => (
								<Row key={h.path} main={h.path} sub={`${formatBytes(h.size)}: kept on this device (the limit is 25 MB)`} />
							))}
						</Group>
					)}
					{hazards.length > 0 && (
						<Group title="Names Other Systems Cannot Hold">
							{hazards.map((h) => (
								<Row key={`${h.path}${h.problem}`} main={h.path} sub={h.problem} />
							))}
						</Group>
					)}
				</div>
			)}
		</Panel>
	);
}

const Group = ({ title, children }: { title: string; children: ReactNode }) => (
	<div>
		<h3 className="px-4 pt-3 pb-1 font-mono text-[13px] text-muted-foreground">{title}</h3>
		<ul>{children}</ul>
	</div>
);

const Row = ({ main, sub, children }: { main: string; sub: string; children?: ReactNode }) => (
	<li className="flex items-center gap-3 px-4 py-2">
		<span className="min-w-0 flex-1">
			<span className="block truncate font-mono text-sm">{main}</span>
			<span className="block truncate text-[13px] text-muted-foreground">{sub}</span>
		</span>
		{children}
	</li>
);
