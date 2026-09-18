// React
import { Component, type ReactNode } from "react";

// Tauri IPC
import { logError } from "@/lib/tauri";

interface ErrorBoundaryProps {
	children: ReactNode;
}

interface ErrorBoundaryState {
	hasError: boolean;
}

// Catches unhandled render errors in subtree and shows fallback UI
export default class ErrorBoundary extends Component<
	ErrorBoundaryProps,
	ErrorBoundaryState
> {
	state: ErrorBoundaryState = { hasError: false };

	// Update state so the next render shows the fallback UI
	static getDerivedStateFromError(): ErrorBoundaryState {
		return { hasError: true };
	}

	// Log caught render error to app-level error log
	componentDidCatch(error: Error, info: React.ErrorInfo) {
		logError({
			timestamp: new Date().toISOString(),
			message: error.message || "A render error occurred in the UI.",
			source: "render",
			detail: `${error.stack ?? ""}\n${info.componentStack ?? ""}`,
		}).catch((err) => {
			console.error("Failed to write to error log:", err);
		});
	}

	// Reset error state on retry
	handleReset = () => {
		this.setState({ hasError: false });
	};

	render() {
		if (this.state.hasError) {
			return (
				<div className="flex h-screen items-center justify-center">
					<div className="text-center">
						<p className="text-2xl font-semibold">
							Something went wrong
						</p>
						<p className="mt-2 text-sm text-muted-foreground">
							An unexpected error occurred. Please try again.
						</p>
						<button
							className="mt-4 text-sm underline"
							onClick={this.handleReset}
						>
							Try again
						</button>
					</div>
				</div>
			);
		}

		return this.props.children;
	}
}
