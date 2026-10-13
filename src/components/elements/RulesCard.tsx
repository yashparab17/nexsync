// Settings: rules about whole tasks and cards. Merging keeps everyone's edits, so two correct edits made at the same time
// can add up to a record that breaks a rule; with a rule on, such a record is flagged until somebody fixes it.

import { useEffect, useState } from "react";

import { ShieldCheck } from "@/components/animate-icons";
import { SectionCard } from "@/components/elements/SettingsParts";
import { errorText } from "@/lib/utils";
import { getRules, setRule } from "@/lib/tauri";
import { useP2P } from "@/store/p2p/P2PContext";
import type { RuleInfo } from "@/types/workspace";

export default function RulesCard({ workspacePath }: { workspacePath: string }) {
	const { refreshData, shareRules, selfName, dataVersion } = useP2P();
	const [rules, setRules] = useState<RuleInfo[]>([]);
	const [error, setError] = useState<string | null>(null);
	// Somebody who joined a workspace uses the rules its host chose; the host's choice reaches them when it changes
	const guest = selfName !== null;

	useEffect(() => {
		getRules(workspacePath)
			.then(setRules)
			.catch((err) => setError(errorText(err, "Could not load the rules.")));
	}, [workspacePath, dataVersion]);

	const toggle = async (rule: RuleInfo, enabled: boolean) => {
		setError(null);
		try {
			await setRule(workspacePath, rule.id, enabled);
			setRules((prev) => prev.map((r) => (r.id === rule.id ? { ...r, enabled } : r)));
			// Everyone in the workspace uses the host's rules, so a change is sent on
			shareRules();
			// Pages show the flags, so they load again
			refreshData();
		} catch (err) {
			setError(errorText(err, "Could not change the rule."));
		}
	};

	return (
		<SectionCard id="rules" title="Rules for Tasks and Cards" icon={<ShieldCheck className="size-5" />}>
				{error && (
					<p role="alert" className="text-xs text-destructive">
						{error}
					</p>
				)}
				{rules.map((rule) => (
					<label key={rule.id} className="flex cursor-pointer items-start gap-3 text-sm">
						<input type="checkbox" checked={rule.enabled} disabled={guest} onChange={(e) => void toggle(rule, e.target.checked)} />
						<span>
							{rule.text}
							<span className="block text-xs text-muted-foreground">Applies to {rule.applies_to}</span>
						</span>
					</label>
				))}
			</SectionCard>
	);
}
