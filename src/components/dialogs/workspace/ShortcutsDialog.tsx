import { Keyboard } from "@/components/animate-icons";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter, DialogHeading } from "@/components/ui/dialog";
import { SHORTCUT_GROUPS } from "@/lib/shortcuts";

// Every workspace shortcut in one place, opened with F1
export default function ShortcutsDialog({ onClose }: { onClose: () => void }) {
	return (
		<Dialog isOpen onOpenChange={(open) => !open && onClose()} className="sm:max-w-3xl">
			<div className="space-y-4">
				<DialogHeading icon={<Keyboard className="size-6" />} title="Keyboard Shortcuts" />
				<div className="grid max-h-[60vh] gap-x-8 gap-y-4 overflow-y-auto sm:grid-cols-2">
					{SHORTCUT_GROUPS.map((g) => (
						<section key={g.title} aria-label={g.title}>
							<h3 className="mb-1.5 font-mono text-[13px] text-muted-foreground">{g.title}</h3>
							<ul className="space-y-1">
								{g.items.map((s) => (
									<li key={s.keys.join("+") + s.label} className="flex items-center justify-between gap-3 text-sm">
										<span>{s.label}</span>
										<span className="flex shrink-0 gap-1">
											{s.keys.map((k) => (
												<kbd key={k} className="min-w-6 border border-b-2 bg-muted px-1.5 text-center font-mono text-[13px] leading-5">{k}</kbd>
											))}
										</span>
									</li>
								))}
							</ul>
						</section>
					))}
				</div>
				<DialogFooter>
					<Button variant="outline" onPress={onClose}>Close</Button>
				</DialogFooter>
			</div>
		</Dialog>
	);
}
