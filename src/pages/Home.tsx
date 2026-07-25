import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

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

			<Button>Click Me</Button>
		</main>
	);
}
