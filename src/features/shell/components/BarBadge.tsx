// The number on an icon in the window bar: the same size and place on every one of them

export default function BarBadge({ count }: { count: number }) {
	if (count <= 0) return null;
	return <span className="absolute -top-0.5 -right-0.5 flex min-w-4 items-center justify-center bg-primary px-1 font-mono text-[11px] leading-4 font-bold text-primary-foreground">{count > 9 ? "9+" : count}</span>;
}
