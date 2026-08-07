import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";

import { RouterProvider } from "react-router-dom";
import { router } from "./routes/router";

import { WorkspaceProvider } from "./store/WorkspaceContext";

document.documentElement.classList.add("dark");

ReactDOM.createRoot(document.getElementById("root")!).render(
	<React.StrictMode>
		<WorkspaceProvider>
			<RouterProvider router={router} />
		</WorkspaceProvider>
	</React.StrictMode>,
);
