// Settings: rules about whole tasks and cards. Merging keeps everyone's edits, so two correct edits made at the same time
// can add up to a record that breaks a rule; with a rule on, such a record is flagged until somebody fixes it.

import { useEffect, useState } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { errorText } from "@/lib/utils";
import { getRules, setRule } from "@/lib/tauri";
import { useP2P } from "@/store/p2p/P2PContext";
import type { RuleInfo } from "@/types/workspace";

export default function RulesCard({ workspacePath }: { workspacePath: string }) {
	const { refreshData } = useP2P();
	const [rules, setRules] = useState<RuleInfo[]>([]);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		getRules(workspacePath)
			.then(setRules)
			.catch((err) => setError(errorText(err, "Could not load the rules.")));
	}, [workspacePath]);

	const toggle = async (rule: RuleInfo, enabled: boolean) => {
		setError(null);
		try {
			await setRule(workspacePath, rule.id, enabled);
			setRules((prev) => prev.map((r) => (r.id === rule.id ? { ...r, enabled } : r)));
			// Pages show the flags, so they load again
			refreshData();
		} catch (err) {
			setError(errorText(err, "Could not change the rule."));
		}
	};

	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-base">Rules for tasks and cards</CardTitle>
				<CardDescription>
					Two people can each make a correct edit at the same time and still leave a task that breaks a rule, such as a finished task with nobody assigned. With a rule on, that task is flagged until
					someone fixes it. These choices are kept on this device only.
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-3">
				{error && (
					<p role="alert" className="text-xs text-destructive">
						{error}
					</p>
				)}
				{rules.map((rule) => (
					<label key={rule.id} className="flex cursor-pointer items-start gap-3 text-sm">
						<input type="checkbox" checked={rule.enabled} onChange={(e) => void toggle(rule, e.target.checked)} className="mt-1 size-4 accent-primary" />
						<span>
							{rule.text}
							<span className="block text-xs text-muted-foreground">Applies to {rule.applies_to}</span>
						</span>
					</label>
				))}
			</CardContent>
		</Card>
	);
}
