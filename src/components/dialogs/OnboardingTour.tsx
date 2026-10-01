// A four-step introduction shown the first time the app opens, and again from the Welcome page

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { t } from "@/i18n";

const SEEN_KEY = "nexsync.tourSeen";
const STEPS = [1, 2, 3, 4] as const;

// Whether the tour has been shown before; when storage is blocked it counts as seen, so it never nags
export function tourSeen(): boolean {
	try {
		return localStorage.getItem(SEEN_KEY) === "1";
	} catch {
		return true;
	}
}

function markTourSeen() {
	try {
		localStorage.setItem(SEEN_KEY, "1");
	} catch {
		// Only means the tour may show again next time
	}
}

export default function OnboardingTour({ open, onClose }: { open: boolean; onClose: () => void }) {
	const [index, setIndex] = useState(0);
	const step = STEPS[index];
	const last = index === STEPS.length - 1;

	const finish = () => {
		markTourSeen();
		setIndex(0);
		onClose();
	};

	return (
		<Dialog isOpen={open} onOpenChange={(next) => !next && finish()} className="max-w-md">
			<DialogHeader>
				<p className="text-xs uppercase tracking-widest text-muted-foreground">{t("tour.step", { current: step, total: STEPS.length })}</p>
				<DialogTitle>{t(`tour.${step}.title` as const)}</DialogTitle>
			</DialogHeader>
			<p className="py-2 text-sm text-muted-foreground">{t(`tour.${step}.body` as const)}</p>
			<div className="flex justify-center gap-1.5" aria-hidden>
				{STEPS.map((s, i) => (
					<span key={s} className={i === index ? "size-2 bg-primary" : "size-2 bg-muted"} />
				))}
			</div>
			<DialogFooter>
				{!last && (
					<Button variant="ghost" onPress={finish}>
						{t("tour.skip")}
					</Button>
				)}
				{index > 0 && (
					<Button variant="outline" onPress={() => setIndex(index - 1)}>
						{t("tour.back")}
					</Button>
				)}
				<Button onPress={last ? finish : () => setIndex(index + 1)}>{last ? t("tour.done") : t("tour.next")}</Button>
			</DialogFooter>
		</Dialog>
	);
}
