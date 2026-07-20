import { Link } from "react-router-dom";

export default function Home() {
	return (
		<main>
			<nav>
				<Link to="/">Home</Link>
				{" | "}
				<Link to="/workspace">Workspace</Link>
				{" | "}
				<Link to="/settings">Settings</Link>
			</nav>

			<h1>Home</h1>
		</main>
	);
}
