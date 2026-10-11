import { useCallback, useEffect, useState } from "react";
import { Check, Copy, RefreshCw, Trash2 } from "lucide-react";
import { APP_VERSION } from "@/lib/version";

import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";

import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import { clearErrorLog, getErrorLog } from "@/lib/tauri";
import type { ErrorRecord } from "@/types/workspace";

// Settings card that lists recent app errors with copy and clear actions
export default function ErrorLogCard() {
	const [records, setRecords] = useState<ErrorRecord[]>([]);
	const [loadError, setLoadError] = useState<string | null>(null);
	const { copiedKey, copy } = useCopyToClipboard();

	const refresh = useCallback(async () => {
		try {
			setRecords(await getErrorLog());
			setLoadError(null);
		} catch (err) {
			setLoadError(String(err));
		}
	}, []);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	const handleClear = async () => {
		await clearErrorLog();
		await refresh();
	};

	// What to attach to a bug report: the app and system, then the log. It is copied, never sent.
	const copyDiagnostics = () => {
		copy(`Nexsync ${APP_VERSION}
${navigator.userAgent}
${new Date().toISOString()}

${asText() || "No errors recorded."}`, "diagnostics");
	};

	const asText = () =>
		records
			.map((r) => `${r.timestamp} [${r.source}] ${r.message}${r.detail ? `\n${r.detail}` : ""}`)
			.join("\n\n");

	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-base">Error Log</CardTitle>
				<CardDescription>
					Recent errors recorded on this device. Nothing is sent anywhere; copy it when reporting a bug.
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-3">
				<div className="flex flex-wrap gap-2">
					<Button variant="outline" size="sm" onPress={refresh} className="gap-1.5">
						<RefreshCw className="size-3.5" />
						Refresh
					</Button>
					<Button
						variant="outline"
						size="sm"
						onPress={() => copy(asText(), "log")}
						isDisabled={records.length === 0}
						className="gap-1.5"
					>
						{copiedKey === "log" ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
						{copiedKey === "log" ? "Copied" : "Copy All"}
					</Button>
					<Button variant="outline" size="sm" onPress={copyDiagnostics} className="gap-1.5">
						{copiedKey === "diagnostics" ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
						{copiedKey === "diagnostics" ? "Copied" : "Copy diagnostics"}
					</Button>
					<Button
						variant="outline"
						size="sm"
						onPress={handleClear}
						isDisabled={records.length === 0}
						className="gap-1.5"
					>
						<Trash2 className="size-3.5" />
						Clear
					</Button>
				</div>

				{loadError ? (
					<p className="text-xs text-destructive">{loadError}</p>
				) : records.length === 0 ? (
					<p className="text-xs text-muted-foreground">No errors recorded.</p>
				) : (
					<ul className="max-h-72 divide-y overflow-y-auto border text-xs">
						{records.map((r, i) => (
							<li key={`${r.timestamp}-${i}`} className="space-y-1 p-3">
								<div className="flex items-center justify-between gap-3 text-muted-foreground">
									<span className="font-semibold ">{r.source}</span>
									<span>{new Date(r.timestamp).toLocaleString()}</span>
								</div>
								<p className="break-words text-foreground">{r.message}</p>
								{r.detail && (
									<details>
										<summary className="cursor-pointer text-muted-foreground">Details</summary>
										<pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap font-mono text-xs text-muted-foreground">
											{r.detail}
										</pre>
									</details>
								)}
							</li>
						))}
					</ul>
				)}
			</CardContent>
		</Card>
	);
}
