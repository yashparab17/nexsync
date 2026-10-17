import { useCallback, useEffect, useState } from "react";

import { AlertTriangle, Play, RefreshCw } from "@/components/animate-icons";
import { Panel } from "@/components/layout/Page";
import { Button } from "@/components/ui/button";
import { projectContainers } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import type { Containers, RuntimeInfo, TaskSpec } from "@/types/projects";

const DOT: Record<string, string> = { running: "bg-success", exited: "bg-muted-foreground/50", none: "bg-muted-foreground/30", restarting: "bg-warning", paused: "bg-warning", dead: "bg-destructive", created: "bg-muted-foreground/50" };

// Where a project runs: the container engine and the services of a Compose file, what a Dev Container file says, and, on Windows with
// the Windows Subsystem for Linux, which distribution this device runs the project's tasks in. Shown only when there is something to say.
export default function ContainersPanel({
	path,
	project,
	kinds,
	tasks,
	runtime,
	canRun,
	onRun,
	onRuntime,
}: {
	path: string;
	project: string;
	kinds: string[];
	tasks: TaskSpec[];
	runtime: RuntimeInfo;
	canRun: boolean;
	onRun: (task: TaskSpec) => void;
	onRuntime: (wsl: string | null) => void;
}) {
	const wanted = kinds.includes("docker") || kinds.includes("compose");
	const [info, setInfo] = useState<Containers | null>(null);
	const look = useCallback(() => {
		if (wanted) projectContainers(path, project).then(setInfo).catch(() => setInfo(null));
	}, [path, project, wanted]);
	useEffect(look, [look]);

	if (!wanted && runtime.distros.length === 0) return null;
	const task = (id: string) => tasks.find((t) => t.id === id);

	return (
		<Panel
			title="Containers and Runtime"
			className="@4xl:col-span-2"
			flush={!!info?.services.length}
			right={
				wanted && (
					<Button variant="ghost" size="icon-xs" aria-label="Look again" onPress={look}>
						<RefreshCw className="size-3.5" />
					</Button>
				)
			}
		>
			<div className="space-y-3 text-sm">
				{runtime.distros.length > 0 && (
					<label className={cn("flex flex-wrap items-center gap-3", info?.services.length ? "px-4 pt-3" : "")}>
						<span className="text-muted-foreground">Run this project's tasks in</span>
						<select value={runtime.wsl ?? ""} onChange={(e) => onRuntime(e.target.value || null)} className="h-8 cursor-pointer border bg-input px-2 text-sm">
							<option value="">Windows</option>
							{runtime.distros.map((d) => (
								<option key={d} value={d}>
									WSL: {d}
								</option>
							))}
						</select>
						<span className="text-[13px] text-muted-foreground">Only on this device. The tools shown below are then asked for inside it.</span>
					</label>
				)}
				{wanted && info && (
					<>
						<p className={cn("flex items-center gap-2", info.services.length ? "px-4" : "")}>
							<span className={cn("size-2 rounded-full", info.docker.state === "running" ? "bg-success" : "bg-warning")} aria-hidden />
							{info.docker.state === "running" ? `Docker ${info.docker.version} is running.` : info.docker.state === "missing" ? "Docker is not installed on this device, or this app cannot find it." : "Docker is installed but its engine is not answering. Start Docker Desktop (or the service)."}
						</p>
						{info.docker.state === "stopped" && info.docker.note && <p className={cn("font-mono text-[13px] text-muted-foreground", info.services.length ? "px-4" : "")}>{info.docker.note}</p>}
						{info.composeFile && canRun && (
							<div className={cn("flex flex-wrap gap-2", info.services.length ? "px-4" : "")}>
								{["up", "down", "logs", "build"].map((id) => task(id)).filter((t): t is TaskSpec => !!t).map((t) => (
									<Button key={t.id} variant="outline" size="xs" isDisabled={info.docker.state !== "running"} onPress={() => onRun(t)}>
										<Play className="size-3" />
										{t.label}
									</Button>
								))}
							</div>
						)}
						{info.services.length > 0 && (
							<ul className="divide-y border-t">
								{info.services.map((s) => (
									<li key={s.name} className="flex items-center gap-3 px-4 py-2">
										<span className={cn("size-2 shrink-0 rounded-full", DOT[s.state] ?? "bg-muted-foreground/50")} aria-hidden />
										<span className="min-w-0 flex-1">
											<span className="block truncate font-mono">{s.name}</span>
											<span className="block truncate text-[13px] text-muted-foreground">{s.status || (s.state === "none" ? "no container yet" : s.state)}</span>
										</span>
										{s.ports.map((p) => (
											<span key={p} className="font-mono text-[13px] text-muted-foreground">
												:{p}
											</span>
										))}
									</li>
								))}
							</ul>
						)}
						{info.dockerfiles.length > 0 && <p className={cn("text-[13px] text-muted-foreground", info.services.length ? "px-4" : "")}>Dockerfiles: {info.dockerfiles.join(", ")}</p>}
						{info.devcontainer && (
							<p className={cn("flex items-start gap-2 text-[13px] text-muted-foreground", info.services.length ? "px-4 pb-3" : "")}>
								<AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
								<span>
									This project has a Dev Container{info.devcontainer.name ? ` (${info.devcontainer.name})` : ""}
									{info.devcontainer.image ? ` on ${info.devcontainer.image}` : ""}
									{info.devcontainer.forwardPorts.length ? `, forwarding ${info.devcontainer.forwardPorts.map((p) => `:${p}`).join(" ")}` : ""}
									{info.devcontainer.postCreate ? `, then running "${info.devcontainer.postCreate}"` : ""}. Nexsync does not open a Dev Container; the Doctor and the tasks above are the way to get the same setup on this device.
								</span>
							</p>
						)}
					</>
				)}
			</div>
		</Panel>
	);
}
