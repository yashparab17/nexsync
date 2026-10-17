// The page for an address nothing answers to
import Art from "@/components/elements/Art";

export default function UnavailablePage() {
	return (
		<div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
			<Art name="missing" className="h-48 w-64 max-w-full" />
			<h1 className="text-xl font-semibold">Unavailable</h1>
			<p className="text-sm text-muted-foreground">There is nothing at this address.</p>
		</div>
	);
}
