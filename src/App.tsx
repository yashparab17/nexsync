import { Outlet, useLocation } from "react-router-dom";

// Components
import ErrorDialog from "@/components/ErrorDialog";
import TitleBar from "@/components/TitleBar";
import Toaster from "@/components/Toaster";
import { t } from "@/i18n";

// Root application layout container
export default function App() {
	// Fade between top-level screens; moving between workspace tabs is handled in the workspace layout
	const screen = useLocation().pathname.split("/")[1] ?? "";
	return (
		<div className="flex h-screen flex-col">
			<TitleBar />

			<a
				href="#main-content"
				className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:shadow-md"
			>
				{t("app.skipToContent")}
			</a>

			<main id="main-content" tabIndex={-1} className="min-h-0 flex-1 overflow-auto focus:outline-none">
				{/* Active route view */}
				<div key={screen} className="h-full animate-in fade-in duration-300 motion-reduce:animate-none">
					<Outlet />
				</div>
			</main>

			{/* Global error dialog for surfacing load/save failures */}
			<ErrorDialog />

			{/* Pop-ups for background events */}
			<Toaster />
		</div>
	);
}
