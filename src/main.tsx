import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";

import { RouterProvider } from "react-router-dom";
import { router } from "./routes/router";

import { WorkspaceProvider } from "./store/workspace/WorkspaceContext";
import { ThemeProvider } from "./store/ThemeContext";
import WorkspaceLoader from "./components/WorkspaceLoader";
import ErrorBoundary from "./components/ErrorBoundary";

ReactDOM.createRoot(document.getElementById("root")!).render(
	<React.StrictMode>
		<ThemeProvider>
			<WorkspaceProvider>
				<WorkspaceLoader>
					<ErrorBoundary>
						<RouterProvider router={router} />
					</ErrorBoundary>
				</WorkspaceLoader>
			</WorkspaceProvider>
		</ThemeProvider>
	</React.StrictMode>,
);
