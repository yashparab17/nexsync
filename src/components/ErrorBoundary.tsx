// React
import { Component, type ReactNode } from "react";

// Tauri
import { logError } from "@/lib/tauri";

interface ErrorBoundaryProps {
	children: ReactNode;
}

interface ErrorBoundaryState {
	hasError: boolean;
}

/**
 * Catches unhandled render errors in the subtree and shows a friendly
 * fallback instead of crashing the whole app. The error is logged to the
 * app-level error log (`errors.jsonl`) so it isn't lost.
 *
 * Note: error boundaries must be class components — function components
 * cannot trap React render errors from children.
 */
export default class ErrorBoundary extends Component<
	ErrorBoundaryProps,
	ErrorBoundaryState
> {
	state: ErrorBoundaryState = { hasError: false };

	static getDerivedStateFromError(): ErrorBoundaryState {
		return { hasError: true };
	}

	componentDidCatch(error: Error, info: React.ErrorInfo) {
		// Fire-and-forget logging so the failure is persisted for debugging.
		logError({
			timestamp: new Date().toISOString(),
			message: error.message || "A render error occurred in the UI.",
			source: "render",
			detail: `${error.stack ?? ""}\n${info.componentStack ?? ""}`,
		}).catch((err) => {
			console.error("Failed to write to error log:", err);
		});
	}

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
