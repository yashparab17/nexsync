import { Outlet } from "react-router-dom";

// Components
import ErrorDialog from "@/components/ErrorDialog";
import TitleBar from "@/components/TitleBar";

// Root application layout container
export default function App() {
	return (
		<div className="flex h-screen flex-col">
			<TitleBar />

			<main className="min-h-0 flex-1 overflow-auto">
				{/* Active route view */}
				<Outlet />
			</main>

			{/* Global error dialog for surfacing load/save failures */}
			<ErrorDialog />
		</div>
	);
}
