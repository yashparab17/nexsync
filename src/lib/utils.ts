import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

// Combines clsx conditional classes and merges conflicting Tailwind classes
export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}
