import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";

import { RouterProvider } from "react-router-dom";
import { router } from "./routes/router";

import { WorkspaceProvider } from "./store/workspace/WorkspaceContext";
import { P2PProvider } from "./store/p2p/P2PContext";
import { ThemeProvider } from "./store/ThemeContext";
import WorkspaceLoader from "./components/WorkspaceLoader";
import ErrorBoundary from "./components/ErrorBoundary";
import { initSecurityPolicies } from "./lib/security";

// Enforce desktop security policies: disable right-click, dev tools, and history tracking
initSecurityPolicies();

// Application root bootstrap mounting React providers and router
ReactDOM.createRoot(document.getElementById("root")!).render(
	<React.StrictMode>
		<ThemeProvider>
			<WorkspaceProvider>
				<P2PProvider>
					<WorkspaceLoader>
						<ErrorBoundary>
							<RouterProvider router={router} />
						</ErrorBoundary>
					</WorkspaceLoader>
				</P2PProvider>
			</WorkspaceProvider>
		</ThemeProvider>
	</React.StrictMode>,
);

