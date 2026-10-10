// Brief pop-ups for things that happen in the background, such as a collaborator joining or a task being assigned to you.
// They show whatever the notification bell receives, and a screen reader announces them.

import { useEffect, useRef, useState } from "react";
import { X } from "@/components/animate-icons";

import { t } from "@/i18n";
import { useNotifications } from "@/store/notifications/NotificationContext";

const SHOW_MS = 6000;
const MAX_SHOWN = 3;

interface Toast {
	id: number;
	text: string;
}

export default function Toaster() {
	const { items } = useNotifications();
	const [toasts, setToasts] = useState<Toast[]>([]);
	// The newest notification already shown; the ones from before this component mounted are not replayed
	const lastSeen = useRef<number | null>(null);

	useEffect(() => {
		const newest = items[0]?.id ?? 0;
		if (lastSeen.current === null) {
			lastSeen.current = newest;
			return;
		}
		const fresh = items.filter((n) => n.id > (lastSeen.current ?? 0)).map((n) => ({ id: n.id, text: n.text }));
		if (fresh.length === 0) return;
		lastSeen.current = newest;
		setToasts((prev) => [...fresh, ...prev].slice(0, MAX_SHOWN));
		const ids = new Set(fresh.map((n) => n.id));
		// Not cleared when the list changes again, or an earlier pop-up would never go away
		setTimeout(() => setToasts((prev) => prev.filter((x) => !ids.has(x.id))), SHOW_MS);
	}, [items]);

	return (
		<div role="status" aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2">
			{toasts.map((toast) => (
				<div key={toast.id} className="pointer-events-auto flex items-start justify-between gap-2 border bg-popover p-3 text-sm shadow-md animate-in fade-in slide-in-from-bottom-2 motion-reduce:animate-none">
					<p className="min-w-0 break-words">{toast.text}</p>
					<button
						type="button"
						aria-label={t("toast.dismiss")}
						onClick={() => setToasts((prev) => prev.filter((x) => x.id !== toast.id))}
						className="shrink-0 cursor-pointer text-muted-foreground hover:text-foreground"
					>
						<X className="size-4" />
					</button>
				</div>
			))}
		</div>
	);
}
