// The dialog that asks before something is deleted or removed: a red heading, what will happen, anything extra the caller puts in
// (an option to erase for good, say), then Cancel and the one destructive button.

import type { ComponentProps, ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter, DialogHeading } from "@/components/ui/dialog";

type DialogProps = Omit<ComponentProps<typeof Dialog>, "children" | "className">;

export function ConfirmDialog({ icon, title, description, confirmLabel, onConfirm, onCancel, isDisabled, isBusy, tone = "danger", className, children, ...dialog }: DialogProps & {
	icon: ReactNode;
	title: string;
	description?: ReactNode;
	confirmLabel: ReactNode;
	onConfirm: () => void;
	onCancel: () => void;
	isDisabled?: boolean;
	// Work is going on: Cancel waits too
	isBusy?: boolean;
	tone?: "danger" | "warning";
	className?: string;
	children?: ReactNode;
}) {
	return (
		<Dialog className={className} {...dialog}>
			<div className="space-y-4">
				<DialogHeading icon={icon} tone={tone} title={title} description={description} />
				{children}
				<DialogFooter>
					<Button variant="outline" onPress={onCancel} isDisabled={isBusy}>
						Cancel
					</Button>
					<Button variant="destructive" onPress={onConfirm} isDisabled={isDisabled}>
						{confirmLabel}
					</Button>
				</DialogFooter>
			</div>
		</Dialog>
	);
}
