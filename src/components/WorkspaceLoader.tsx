import type { ReactNode } from "react";

// The app always opens on the Welcome page. The workspace used last is only remembered, so Welcome can say so;
// reopening it is a choice, because a shared workspace has no connection to its host until it is joined again.
export default function WorkspaceLoader({ children }: { children: ReactNode }) {
	return <>{children}</>;
}
