import { Outlet } from "react-router-dom";

// Components
import ErrorDialog from "@/components/ErrorDialog";

// Root application layout container
export default function App() {
	return (
		<main className="h-screen overflow-auto">
			{/* Active route view */}
			<Outlet />

			{/* Global error dialog for surfacing load/save failures */}
			<ErrorDialog />
		</main>
	);
}
