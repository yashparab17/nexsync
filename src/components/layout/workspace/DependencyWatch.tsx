// Tells the notification bell when another device's change to a project's dependency files means this device's install is out of
// date, without the Projects page being open. Shown once per change.

import { useEffect } from "react";

import { onFilesChanged } from "@/lib/p2p/transport";
import { projectDepsStatus } from "@/lib/tauri";
import { useNotifications } from "@/store/notifications/NotificationContext";
import { useWorkspace } from "@/store/workspace/WorkspaceContext";

// A file that decides what is installed, directly in a project's folder
const DEPENDENCY = /^projects\/([^/]+)\/(package(-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|Cargo\.(toml|lock)|requirements\.txt|pyproject\.toml|poetry\.lock|uv\.lock|Pipfile(\.lock)?|go\.(mod|sum)|pom\.xml|build\.gradle(\.kts)?|Gemfile(\.lock)?|composer\.(json|lock)|pubspec\.(yaml|lock)|mix\.(exs|lock)|Package\.(swift|resolved)|[^/]+\.(cs|fs)proj)$/;
const SETTLE_MS = 3000;

export default function DependencyWatch() {
	const { workspace } = useWorkspace();
	const { notify } = useNotifications();
	const path = workspace?.path;

	useEffect(() => {
		if (!path) return;
		const waiting = new Map<string, ReturnType<typeof setTimeout>>();
		const told = new Set<string>();
		const off = onFilesChanged(({ relPath }) => {
			const project = DEPENDENCY.exec(relPath)?.[1];
			if (!project) return;
			// A burst of changes (a lock file written in pieces) is one notice
			clearTimeout(waiting.get(project));
			waiting.set(
				project,
				setTimeout(() => {
					void projectDepsStatus(path, project)
						.then((d) => {
							const key = `${project}:${d.files.join(",")}`;
							if (d.state === "changed" && !told.has(key)) {
								told.add(key);
								notify(`The dependencies of ${project} changed. Open Projects to install them.`);
							}
						})
						.catch(() => {});
				}, SETTLE_MS),
			);
		});
		return () => {
			off();
			waiting.forEach(clearTimeout);
		};
	}, [path, notify]);

	return null;
}
