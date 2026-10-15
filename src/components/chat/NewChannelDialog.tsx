import { useState } from "react";
import { Hash } from "@/components/animate-icons";
import { Button } from "@/components/ui/button";
import { Dialog, DialogHeading } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { slugify } from "@/lib/chat/entries";

// Names a new channel. Only the Owner and Admins see this; the backend refuses anyone else's channel entry too.
export default function NewChannelDialog({ existing, onClose, onCreate }: { existing: string[]; onClose: () => void; onCreate: (name: string, topic: string) => Promise<void> }) {
	const [name, setName] = useState("");
	const [topic, setTopic] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const id = slugify(name);

	const submit = async () => {
		if (!id) return setError("Give the channel a name.");
		if (existing.includes(id)) return setError("A channel with that name exists.");
		setBusy(true);
		try {
			await onCreate(name.trim(), topic.trim());
			onClose();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
			setBusy(false);
		}
	};

	return (
		<Dialog isOpen onOpenChange={(open) => !open && onClose()} className="sm:max-w-md">
			<form
				className="flex flex-col gap-4"
				onSubmit={(e) => {
					e.preventDefault();
					void submit();
				}}
			>
				<DialogHeading icon={<Hash className="size-6" />} title="New Channel" />
				<div className="space-y-1">
					<Label htmlFor="channel-name">Name</Label>
					<Input id="channel-name" autoFocus value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="release-plan" />
					{id && <p className="font-mono text-[13px] text-muted-foreground">#{id}</p>}
				</div>
				<div className="space-y-1">
					<Label htmlFor="channel-topic">Topic (optional)</Label>
					<Input id="channel-topic" value={topic} maxLength={120} onChange={(e) => setTopic(e.target.value)} placeholder="What this channel is for" />
				</div>
				{error && (
					<p role="alert" className="bg-destructive/10 p-2 text-sm text-destructive">
						{error}
					</p>
				)}
				<div className="flex justify-end gap-2">
					<Button variant="ghost" onPress={onClose}>
						Cancel
					</Button>
					<Button type="submit" isDisabled={!id || busy}>
						Create Channel
					</Button>
				</div>
			</form>
		</Dialog>
	);
}
