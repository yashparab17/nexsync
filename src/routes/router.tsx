import { createBrowserRouter } from "react-router-dom";

import App from "../App";

import Home from "../pages/Home";
import Workspace from "../pages/Workspace";
import Settings from "../pages/Settings";
import Unavailable from "../pages/Unavailable";

export const router = createBrowserRouter([
	{
		path: "/",
		element: <App />,
		children: [
			{
				index: true,
				element: <Home />,
			},
			{
				path: "workspace",
				element: <Workspace />,
			},
			{
				path: "settings",
				element: <Settings />,
			},
		],
	},
	{
		path: "*",
		element: <Unavailable />,
	},
]);
