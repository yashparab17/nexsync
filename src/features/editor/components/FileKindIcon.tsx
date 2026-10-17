import { fileIconName, folderIconName, iconBody } from "@/lib/editor/fileIcons";
import { cn } from "@/lib/utils";

// The icons are drawn for dark backgrounds; on the light theme they are made a little deeper so they hold their own
const LOOK = "shrink-0 brightness-[.6] saturate-[2] contrast-125 dark:brightness-100 dark:saturate-100 dark:contrast-100";

function Icon({ icon, className }: { icon: string; className?: string }) {
	return <svg viewBox="0 0 16 16" aria-hidden="true" className={cn("size-4", LOOK, className)} dangerouslySetInnerHTML={{ __html: iconBody(icon) }} />;
}

// The Catppuccin icon for a file name: by its exact name (package.json, Dockerfile), then its pattern, then its extension
export default function FileKindIcon({ name, className }: { name: string; className?: string }) {
	return <Icon icon={fileIconName(name)} className={className} />;
}

// The icon for a folder, by its name (src, components, node_modules), open or closed
export function FolderKindIcon({ name, open = false, className }: { name: string; open?: boolean; className?: string }) {
	return <Icon icon={folderIconName(name, open)} className={className} />;
}
