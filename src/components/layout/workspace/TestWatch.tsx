// When this device's own test run fails, and the person has chosen to (Projects, Tests), says so in the General channel: who ran
// what, how many failed and the first few names. Only this device's results are ever posted, and only once per run.

import { useEffect } from "react";

import { readToChat } from "@/components/projects/TestsPanel";
import { useRuns } from "@/lib/projectRuns";
import { parseTests } from "@/lib/testResults";
import { useChat } from "@/store/chat/ChatContext";

const told = new Set<string>();

export default function TestWatch() {
	const runs = useRuns();
	const chat = useChat();

	useEffect(() => {
		for (const run of runs) {
			if (run.status !== "done" || told.has(run.runId) || !/test/i.test(run.task)) continue;
			told.add(run.runId);
			if (!readToChat() || run.stopped) continue;
			const report = parseTests(run.lines.map((l) => l.text));
			if (!report || report.failed === 0) continue;
			const names = report.tests.filter((t) => t.status === "fail").slice(0, 3).map((t) => t.name);
			const more = report.failed > names.length ? ` and ${report.failed - names.length} more` : "";
			void chat.post({ kind: "message", channel: "general", body: `Tests failed in ${run.project} on my machine: ${report.failed} of ${report.tests.length}. ${names.join(", ")}${more}.` }).catch(() => {});
		}
	}, [runs, chat]);

	return null;
}
