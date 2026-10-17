import { lazy, Suspense } from "react";
import { createBrowserRouter } from "react-router-dom";

import App from "@/App";
import Welcome from "@/features/welcome/WelcomePage";
import Workspace from "@/features/shell/WorkspaceShell";
import DashboardPage from "@/features/dashboard/DashboardPage";
import Loading from "@/components/Loading";

// Lazy-load sub-routes for optimized bundle splitting
const ExplorerPage = lazy(() => import("@/features/explorer/ExplorerPage"));
const OthersPage = lazy(() => import("@/features/others/OthersPage"));
const EditorPage = lazy(() => import("@/features/editor/EditorPage"));
const ProjectsPage = lazy(() => import("@/features/projects/ProjectsPage"));
const NotesPage = lazy(() => import("@/features/notes/NotesPage"));
const DocumentsPage = lazy(() => import("@/features/office/documents/DocumentsPage"));
const SheetsPage = lazy(() => import("@/features/office/sheets/SheetsPage"));
const SlidesPage = lazy(() => import("@/features/office/slides/SlidesPage"));
const AssetsPage = lazy(() => import("@/features/assets/AssetsPage"));
const TasksPage = lazy(() => import("@/features/tasks/TasksPage"));
const KanbanPage = lazy(() => import("@/features/kanban/KanbanPage"));
const ChatPage = lazy(() => import("@/features/chat/ChatPage"));
const AnnouncementsPage = lazy(() => import("@/features/announcements/AnnouncementsPage"));
const InsightsPage = lazy(() => import("@/features/insights/InsightsPage"));
const MembersPage = lazy(() => import("@/features/members/MembersPage"));
const TrashPage = lazy(() => import("@/features/trash/TrashPage"));
const Unavailable = lazy(() => import("@/features/welcome/UnavailablePage"));

// Suspense fallback wrapper for lazy-loaded route components
function RouteSuspense({ children }: { children: React.ReactNode }) {
	return (
		<Suspense
			fallback={<Loading fill />}
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
						element: <DashboardPage />,
					},
					{
						path: "dashboard",
						element: <DashboardPage />,
					},
					{
						path: "notes",
						element: (
							<RouteSuspense>
								<NotesPage />
							</RouteSuspense>
						),
					},
					{
						path: "office/documents",
						element: (
							<RouteSuspense>
								<DocumentsPage />
							</RouteSuspense>
						),
					},
					{
						path: "office/sheets",
						element: (
							<RouteSuspense>
								<SheetsPage />
							</RouteSuspense>
						),
					},
					{
						path: "office/slides",
						element: (
							<RouteSuspense>
								<SlidesPage />
							</RouteSuspense>
						),
					},
					{
						path: "editor",
						element: (
							<RouteSuspense>
								<EditorPage />
							</RouteSuspense>
						),
					},
					{
						path: "projects",
						element: (
							<RouteSuspense>
								<ProjectsPage />
							</RouteSuspense>
						),
					},
					{
						path: "explorer",
						element: (
							<RouteSuspense>
								<ExplorerPage />
							</RouteSuspense>
						),
					},
					{
						path: "others",
						element: (
							<RouteSuspense>
								<OthersPage />
							</RouteSuspense>
						),
					},
					{
						path: "assets",
						element: (
							<RouteSuspense>
								<AssetsPage />
							</RouteSuspense>
						),
					},
					{
						path: "tasks",
						element: (
							<RouteSuspense>
								<TasksPage />
							</RouteSuspense>
						),
					},
					{
						path: "insights",
						element: (
							<RouteSuspense>
								<InsightsPage />
							</RouteSuspense>
						),
					},
					{
						path: "kanban",
						element: (
							<RouteSuspense>
								<KanbanPage />
							</RouteSuspense>
						),
					},
					{
						path: "chat",
						element: (
							<RouteSuspense>
								<ChatPage />
							</RouteSuspense>
						),
					},
					{
						path: "announcements",
						element: (
							<RouteSuspense>
								<AnnouncementsPage />
							</RouteSuspense>
						),
					},
					{
						path: "members",
						element: (
							<RouteSuspense>
								<MembersPage />
							</RouteSuspense>
						),
					},
					{
						path: "trash",
						element: (
							<RouteSuspense>
								<TrashPage />
							</RouteSuspense>
						),
					},
				],
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
