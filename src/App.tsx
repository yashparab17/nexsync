import { Outlet, useLocation } from "react-router-dom";

// Components
import ErrorDialog from "@/components/ErrorDialog";
import TitleBar from "@/components/TitleBar";

// Root application layout container
export default function App() {
	// Fade between top-level screens; moving between workspace tabs is handled in the workspace layout
	const screen = useLocation().pathname.split("/")[1] ?? "";
	return (
		<div className="flex h-screen flex-col">
			<TitleBar />

			<main className="min-h-0 flex-1 overflow-auto">
				{/* Active route view */}
				<div key={screen} className="h-full animate-in fade-in duration-300 motion-reduce:animate-none">
					<Outlet />
				</div>
			</main>

			{/* Global error dialog for surfacing load/save failures */}
			<ErrorDialog />
		</div>
	);
}
