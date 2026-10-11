import { useEffect, useRef, useState } from "react";
import { Play, Square, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { extensionOf } from "@/lib/editor/languages";
import { killRun, onRunExit, onRunOutput, runCommand } from "@/lib/tauri";
import { cn } from "@/lib/utils";

interface OutputLine {
	id: number;
	stream: "stdout" | "stderr" | "info";
	text: string;
}

// Commands that run a single file, by extension; the file goes where {file} is
const RUNNERS: Record<string, string> = {
	py: "python {file}",
	js: "node {file}",
	mjs: "node {file}",
	cjs: "node {file}",
	ts: "npx tsx {file}",
	sh: "sh {file}",
	rb: "ruby {file}",
	php: "php {file}",
	lua: "lua {file}",
	go: "go run {file}",
	java: "java {file}",
	ps1: "powershell -File {file}",
};

const MAX_LINES = 3000;
// Terminal colour codes mean nothing in this plain log
// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

// The command that runs this file, with its path relative to the editor folder the command starts in
function suggestCommand(path: string | null): string {
	if (!path) return "";
	const template = RUNNERS[extensionOf(path)];
	if (!template) return "";
	const rel = path.startsWith("editor/") ? path.slice("editor/".length) : `../${path}`;
	return template.replace("{file}", /\s/.test(rel) ? `"${rel}"` : rel);
}

// Asked once per app session, because files from collaborators run with this person's permissions
let confirmedThisSession = false;

// Run output for the Editor tab: type or pick a command, run it in the editor folder, and stop it any time
export default function RunPanel({ workspacePath, activePath }: { workspacePath: string; activePath: string | null }) {
	const [command, setCommand] = useState("");
	const [lines, setLines] = useState<OutputLine[]>([]);
	const [running, setRunning] = useState(false);
	const [confirming, setConfirming] = useState(false);
	const runIdRef = useRef<string | null>(null);
	const startingRef = useRef(false);
	const nextId = useRef(0);
	const endRef = useRef<HTMLDivElement>(null);

	// Fill in the command for the file being edited, unless the person has typed their own
	const suggested = suggestCommand(activePath);
	const lastSuggested = useRef("");
	useEffect(() => {
		setCommand((current) => (current === "" || current === lastSuggested.current ? suggested : current));
		lastSuggested.current = suggested;
	}, [suggested]);

	const push = (stream: OutputLine["stream"], text: string) =>
		setLines((prev) => [...prev.slice(-(MAX_LINES - 1)), { id: nextId.current++, stream, text: text.replace(ANSI, "") }]);

	useEffect(() => {
		// The listeners register asynchronously; if this effect is cleaned up first (StrictMode runs it twice),
		// the late ones must be removed at once or every line prints twice
		let cancelled = false;
		let offOutput = () => {};
		let offExit = () => {};
		void onRunOutput((e) => {
			// Output can arrive before the run id is returned, so the first output of a starting run claims it
			if (startingRef.current && !runIdRef.current) runIdRef.current = e.runId;
			if (e.runId === runIdRef.current) push(e.stream, e.text);
		}).then((off) => (cancelled ? off() : (offOutput = off)));
		void onRunExit((e) => {
			if (startingRef.current && !runIdRef.current) runIdRef.current = e.runId;
			if (e.runId !== runIdRef.current) return;
			runIdRef.current = null;
			setRunning(false);
			if (e.error) push("stderr", e.error);
			push("info", e.stopped ? "Stopped." : `Finished with exit code ${e.code ?? "unknown"}.`);
		}).then((off) => (cancelled ? off() : (offExit = off)));
		return () => {
			cancelled = true;
			offOutput();
			offExit();
		};
	}, []);

	useEffect(() => {
		endRef.current?.scrollIntoView?.({ block: "end" });
	}, [lines]);

	const start = async () => {
		if (!command.trim() || running) return;
		setLines([]);
		setRunning(true);
		startingRef.current = true;
		runIdRef.current = null;
		try {
			const id = await runCommand(workspacePath, "editor", command);
			// The run may already have ended while the id was on its way
			if (startingRef.current && !runIdRef.current) runIdRef.current = id;
		} catch (err) {
			push("stderr", err instanceof Error ? err.message : String(err));
			setRunning(false);
		} finally {
			startingRef.current = false;
		}
	};

	const stop = () => {
		if (runIdRef.current) void killRun(runIdRef.current);
	};

	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="flex items-center gap-2 border-b px-3 py-1.5">
				<span className="text-xs font-semibold text-muted-foreground">Run</span>
				<Input
					value={command}
					onChange={(e) => setCommand(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter") confirmedThisSession ? void start() : setConfirming(true);
					}}
					placeholder="Command to run in the editor folder, e.g. python main.py"
					className="h-7 flex-1 font-mono text-xs"
					aria-label="Command to run"
				/>
				{running ? (
					<Button size="xs" variant="destructive" onPress={stop}>
						<Square className="size-3" />
						Stop
					</Button>
				) : (
					<Button size="xs" isDisabled={!command.trim()} onPress={() => (confirmedThisSession ? void start() : setConfirming(true))}>
						<Play className="size-3" />
						Run
					</Button>
				)}
				<Button variant="ghost" size="icon-xs" aria-label="Clear output" onPress={() => setLines([])}>
					<Trash2 className="size-3.5" />
				</Button>
			</div>
			<div className="min-h-0 flex-1 overflow-auto bg-muted/20 p-3 font-mono text-xs">
				{lines.length === 0 ? (
					<p className="text-muted-foreground">Output appears here. Commands start in the workspace editor folder.</p>
				) : (
					lines.map((line) => (
						<div
							key={line.id}
							className={cn(
								"whitespace-pre-wrap break-all",
								line.stream === "stderr" && "text-destructive",
								line.stream === "info" && "text-muted-foreground",
							)}
						>
							{line.text || " "}
						</div>
					))
				)}
				<div ref={endRef} />
			</div>

			{confirming && (
				<Dialog isOpen onOpenChange={setConfirming}>
					<div className="space-y-4">
						<DialogHeader>
							<DialogTitle>Run a command on this device?</DialogTitle>
							<DialogDescription>
								The command runs with your permissions and can change files on this computer. Files from
								collaborators can contain code too, so run only what you trust.
							</DialogDescription>
						</DialogHeader>
						<p className="break-all border bg-muted/30 p-2 font-mono text-xs">{command}</p>
						<DialogFooter>
							<Button variant="outline" onPress={() => setConfirming(false)}>
								Cancel
							</Button>
							<Button
								onPress={() => {
									confirmedThisSession = true;
									setConfirming(false);
									void start();
								}}
							>
								Run
							</Button>
						</DialogFooter>
					</div>
				</Dialog>
			)}
		</div>
	);
}
