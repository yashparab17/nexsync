import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";

import { RouterProvider } from "react-router-dom";
import { router } from "./routes/router";

import { WorkspaceProvider } from "./store/WorkspaceContext";
import { ThemeProvider } from "./store/ThemeContext";

ReactDOM.createRoot(document.getElementById("root")!).render(
	<React.StrictMode>
		<ThemeProvider>
			<WorkspaceProvider>
				<RouterProvider router={router} />
			</WorkspaceProvider>
		</ThemeProvider>
	</React.StrictMode>,
);
