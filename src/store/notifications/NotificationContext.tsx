// In-app notifications for the current session: a collaborator joined, a task was assigned to you

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

export interface AppNotification {
	id: number;
	text: string;
	at: number;
	read: boolean;
}

interface NotificationContextType {
	items: AppNotification[]; // Newest first
	unread: number;
	notify: (text: string) => void;
	markAllRead: () => void;
	clear: () => void;
}

// Without a provider (tests, isolated components) notifying does nothing
const NONE: NotificationContextType = { items: [], unread: 0, notify: () => {}, markAllRead: () => {}, clear: () => {} };
const NotificationContext = createContext<NotificationContextType>(NONE);

// A long session should not grow this list without end
export const MAX_NOTIFICATIONS = 50;

let nextId = 1;

export function NotificationProvider({ children }: { children: ReactNode }) {
	const [items, setItems] = useState<AppNotification[]>([]);

	const notify = useCallback((text: string) => {
		setItems((prev) => [{ id: nextId++, text, at: Date.now(), read: false }, ...prev].slice(0, MAX_NOTIFICATIONS));
	}, []);
	const markAllRead = useCallback(() => setItems((prev) => (prev.some((n) => !n.read) ? prev.map((n) => ({ ...n, read: true })) : prev)), []);
	const clear = useCallback(() => setItems([]), []);

	const value = useMemo(
		() => ({ items, unread: items.filter((n) => !n.read).length, notify, markAllRead, clear }),
		[items, notify, markAllRead, clear],
	);
	return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
}

export function useNotifications(): NotificationContextType {
	return useContext(NotificationContext);
}
