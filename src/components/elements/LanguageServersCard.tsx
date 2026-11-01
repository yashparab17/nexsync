// Settings: the language servers on this device. A language server gives the editor problems, hover, completion and go to definition for
// a language. They belong to the device, so they are here and not in a workspace's settings. Each can be installed with one press; the
// command it runs is shown first, and is fixed in the app: the page names a server, never a command.

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { Check, Code2, Download } from "@/components/animate-icons";
import { SectionCard } from "@/components/elements/SettingsParts";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/notice";
import type { LspServerInfo } from "@/features/projects/types";
import { lspInstall, lspServers } from "@/lib/tauri";
import { errorText } from "@/lib/utils";


function Row({ server, busy, onInstall }: { server: LspServerInfo; busy: boolean; onInstall: () => void }) {
	return (
		<li className="flex flex-wrap items-center justify-between gap-3 py-2">
			<div className="min-w-0">
				<p className="flex items-center gap-2 text-sm font-semibold">
					{server.label}
					{server.installed && <Check className="size-4 text-success" aria-label="Installed" />}
				</p>
				<p className="truncate font-mono text-xs text-muted-foreground" title={server.installed ? (server.path ?? "") : server.install}>
					{server.installed ? (server.path ?? "Installed") : server.install}
				</p>
				<p className="text-xs text-muted-foreground">{server.extensions.map((e) => `.${e}`).join(" ")}</p>
			</div>
			{!server.installed &&
				(server.installer ? (
					<Button size="sm" variant="outline" isDisabled={busy || !server.canInstall} onPress={onInstall} aria-label={`Install ${server.label} language server`}>
						{busy ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
						{busy ? "Installing…" : server.canInstall ? "Install" : `Needs ${server.installer}`}
					</Button>
				) : (
					<Button size="sm" variant="outline" onPress={() => window.open(server.install, "_blank", "noreferrer")}>
						How to Install
					</Button>
				))}
		</li>
	);
}

export default function LanguageServersCard() {
	const [servers, setServers] = useState<LspServerInfo[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [installing, setInstalling] = useState<string | null>(null);
	const [done, setDone] = useState<string | null>(null);
	const [all, setAll] = useState(false);

	const load = useCallback(() => {
		lspServers()
			.then(setServers)
			.catch((err) => setError(errorText(err, "Could not look for language servers.")));
	}, []);
	useEffect(load, [load]);

	const install = async (server: LspServerInfo) => {
		setInstalling(server.id);
		setError(null);
		setDone(null);
		try {
			await lspInstall(server.id);
			setDone(`${server.label} is installed. Reopen a file of that language to use it.`);
			load();
		} catch (err) {
			setError(errorText(err, `Could not install ${server.label}.`));
		} finally {
			setInstalling(null);
		}
	};

	const missingRecommended = (servers ?? []).filter((s) => s.recommended && !s.installed && s.installer && s.canInstall);
	const installAll = async () => {
		for (const s of missingRecommended) await install(s);
	};
	const shown = (servers ?? []).filter((s) => all || s.installed || s.recommended);
	const installed = (servers ?? []).filter((s) => s.installed).length;

	return (
		<SectionCard id="language-servers" title="Language Servers" icon={<Code2 className="size-5" />}>
			<p className="text-xs text-muted-foreground">
				A language server gives the editor problems, hover, completion and go to definition for a language. They run on this device, and each file type asks once before one starts.
				{servers && ` ${installed} of ${servers.length} are installed.`}
			</p>
			{error && <FieldError>{error}</FieldError>}
			{done && (
				<p role="status" className="text-xs text-success">
					{done}
				</p>
			)}
			{servers === null && !error ? (
				<Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Looking for language servers" />
			) : (
				<>
					<div className="flex flex-wrap items-center gap-2">
						<Button size="sm" isDisabled={installing !== null || missingRecommended.length === 0} onPress={() => void installAll()}>
							<Download className="size-3.5" />
							{missingRecommended.length === 0 ? "Recommended Servers Installed" : `Install ${missingRecommended.length} Recommended`}
						</Button>
						<Button size="sm" variant="outline" isDisabled={installing !== null} onPress={load}>
							Check Again
						</Button>
						<Button size="sm" variant="ghost" onPress={() => setAll((v) => !v)} aria-pressed={all}>
							{all ? "Show Fewer" : "Show All Languages"}
						</Button>
					</div>
					<ul className="divide-y" aria-label="Language servers">
						{shown.map((s) => (
							<Row key={s.id} server={s} busy={installing === s.id} onInstall={() => void install(s)} />
						))}
					</ul>
				</>
			)}
		</SectionCard>
	);
}
