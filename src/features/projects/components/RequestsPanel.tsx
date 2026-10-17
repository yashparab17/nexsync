import { useCallback, useEffect, useState } from "react";

import { ExternalLink, Play, RefreshCw } from "@/components/animate-icons";
import { Panel } from "@/components/layout/Page";
import { Button } from "@/components/ui/button";
import { projectHttpFiles, projectHttpSend } from "@/lib/tauri";
import { cn, errorText } from "@/lib/utils";
import type { HttpFile, HttpResponse } from "@/features/projects/types";

// A JSON body is shown indented; anything else as it came
export function pretty(body: string): string {
	try {
		return JSON.stringify(JSON.parse(body), null, 2);
	} catch {
		return body;
	}
}

const tone = (status: number) => (status >= 500 ? "text-destructive" : status >= 400 ? "text-warning" : "text-success");

// The .http and .rest files of a project: each request with a Send button, and the answer beside it. A request goes out only
// when you press Send, to the address shown.
export default function RequestsPanel({ path, project, onOpenFile }: { path: string; project: string; onOpenFile: (rel: string) => void }) {
	const [files, setFiles] = useState<HttpFile[] | null>(null);
	const [env, setEnv] = useState("");
	const [busy, setBusy] = useState<string | null>(null);
	const [answers, setAnswers] = useState<Record<string, { response?: HttpResponse; error?: string }>>({});
	const [shown, setShown] = useState<string | null>(null);

	const load = useCallback(() => {
		projectHttpFiles(path, project).then(setFiles).catch(() => setFiles([]));
	}, [path, project]);
	useEffect(load, [load]);

	const envs = [...new Set((files ?? []).flatMap((f) => f.envs))];
	useEffect(() => {
		if (envs.length > 0 && !envs.includes(env)) setEnv(envs[0]);
		// eslint-disable-next-line react-hooks/exhaustive-deps -- envs are read from files
	}, [files]);

	const send = (file: string, index: number) => {
		const key = `${file}#${index}`;
		setBusy(key);
		setShown(key);
		projectHttpSend(path, project, file, index, env)
			.then((response) => setAnswers((a) => ({ ...a, [key]: { response } })))
			.catch((e) => setAnswers((a) => ({ ...a, [key]: { error: errorText(e, "The request did not go out.") } })))
			.finally(() => setBusy(null));
	};

	if (!files) return null;
	if (files.length === 0)
		return <p className="text-sm text-muted-foreground">No request files. Add a file ending in .http (or .rest) to the project: a line such as <code className="font-mono">GET http://localhost:3000/health</code>, and requests separated by lines starting with ###. It works with the JetBrains HTTP Client and the VS Code REST Client.</p>;

	return (
		<div className="space-y-4">
			<div className="flex flex-wrap items-center gap-3 text-sm">
				{envs.length > 0 && (
					<label className="flex items-center gap-2">
						<span className="text-muted-foreground">Environment</span>
						<select value={env} onChange={(e) => setEnv(e.target.value)} className="h-8 cursor-pointer border bg-input px-2 text-sm">
							{envs.map((e) => (
								<option key={e}>{e}</option>
							))}
						</select>
					</label>
				)}
				<span className="flex-1" />
				<Button variant="ghost" size="icon-sm" aria-label="Look again" onPress={load}>
					<RefreshCw className="size-4" />
				</Button>
			</div>
			{files.map((f) => (
				<Panel
					key={f.path}
					title={f.path}
					hint={String(f.requests.length)}
					flush
					right={
						<Button variant="ghost" size="icon-xs" aria-label={`Open ${f.path}`} onPress={() => onOpenFile(f.path)}>
							<ExternalLink className="size-3.5" />
						</Button>
					}
				>
					<ul className="divide-y">
						{f.requests.map((r, i) => {
							const key = `${f.path}#${i}`;
							const a = answers[key];
							return (
								<li key={key} className="px-4 py-3">
									<div className="flex items-center gap-3">
										<span className="w-16 shrink-0 font-mono text-[13px] text-muted-foreground">{r.method}</span>
										<span className="min-w-0 flex-1">
											<span className="block truncate text-sm font-medium">{r.name}</span>
											<span className="block truncate font-mono text-[13px] text-muted-foreground">{r.url}</span>
										</span>
										<Button variant="outline" size="xs" isDisabled={busy === key} onPress={() => send(f.path, i)}>
											<Play className="size-3" />
											Send
										</Button>
									</div>
									{shown === key && busy === key && <p className="mt-2 text-[13px] text-muted-foreground">Waiting for the answer...</p>}
									{shown === key && a?.error && (
										<p role="alert" className="mt-2 bg-destructive/10 p-2 text-[13px] text-destructive">
											{a.error}
										</p>
									)}
									{a?.response && (
										<div className="mt-2 space-y-1">
											<p className="font-mono text-[13px]">
												<span className={cn("font-medium", tone(a.response.status))}>{a.response.status}</span> <span className="text-muted-foreground">{a.response.ms} ms · {a.response.headers.find(([k]) => k.toLowerCase() === "content-type")?.[1] ?? ""}</span>
											</p>
											<pre className="max-h-72 overflow-auto bg-muted/40 p-2 font-mono text-[13px] whitespace-pre-wrap break-all">{pretty(a.response.body) || "(no body)"}</pre>
											{a.response.truncated && <p className="text-[13px] text-muted-foreground">The body is cut at 1 MB.</p>}
										</div>
									)}
								</li>
							);
						})}
					</ul>
				</Panel>
			))}
		</div>
	);
}
