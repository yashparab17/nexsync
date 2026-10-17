import { useState } from "react";

import { AlertTriangle, Check, RefreshCw } from "@/components/animate-icons";
import { Panel } from "@/components/layout/Page";
import { Button } from "@/components/ui/button";
import { projectAudit } from "@/lib/tauri";
import { cn, errorText } from "@/lib/utils";
import type { Audit } from "@/features/projects/types";

const TONE: Record<string, string> = { critical: "bg-destructive text-destructive-foreground", high: "bg-destructive/15 text-destructive", moderate: "bg-warning/15 text-warning", low: "bg-muted text-muted-foreground", unknown: "bg-muted text-muted-foreground" };

// Dependency health: known-vulnerable and out-of-date packages. It contacts the package registries, so it runs when asked.
export default function AuditPanel({ path, project }: { path: string; project: string }) {
	const [audits, setAudits] = useState<Audit[] | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const look = () => {
		setBusy(true);
		setError(null);
		projectAudit(path, project)
			.then(setAudits)
			.catch((e) => setError(errorText(e, "The check did not run.")))
			.finally(() => setBusy(false));
	};

	const total = audits?.reduce((n, a) => n + a.findings.length, 0) ?? 0;
	const old = audits?.reduce((n, a) => n + a.outdated.length, 0) ?? 0;

	return (
		<Panel
			title="Dependency Health"
			hint={audits ? `${total} vulnerable, ${old} out of date` : undefined}
			className="@4xl:col-span-2"
			flush={!!audits && audits.length > 0}
			right={
				<Button variant="outline" size="xs" isDisabled={busy} onPress={look}>
					<RefreshCw className={cn("size-3", busy && "animate-spin")} />
					{audits ? "Check Again" : "Check"}
				</Button>
			}
		>
			{error ? (
				<p role="alert" className="text-sm text-destructive">
					{error}
				</p>
			) : !audits ? (
				<p className="text-sm text-muted-foreground">{busy ? "Asking the package registries..." : "Looks for packages with known security problems and packages with newer versions. This contacts the package registries, so it runs only when you ask."}</p>
			) : audits.length === 0 ? (
				<p className="text-sm text-muted-foreground">Nothing to check: no npm, Cargo or Python lock file in this project.</p>
			) : (
				<div className="divide-y">
					{audits.map((a) => (
						<section key={a.ecosystem}>
							<h3 className="flex items-center gap-2 px-4 pt-3 pb-1 font-mono text-[13px] text-muted-foreground">
								{a.ecosystem}
								{a.notes.length === 0 && a.findings.length === 0 && <Check className="size-3.5 text-success" />}
							</h3>
							{a.notes.map((n) => (
								<p key={n} className="flex items-start gap-2 px-4 py-1 text-[13px] text-muted-foreground">
									<AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" />
									{n}
								</p>
							))}
							{a.notes.length === 0 && a.findings.length === 0 && <p className="px-4 py-2 text-sm text-muted-foreground">No known vulnerabilities.</p>}
							<ul>
								{a.findings.map((f) => (
									<li key={`${f.package}${f.id}`} className="flex items-center gap-3 px-4 py-2">
										<span className={cn("w-20 shrink-0 px-2 py-0.5 text-center font-mono text-[13px]", TONE[f.severity])}>{f.severity}</span>
										<span className="min-w-0 flex-1">
											<span className="block truncate font-mono text-sm">
												{f.package} <span className="text-muted-foreground">{f.version}</span>
											</span>
											<span className="block truncate text-[13px] text-muted-foreground">{[f.id, f.title].filter(Boolean).join(" · ")}</span>
										</span>
										{f.fix && <span className="max-w-48 shrink-0 truncate font-mono text-[13px] text-muted-foreground">fix: {f.fix}</span>}
									</li>
								))}
							</ul>
							{a.outdated.length > 0 && (
								<ul>
									{a.outdated.map((o) => (
										<li key={o.package} className="flex items-center gap-3 px-4 py-1.5 text-sm">
											<span className="min-w-0 flex-1 truncate font-mono">{o.package}</span>
											<span className="font-mono text-[13px] text-muted-foreground">
												{o.current} → {o.latest}
											</span>
										</li>
									))}
								</ul>
							)}
						</section>
					))}
				</div>
			)}
		</Panel>
	);
}
