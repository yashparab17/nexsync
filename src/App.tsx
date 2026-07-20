import { Outlet } from "react-router-dom";

export default function App() {
	return (
		<div className="flex h-screen">
			<main className="flex-1 overflow-auto">
				<Outlet />
			</main>
		</div>
	);
}
