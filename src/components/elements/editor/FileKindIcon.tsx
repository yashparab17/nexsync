import { File, FileCode, FileText, Image } from "@/components/animate-icons";

import { fileKind, KIND_TONE } from "@/lib/editor/fileKinds";
import { cn } from "@/lib/utils";

// The icon for a file name, coloured by kind
export default function FileKindIcon({ name, className }: { name: string; className?: string }) {
	const kind = fileKind(name);
	const Icon = kind === "markup" ? FileText : kind === "image" ? Image : kind === "other" ? File : FileCode;
	return <Icon className={cn("size-4 shrink-0", KIND_TONE[kind], className)} />;
}
