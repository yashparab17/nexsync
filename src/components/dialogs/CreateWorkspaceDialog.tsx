import { ReactNode } from "react";

import {
	Dialog,
	DialogTrigger,
	DialogHeader,
	DialogTitle,
	DialogDescription,
	DialogFooter,
} from "@/components/ui/dialog";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import { FolderOpen, FolderPlus } from "lucide-react";

interface CreateWorkspaceDialogProps {
	children: ReactNode;
}

export default function CreateWorkspaceDialog({
	children,
}: CreateWorkspaceDialogProps) {
	return (
		<DialogTrigger>
			{children}

			<Dialog className="sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle>Create Workspace</DialogTitle>

					<DialogDescription>
						Create a new local-first workspace for your projects.
					</DialogDescription>
				</DialogHeader>

				<div className="grid gap-8 py-4 md:grid-cols-[2fr_1fr]">
					{/* LEFT COLUMN */}
					<div className="space-y-6">
						<div className="space-y-2">
							<Label htmlFor="workspace-name">
								Workspace Name
							</Label>

							<Input
								id="workspace-name"
								placeholder="e.g. MSc Research"
							/>
						</div>

						<div className="space-y-2">
							<Label htmlFor="description">Description</Label>

							<Textarea
								id="description"
								placeholder="Optional description..."
							/>
						</div>

						<div className="space-y-2">
							<Label>Storage Location</Label>

							<div className="flex gap-2">
								<Input
									readOnly
									value="C:\Users\User\Documents\Nexsync"
								/>

								<Button variant="outline">
									<FolderOpen className="size-4" />
								</Button>
							</div>
						</div>
					</div>

					{/* RIGHT COLUMN */}
					<div className="rounded-lg border bg-muted/40 p-4">
						<h3 className="mb-4 font-semibold">
							Workspace Preview
						</h3>

						<div className="flex flex-col items-center gap-4">
							<div className="flex h-20 w-20 items-center justify-center rounded-xl bg-primary text-5xl">
								📁
							</div>

							<div className="text-center">
								<p className="font-medium">MSc Research</p>

								<p className="text-sm text-muted-foreground">
									Local Workspace
								</p>
							</div>
						</div>
					</div>
				</div>

				<DialogFooter>
					<Button variant="outline" slot="close">
						Cancel
					</Button>

					<Button>
						<FolderPlus className="mr-2 size-4" />
						Create Workspace
					</Button>
				</DialogFooter>
			</Dialog>
		</DialogTrigger>
	);
}
