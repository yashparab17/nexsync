"use client";

import * as React from "react";
import {
	Dialog as DialogPrimitive,
	DialogTrigger as DialogTriggerPrimitive,
	Heading,
	ModalOverlay as ModalOverlayPrimitive,
	Modal as ModalPrimitive,
	type DialogProps as DialogPrimitiveProps,
	type DialogTriggerProps as DialogTriggerPrimitiveProps,
	type ModalOverlayProps as ModalOverlayPrimitiveProps,
} from "react-aria-components";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { X as XIcon } from "@/components/animate-icons";

// Trigger element that opens the dialog modal
function DialogTrigger({ ...props }: DialogTriggerPrimitiveProps) {
	return <DialogTriggerPrimitive data-slot="dialog-trigger" {...props} />;
}

// Close button for dialog
function DialogClose({
	className,
	variant = "outline",
	size = "default",
	...props
}: React.ComponentProps<typeof Button>) {
	return (
		<Button
			slot="close"
			data-slot="dialog-close"
			variant={variant}
			size={size}
			className={cn(className)}
			{...props}
		/>
	);
}

// Backdrop overlay behind modal
function DialogOverlay({
	className,
	children,
	...props
}: Omit<ModalOverlayPrimitiveProps, "className" | "children"> & {
	className?: string;
	children: React.ReactNode;
}) {
	return (
		<ModalOverlayPrimitive
			data-slot="dialog-overlay"
			className={cn(
				"fixed inset-0 isolate z-50 bg-scrim duration-100 data-entering:animate-in data-entering:fade-in-0 data-exiting:animate-out data-exiting:fade-out-0 supports-backdrop-filter:backdrop-blur-sm",
				className,
			)}
			{...props}
		>
			{children}
		</ModalOverlayPrimitive>
	);
}

// Modal dialog container component
function Dialog({
	className,
	children,
	showCloseButton = true,
	isDismissable = true,
	...props
}: Omit<ModalOverlayPrimitiveProps, "className" | "children"> &
	Pick<React.ComponentProps<typeof ModalPrimitive>, "isDismissable"> & {
		className?: string;
		children: React.ReactNode;
		showCloseButton?: boolean;
	}) {
	return (
		<DialogOverlay isDismissable={isDismissable} {...props}>
			<ModalPrimitive
				data-slot="dialog-content"
				className={cn(
					"fixed top-1/2 left-1/2 z-50 grid max-h-[calc(100dvh-2rem)] w-full overflow-x-hidden overflow-y-auto overscroll-contain [overflow-wrap:anywhere] max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-6 rounded-none bg-popover p-6 text-sm text-popover-foreground border shadow-lg duration-100 outline-none data-entering:animate-in data-entering:fade-in-0 data-entering:zoom-in-95 data-exiting:animate-out data-exiting:fade-out-0 data-exiting:zoom-out-95 sm:max-w-md",
					className,
				)}
			>
				<DialogPrimitive
					data-slot="dialog"
					className="[display:inherit] min-w-0 gap-[inherit] outline-none [&>*]:min-w-0"
				>
					{children}
					{showCloseButton && (
						<DialogClose
							variant="ghost"
							className="absolute top-5 right-5 bg-secondary"
							size="icon-sm"
						>
							<XIcon />
							<span className="sr-only">Close</span>
						</DialogClose>
					)}
				</DialogPrimitive>
			</ModalPrimitive>
		</DialogOverlay>
	);
}

// Dialog header container
function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="dialog-header"
			className={cn("flex flex-col gap-2 pr-10", className)}
			{...props}
		/>
	);
}

// Dialog footer container with action buttons
function DialogFooter({
	className,
	showCloseButton = false,
	children,
	...props
}: React.ComponentProps<"div"> & {
	showCloseButton?: boolean;
}) {
	return (
		<div
			data-slot="dialog-footer"
			className={cn(
				"flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
				className,
			)}
			{...props}
		>
			{children}
			{showCloseButton && (
				<DialogClose variant="outline">Close</DialogClose>
			)}
		</div>
	);
}

// Dialog title heading
function DialogTitle({
	className,
	...props
}: Omit<React.ComponentProps<typeof Heading>, "slot">) {
	return (
		<Heading
			slot="title"
			data-slot="dialog-title"
			className={cn(
				"font-heading text-xl leading-none font-semibold",
				className,
			)}
			{...props}
		/>
	);
}

// Dialog descriptive text
function DialogDescription({
	className,
	...props
}: Omit<React.ComponentProps<"div">, "slot">) {
	return (
		<div
			data-slot="dialog-description"
			className={cn(
				"mt-0.5 text-sm leading-relaxed text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
				className,
			)}
			{...props}
		/>
	);
}

// The top of a dialog: an icon tile, the title and one line saying what the dialog does. `danger` marks deleting and
// removing, `warning` marks losing work or running something.
function DialogHeading({ icon, title, description, tone = "default" }: { icon: React.ReactNode; title: string; description: React.ReactNode; tone?: "default" | "warning" | "danger" }) {
	return (
		<DialogHeader>
			<div className="flex items-start gap-4">
				<span
					className={cn(
						"flex size-11 shrink-0 items-center justify-center",
						tone === "danger" ? "bg-destructive/10 text-destructive" : tone === "warning" ? "bg-warning/10 text-warning" : "bg-primary/10 text-primary",
					)}
				>
					{icon}
				</span>
				<div className="min-w-0">
					<DialogTitle>{title}</DialogTitle>
					<DialogDescription className="mt-1.5">{description}</DialogDescription>
				</div>
			</div>
		</DialogHeader>
	);
}

export {
	DialogHeading,
	type DialogPrimitiveProps,
	type DialogTriggerPrimitiveProps,
	Dialog,
	DialogClose,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogOverlay,
	DialogTitle,
	DialogTrigger,
};
