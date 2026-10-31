// A form field: its label above, the control, then a hint or the problem under it. The spacing is decided here, so dialogs line up.

import type { ReactNode } from "react";

import { FieldError } from "@/components/ui/notice";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export function Field({ label, htmlFor, hint, error, className, children }: { label: ReactNode; htmlFor?: string; hint?: ReactNode; error?: ReactNode; className?: string; children: ReactNode }) {
	return (
		<div className={cn("flex flex-col gap-1", className)}>
			<Label htmlFor={htmlFor}>{label}</Label>
			{children}
			{error ? <FieldError>{error}</FieldError> : hint ? <p className="text-[13px] text-muted-foreground">{hint}</p> : null}
		</div>
	);
}
