// Header bell: unread count, and a list of what happened since the app opened

import { useState } from "react";
import { Bell } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useNotifications } from "@/store/notifications/NotificationContext";

const time = (at: number) => new Date(at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

export default function NotificationBell() {
	const { items, unread, markAllRead, clear } = useNotifications();
	const [open, setOpen] = useState(false);

	const toggle = () => {
		// Opening the list is reading it
		if (!open) markAllRead();
		setOpen(!open);
	};

	return (
		<div className="relative">
			<Button variant="ghost" size="icon" onPress={toggle} aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"} aria-expanded={open}>
				<Bell className="size-5" />
				{unread > 0 && (
					<span className="absolute right-1 top-1 flex min-w-4 items-center justify-center bg-primary px-1 text-xs font-bold text-primary-foreground">
						{unread > 9 ? "9+" : unread}
					</span>
				)}
			</Button>
			{open && (
				<>
					<button type="button" aria-label="Close notifications" className="fixed inset-0 z-10 cursor-default" onClick={() => setOpen(false)} />
					<div role="region" aria-label="Notifications" className="absolute right-0 z-20 mt-1 w-80 border bg-popover shadow-md">
						<div className="flex items-center justify-between border-b px-3 py-2">
							<span className="text-xs font-semibold ">Notifications</span>
							{items.length > 0 && (
								<button type="button" onClick={clear} className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
									Clear
								</button>
							)}
						</div>
						{items.length === 0 ? (
							<p className="p-4 text-xs text-muted-foreground">Nothing yet. You will see here when a collaborator joins or assigns you a task.</p>
						) : (
							<ul className="max-h-80 overflow-y-auto">
								{items.map((n) => (
									<li key={n.id} className="border-b px-3 py-2 text-sm last:border-b-0">
										<p>{n.text}</p>
										<p className="text-xs text-muted-foreground">{time(n.at)}</p>
									</li>
								))}
							</ul>
						)}
					</div>
				</>
			)}
		</div>
	);
}
