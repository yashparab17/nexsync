import { Field } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { useState } from "react";
import { Hash } from "@/components/animate-icons";
import { Button } from "@/components/ui/button";
import { Dialog, DialogHeading } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { slugify } from "@/features/chat/lib/entries";

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
				<Field label="Name" htmlFor="channel-name">
<Input id="channel-name" autoFocus value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="release-plan" />
					{id && <p className="font-mono text-[13px] text-muted-foreground">#{id}</p>}
</Field>
				<Field label="Topic (optional)" htmlFor="channel-topic">
<Input id="channel-topic" value={topic} maxLength={120} onChange={(e) => setTopic(e.target.value)} placeholder="Description" />
</Field>
				{error && (
					<Notice>
						{error}
					</Notice>
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
