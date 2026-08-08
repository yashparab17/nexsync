import { Outlet } from "react-router-dom";

export default function App() {
	return (
		<main className="h-screen overflow-auto">
			<Outlet />
		</main>
	);
}
