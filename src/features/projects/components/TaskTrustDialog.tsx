import { ShieldCheck } from "@/components/animate-icons";
import { Button } from "@/components/ui/button";
import { Dialog, DialogHeading } from "@/components/ui/dialog";
import type { Trust } from "@/features/projects/types";

// What a task would run, asked before it does. The command comes from a recipe the whole team can change, so this device's owner
// says yes: once, or always for exactly this command (any change asks again).
export default function TaskTrustDialog({ taskLabel, trust, onChoose }: { taskLabel: string; trust: Trust; onChoose: (choice: "once" | "always" | null) => void }) {
	return (
		<Dialog isOpen onOpenChange={(open) => !open && onChoose(null)} className="sm:max-w-lg">
			<div className="flex flex-col gap-4">
				<DialogHeading
					icon={<ShieldCheck className="size-6" />}
					tone="warning"
					title={trust.changedFrom ? `Run ${taskLabel}? It Changed` : `Run ${taskLabel}?`}
					description={trust.changedFrom ? "The command is not the one you approved before. Someone changed the recipe." : "This command comes from the project's recipe, which anyone who can edit the project can change. It runs on this device, as you."}
				/>
				<dl className="space-y-2 font-mono text-[13px]">
					{trust.changedFrom && (
						<div>
							<dt className="text-muted-foreground">Before</dt>
							<dd className="bg-destructive/10 p-2 break-all whitespace-pre-wrap">{trust.changedFrom}</dd>
						</div>
					)}
					<div>
						<dt className="text-muted-foreground">{trust.changedFrom ? "Now" : "Command"}</dt>
						<dd className="bg-muted p-2 break-all whitespace-pre-wrap">{trust.command}</dd>
					</div>
					<div>
						<dt className="text-muted-foreground">Starts in</dt>
						<dd>{trust.cwd || "the project folder"}</dd>
					</div>
					{trust.env.length > 0 && (
						<div>
							<dt className="text-muted-foreground">Uses the variables</dt>
							<dd>{trust.env.join(", ")}</dd>
						</div>
					)}
				</dl>
				<div className="flex flex-wrap justify-end gap-2">
					<Button variant="ghost" onPress={() => onChoose(null)}>
						Cancel
					</Button>
					<Button variant="outline" onPress={() => onChoose("once")}>
						Run Once
					</Button>
					<Button onPress={() => onChoose("always")}>Always for This Command</Button>
				</div>
			</div>
		</Dialog>
	);
}
