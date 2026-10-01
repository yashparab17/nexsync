import { cn } from "@/lib/utils";
import logoBlack from "@/assets/logos/logo-black.svg";
import logoWhite from "@/assets/logos/logo-white.svg";

// The app-wide loading indicator: the logo, turning clockwise. Fill its parent with `fill` to centre it there.
export default function Loading({ label = "Loading", fill = false, className }: { label?: string; fill?: boolean; className?: string }) {
	return (
		<div role="status" aria-label={label} className={cn("flex items-center justify-center", fill ? "h-full min-h-40 w-full flex-1" : "py-6", className)}>
			<img src={logoBlack} alt="" className="size-7 animate-spin opacity-70 [animation-duration:1.4s] motion-reduce:animate-pulse dark:hidden" />
			<img src={logoWhite} alt="" className="hidden size-7 animate-spin opacity-70 [animation-duration:1.4s] motion-reduce:animate-pulse dark:block" />
		</div>
	);
}
