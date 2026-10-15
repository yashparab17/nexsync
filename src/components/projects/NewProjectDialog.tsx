import { useState } from "react";

import { FolderPlus } from "@/components/animate-icons";
import { Button } from "@/components/ui/button";
import { Dialog, DialogHeading } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { errorText } from "@/lib/utils";

// Names an empty project folder. Files are added in the Editor or Files, or by copying a folder in.
export default function NewProjectDialog({ existing, onClose, onCreate }: { existing: string[]; onClose: () => void; onCreate: (name: string) => Promise<void> }) {
	const [name, setName] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const clean = name.trim();

	const submit = async () => {
		if (!clean) return setError("Give the project a name.");
		if (existing.some((e) => e.toLowerCase() === clean.toLowerCase())) return setError("A project with that name exists.");
		setBusy(true);
		try {
			await onCreate(clean);
			onClose();
		} catch (err) {
			setError(errorText(err, "Could not create the project."));
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
				<DialogHeading icon={<FolderPlus className="size-6" />} title="New Project" description="An empty folder in the workspace's projects folder. Nexsync works out what kind of project it is as you add files." />
				<div className="space-y-1">
					<Label htmlFor="project-name">Name</Label>
					<Input id="project-name" autoFocus value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="web-app" />
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
					<Button type="submit" isDisabled={!clean || busy}>
						Create Project
					</Button>
				</div>
			</form>
		</Dialog>
	);
}
