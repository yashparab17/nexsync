// Makes an element accept files dragged in from the desktop. Drags of things inside the app (tabs, cards) are ignored.

import { useRef, useState, type DragEvent } from "react";
import { UploadCloud } from "@/components/animate-icons";

import { carriesFiles, readDrop, type DroppedFile } from "@/lib/dropImport";
import { cn } from "@/lib/utils";

export function useFileDrop(onFiles: (items: DroppedFile[], target: EventTarget) => void, disabled = false) {
	const [dragging, setDragging] = useState(false);
	// dragenter and dragleave fire for every child entered, so entering and leaving are counted
	const depth = useRef(0);
	const active = (e: DragEvent) => !disabled && carriesFiles(e.dataTransfer);
	const bind = {
		onDragEnter: (e: DragEvent) => {
			if (!active(e)) return;
			depth.current++;
			setDragging(true);
		},
		onDragOver: (e: DragEvent) => {
			if (!active(e)) return;
			e.preventDefault();
			e.dataTransfer.dropEffect = "copy";
		},
		onDragLeave: (e: DragEvent) => {
			if (!active(e)) return;
			depth.current = Math.max(0, depth.current - 1);
			if (depth.current === 0) setDragging(false);
		},
		onDrop: (e: DragEvent) => {
			if (!active(e)) return;
			e.preventDefault();
			depth.current = 0;
			setDragging(false);
			const target = e.target;
			void readDrop(e.dataTransfer).then((items) => items.length > 0 && onFiles(items, target));
		},
	};
	return { dragging, bind };
}

// Shown over the drop target while files are held above it
export function DropOverlay({ show, title, hint, className }: { show: boolean; title: string; hint?: string; className?: string }) {
	if (!show) return null;
	return (
		<div className={cn("pointer-events-none absolute inset-0 z-50 flex flex-col items-center justify-center gap-1 border-2 border-dashed border-primary bg-background/85 text-center backdrop-blur-sm animate-in fade-in duration-150 motion-reduce:animate-none", className)}>
			<UploadCloud className="mb-2 size-10 text-primary" />
			<p className="px-4 text-base font-semibold">{title}</p>
			{hint && <p className="px-4 text-sm text-muted-foreground">{hint}</p>}
		</div>
	);
}

// A short message over the bottom of the page, such as how many files a drop added; clears itself
export function useDropNotice() {
	const [text, setText] = useState<string | null>(null);
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const show = (message: string) => {
		setText(message);
		clearTimeout(timer.current);
		timer.current = setTimeout(() => setText(null), 5000);
	};
	const node = text && (
		<p role="status" className="pointer-events-none absolute inset-x-3 bottom-3 z-40 mx-auto w-fit max-w-full truncate border bg-popover px-3 py-2 text-sm shadow-md">
			{text}
		</p>
	);
	return { show, node };
}
