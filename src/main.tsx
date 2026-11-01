import React from "react";
import ReactDOM from "react-dom/client";
import "@/index.css";

import { RouterProvider } from "react-router-dom";
import { router } from "@/routes/router";

import { WorkspaceProvider } from "@/store/workspace/WorkspaceContext";
import { P2PProvider } from "@/store/p2p/P2PContext";
import { ThemeProvider } from "@/store/ThemeContext";
import { NotificationProvider } from "@/store/notifications/NotificationContext";
import WorkspaceLoader from "@/components/WorkspaceLoader";
import ErrorBoundary from "@/components/ErrorBoundary";
import { initSecurityPolicies } from "@/lib/security";

// Enforce desktop security policies: disable right-click, dev tools, and history tracking
initSecurityPolicies();

// Development only: /?lab=documents shows an editor on its own (src/dev/Lab.tsx)
// The slide show's second window, which shows the audience only the slide (src/features/office/slides/components/AudienceView.tsx)
const audience = new URLSearchParams(location.search).get("audience");
const lab = import.meta.env.DEV
  ? new URLSearchParams(location.search).get("lab")
  : null;
if (audience) {
  void import("@/features/office/slides/components/AudienceView").then(({ default: AudienceView }) => {
    ReactDOM.createRoot(document.getElementById("root")!).render(
      <ThemeProvider>
        <AudienceView />
      </ThemeProvider>,
    );
  });
} else if (lab) {
  void import("@/dev/Lab").then(({ default: Lab }) => {
    ReactDOM.createRoot(document.getElementById("root")!).render(
      <ThemeProvider>
        <Lab which={lab} />
      </ThemeProvider>,
    );
  });
} else
  // Application root bootstrap mounting React providers and router
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <ThemeProvider>
        <NotificationProvider>
          <WorkspaceProvider>
            <P2PProvider>
              <WorkspaceLoader>
                <ErrorBoundary>
                  <RouterProvider router={router} />
                </ErrorBoundary>
              </WorkspaceLoader>
            </P2PProvider>
          </WorkspaceProvider>
        </NotificationProvider>
      </ThemeProvider>
    </React.StrictMode>,
  );
