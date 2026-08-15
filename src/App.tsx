import { Outlet } from "react-router-dom";

// Components
import ErrorDialog from "@/components/ErrorDialog";

export default function App() {
	return (
		<main className="h-screen overflow-auto">
			<Outlet />

			{/* Global error popup — surfaces load/save errors from anywhere. */}
			<ErrorDialog />
		</main>
	);
}
