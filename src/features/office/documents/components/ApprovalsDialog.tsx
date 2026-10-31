import { ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter, DialogHeading } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Caption } from "@/components/layout/Pane";
import { approvalBody, approvalChannel, approvalsOf, hashOf, statusOf, type ApprovalKind } from "@/features/office/documents/lib/documentApprovals";
import { useChat } from "@/store/chat/ChatContext";

// Review requests, approvals and signatures. Everything here is written to the signed log, so each is the word of the device that wrote it,
// and each says which text of the document it was about.
export default function ApprovalsDialog({ path, text, canAct, onClose }: { path: string; text: () => string; canAct: boolean; onClose: () => void }) {
	const chat = useChat();
	const [hash, setHash] = useState("");
	const [asked, setAsked] = useState<string[]>([]);
	const [note, setNote] = useState("");
	const [busy, setBusy] = useState(false);
	const [problem, setProblem] = useState<string | null>(null);
	useEffect(() => void hashOf(text()).then(setHash), [text]);
	const list = useMemo(() => approvalsOf(chat.entries, path, chat.people), [chat.entries, path, chat.people]);
	const status = useMemo(() => statusOf(list, hash), [list, hash]);
	const mine = chat.people.find((p) => p.deviceId === chat.me)?.name ?? "";
	const others = chat.people.filter((p) => p.deviceId !== chat.me);
	const iAmAsked = status.reviewers.some((r) => r.name.toLowerCase() === mine.toLowerCase());

	const send = async (kind: ApprovalKind, said: string, reviewers: string[] = []) => {
		setBusy(true);
		setProblem(null);
		try {
			const entry = await chat.post({ kind: "comment", channel: approvalChannel(path), body: approvalBody(kind, hash, said, chat.people, reviewers) });
			if (!entry) throw new Error("It could not be saved.");
			setNote("");
		} catch (e) {
			setProblem(e instanceof Error ? e.message : "It could not be saved.");
		} finally {
			setBusy(false);
		}
	};
	const when = (ts: number) => new Date(ts).toLocaleString();
	const label = { approved: "Approved", changes: "Asked for changes", waiting: "Waiting" } as const;

	return (
		<Dialog isOpen onOpenChange={(o) => !o && onClose()} className="max-w-lg">
			<div className="space-y-4 text-sm">
				<DialogHeading
					icon={<ShieldCheck className="size-6" />}
					title="Approvals & Signatures"
					description={hash ? <>This is about the text as it is now (<span className="font-mono">{hash.slice(0, 8)}</span>). A later change shows as "changed since".</> : undefined}
				/>

				{status.request ? (
					<section aria-label="Review" className="space-y-2">
						<p>
							<span className="font-semibold">{status.request.name}</span> asked for a review, {when(status.request.ts)}.
							{status.approved && <span className="ml-2 font-semibold text-success">Everyone approved.</span>}
						</p>
						<ul className="divide-y border">
							{status.reviewers.map((r) => (
								<li key={r.name} className="flex items-center gap-3 px-3 py-2">
									<span className="min-w-0 flex-1 truncate font-medium">{r.name}</span>
									<span className={r.state === "approved" && !r.stale ? "text-success" : r.state === "changes" ? "text-warning" : "text-muted-foreground"}>{label[r.state]}</span>
									{r.answer && <Caption>{r.stale ? "changed since" : when(r.answer.ts)}</Caption>}
								</li>
							))}
						</ul>
						{status.reviewers
							.filter((r) => r.answer?.text)
							.map((r) => (
								<p key={r.name} className="text-muted-foreground">
									{r.name}: {r.answer?.text}
								</p>
							))}
					</section>
				) : (
					<p className="text-muted-foreground">Nobody has been asked to review this document.</p>
				)}

				{canAct && (
					<section aria-label="Your answer" className="space-y-3">
						<Field label="Your note" htmlFor="approval-note">
							<Input id="approval-note" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="Say why (optional for approving)" />
						</Field>
						<div className="flex flex-wrap gap-2">
							<Button size="sm" isDisabled={busy || !hash} onPress={() => void send("approve", note)}>
								Approve
							</Button>
							<Button size="sm" variant="outline" isDisabled={busy || !hash || !note.trim()} onPress={() => void send("changes", note)}>
								Ask for Changes
							</Button>
							<Button size="sm" variant="outline" isDisabled={busy || !hash} onPress={() => void send("sign", note || "Signed")}>
								Sign
							</Button>
						</div>
						{iAmAsked && <Caption>You were asked to review this.</Caption>}
						<fieldset className="space-y-2">
							<legend className="font-medium">Ask someone to review</legend>
							{others.length === 0 ? (
								<p className="text-muted-foreground">There is nobody else in this workspace to ask yet.</p>
							) : (
								<div className="flex flex-wrap gap-x-4 gap-y-1">
									{others.map((p) => (
										<label key={p.name} className="flex items-center gap-2">
											<input type="checkbox" checked={asked.includes(p.name)} onChange={(e) => setAsked(e.target.checked ? [...asked, p.name] : asked.filter((n) => n !== p.name))} />
											{p.name}
										</label>
									))}
								</div>
							)}
							<Button size="sm" variant="outline" isDisabled={busy || !hash || asked.length === 0} onPress={() => void send("request", `Please review this document: ${asked.map((n) => `@${n}`).join(", ")}`, asked).then(() => setAsked([]))}>
								Request Review
							</Button>
						</fieldset>
					</section>
				)}

				{status.signatures.length > 0 && (
					<section aria-label="Signatures" className="space-y-1">
						<h3 className="font-medium">Signatures</h3>
						<ul className="divide-y border">
							{status.signatures.map(({ signature, stale }) => (
								<li key={signature.id} className="flex items-center gap-3 px-3 py-2">
									<span className="min-w-0 flex-1 truncate font-medium">{signature.name}</span>
									<Caption>{when(signature.ts)}</Caption>
									<span className={stale ? "text-warning" : "text-success"}>{stale ? "Document changed since" : "Document unchanged"}</span>
								</li>
							))}
						</ul>
					</section>
				)}
				{problem && <p role="alert" className="text-destructive">{problem}</p>}
				<DialogFooter>
					<Button variant="outline" onPress={onClose}>
						Close
					</Button>
				</DialogFooter>
			</div>
		</Dialog>
	);
}
