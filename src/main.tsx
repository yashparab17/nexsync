import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";

import { RouterProvider } from "react-router-dom";
import { router } from "./routes/router";

import { WorkspaceProvider } from "./store/workspace/WorkspaceContext";
import { ThemeProvider } from "./store/ThemeContext";
import WorkspaceLoader from "./components/WorkspaceLoader";

ReactDOM.createRoot(document.getElementById("root")!).render(
	<React.StrictMode>
		<ThemeProvider>
			<WorkspaceProvider>
				<WorkspaceLoader>
					<RouterProvider router={router} />
				</WorkspaceLoader>
			</WorkspaceProvider>
		</ThemeProvider>
	</React.StrictMode>,
);
