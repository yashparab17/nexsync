import { lazy, Suspense } from "react";
import { createBrowserRouter } from "react-router-dom";

import App from "@/App";
import Welcome from "@/pages/Welcome";
import Workspace from "@/pages/workspace/WorkspaceWrapper";
import WorkspaceDashboard from "@/pages/workspace/WorkspaceDashboard";

// Lazy-load sub-routes for optimized bundle splitting
const WorkspaceFiles = lazy(() => import("@/pages/workspace/WorkspaceFiles"));
const WorkspaceAssets = lazy(() => import("@/pages/workspace/WorkspaceAssets"));
const WorkspaceTasks = lazy(() => import("@/pages/workspace/WorkspaceTasks"));
const WorkspaceKanban = lazy(() => import("@/pages/workspace/WorkspaceKanban"));
const WorkspaceMembers = lazy(() => import("@/pages/workspace/WorkspaceMembers"));
const WorkspaceSettings = lazy(() => import("@/pages/workspace/WorkspaceSettings"));
const Settings = lazy(() => import("@/pages/Settings"));
const Unavailable = lazy(() => import("@/pages/Unavailable"));

// Suspense fallback wrapper for lazy-loaded route components
function RouteSuspense({ children }: { children: React.ReactNode }) {
	return (
		<Suspense
			fallback={
				<div className="flex h-64 items-center justify-center">
					<p className="text-xs tracking-widest text-muted-foreground uppercase">
						Loading…
					</p>
				</div>
			}
		>
			{children}
		</Suspense>
	);
}

// Application client-side router definition
export const router = createBrowserRouter([
	{
		path: "/",
		element: <App />,
		children: [
			{
				index: true,
				element: <Welcome />,
			},
			{
				path: "workspace",
				element: <Workspace />,
				children: [
					{
						index: true,
						element: <WorkspaceDashboard />,
					},
					{
						path: "dashboard",
						element: <WorkspaceDashboard />,
					},
					{
						path: "files",
						element: (
							<RouteSuspense>
								<WorkspaceFiles />
							</RouteSuspense>
						),
					},
					{
						path: "assets",
						element: (
							<RouteSuspense>
								<WorkspaceAssets />
							</RouteSuspense>
						),
					},
					{
						path: "tasks",
						element: (
							<RouteSuspense>
								<WorkspaceTasks />
							</RouteSuspense>
						),
					},
					{
						path: "kanban",
						element: (
							<RouteSuspense>
								<WorkspaceKanban />
							</RouteSuspense>
						),
					},
					{
						path: "members",
						element: (
							<RouteSuspense>
								<WorkspaceMembers />
							</RouteSuspense>
						),
					},
					{
						path: "settings",
						element: (
							<RouteSuspense>
								<WorkspaceSettings />
							</RouteSuspense>
						),
					},
				],
			},
			{
				path: "settings",
				element: (
					<RouteSuspense>
						<Settings />
					</RouteSuspense>
				),
			},
		],
	},
	{
		path: "*",
		element: (
			<RouteSuspense>
				<Unavailable />
			</RouteSuspense>
		),
	},
]);
