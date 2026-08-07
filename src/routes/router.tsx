import { createBrowserRouter } from "react-router-dom";

import App from "@/App";

import Welcome from "@/pages/Welcome";
import Settings from "@/pages/Settings";
import Unavailable from "@/pages/Unavailable";
import Workspace from "@/pages/workspace/WorkspaceWrapper";
import WorkspaceDashboard from "@/pages/workspace/WorkspaceDashboard";
import WorkspaceFiles from "@/pages/workspace/WorkspaceFiles";
import WorkspaceAssets from "@/pages/workspace/WorkspaceAssets";
import WorkspaceTasks from "@/pages/workspace/WorkspaceTasks";
import WorkspaceKanban from "@/pages/workspace/WorkspaceKanban";
import WorkspaceMembers from "@/pages/workspace/WorkspaceMembers";
import WorkspaceSettings from "@/pages/workspace/WorkspaceSettings";

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
						element: <WorkspaceFiles />,
					},
					{
						path: "assets",
						element: <WorkspaceAssets />,
					},
					{
						path: "tasks",
						element: <WorkspaceTasks />,
					},
					{
						path: "kanban",
						element: <WorkspaceKanban />,
					},
					{
						path: "members",
						element: <WorkspaceMembers />,
					},
					{
						path: "settings",
						element: <WorkspaceSettings />,
					},
				],
			},
			{
				path: "settings",
				element: <Settings />,
			},
		],
	},
	{
		path: "*",
		element: <Unavailable />,
	},
]);
