// A workspace's icon wherever it is shown, and the picker that sets it. See src/lib/workspaceIcon.ts.

import { useEffect, useRef, useState } from "react";

import { initialOf } from "@/components/elements/Avatar";
import ColorSwatches from "@/components/elements/ColorSwatches";
import { Button } from "@/components/ui/button";
import { Upload } from "@/components/animate-icons";
import { NEUTRAL } from "@/lib/collabColor";
import { GLYPHS, getIcon, pictureToIcon, type WorkspaceIcon as Icon } from "@/lib/workspaceIcon";
import { cn } from "@/lib/utils";

// The icon of the workspace with this id; without one it is the first letter of the name on a colour, like an avatar
export function useWorkspaceIcon(id: string | undefined): Icon | null {
	const [icon, setIcon] = useState<Icon | null>(() => (id ? getIcon(id) : null));
	useEffect(() => {
		setIcon(id ? getIcon(id) : null);
		const changed = (e: Event) => id && (e as CustomEvent).detail === id && setIcon(getIcon(id));
		window.addEventListener("nexsync-icon", changed);
		return () => window.removeEventListener("nexsync-icon", changed);
	}, [id]);
	return icon;
}

export function IconView({ icon, name, className }: { icon: Icon | null; name: string; className?: string }) {
	if (icon?.kind === "image") return <img src={icon.data} alt="" className={cn("size-8 shrink-0 rounded-md object-cover", className)} />;
	if (icon?.kind === "glyph") {
		return (
			<span aria-hidden style={{ background: icon.color ?? NEUTRAL }} className={cn("flex size-8 shrink-0 items-center justify-center rounded-md text-lg", className)}>
				{icon.glyph}
			</span>
		);
	}
	if (icon?.kind === "letter") {
		return (
			<span aria-hidden style={{ background: icon.color }} className={cn("flex size-8 shrink-0 items-center justify-center rounded-md text-sm font-bold text-white", className)}>
				{initialOf(name || "Workspace")}
			</span>
		);
	}
	return (
		<span aria-hidden style={{ background: NEUTRAL }} className={cn("flex size-8 shrink-0 items-center justify-center rounded-md text-sm font-bold text-white", className)}>
			{initialOf(name || "Workspace")}
		</span>
	);
}

export default function WorkspaceIconView({ id, name, className }: { id: string | undefined; name: string; className?: string }) {
	return <IconView icon={useWorkspaceIcon(id)} name={name} className={className} />;
}

// Choose a picture from the computer, an emoji, or go back to the letter
export function IconPicker({ value, onChange, name, shared = false }: { value: Icon | null; onChange: (icon: Icon | null) => void; name: string; shared?: boolean }) {
	const file = useRef<HTMLInputElement>(null);
	const [error, setError] = useState<string | null>(null);

	return (
		<div className="flex flex-col gap-2">
			<div className="flex items-center gap-4">
				<IconView icon={value} name={name} className="size-14 text-3xl" />
				<div className="flex flex-wrap gap-2">
					<input
						ref={file}
						type="file"
						accept="image/png,image/jpeg,image/webp"
						hidden
						aria-label="Choose a picture"
						onChange={(e) => {
							const f = e.target.files?.[0];
							e.target.value = "";
							if (!f) return;
							setError(null);
							pictureToIcon(f)
								.then(onChange)
								.catch((err) => setError(err instanceof Error ? err.message : String(err)));
						}}
					/>
					<Button variant="outline" size="sm" onPress={() => file.current?.click()}>
						<Upload className="size-3.5" />
						Choose a Picture
					</Button>
					{value && (
						<Button variant="ghost" size="sm" onPress={() => onChange(null)}>
							Use the Letter
						</Button>
					)}
				</div>
			</div>
			<div role="group" aria-label="Emoji" className="flex flex-wrap gap-1">
				{GLYPHS.map((g) => (
					<button
						key={g}
						type="button"
						aria-label={`Use ${g}`}
						aria-pressed={value?.kind === "glyph" && value.glyph === g}
						onClick={() => onChange({ kind: "glyph", glyph: g })}
						className={cn("flex size-8 cursor-pointer items-center justify-center rounded-md text-lg outline-none hover:bg-muted focus-visible:bg-muted", value?.kind === "glyph" && value.glyph === g && "bg-primary/20")}
					>
						{g}
					</button>
				))}
			</div>
			{value?.kind !== "image" && (
				<ColorSwatches
					value={value?.color ?? null}
					onChange={(color) => onChange(color ? (value?.kind === "glyph" ? { ...value, color } : { kind: "letter", color }) : value?.kind === "glyph" ? { kind: "glyph", glyph: value.glyph } : null)}
				/>
			)}
			{value?.kind === "image" && <p className="text-[13px] text-muted-foreground">Choose an emoji or the letter to pick a colour.</p>}
			{error && (
				<p role="alert" className="text-xs text-destructive">
					{error}
				</p>
			)}
			<p className="text-[13px] text-muted-foreground">{shared ? "Everyone in the workspace sees this icon." : "Once the workspace is created, the Owner and Admins can change the icon, and everyone sees it."}</p>
		</div>
	);
}
