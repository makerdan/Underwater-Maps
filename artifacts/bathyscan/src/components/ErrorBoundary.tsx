import React from "react";
import type { ApiError } from "@workspace/api-client-react";

interface Props {
  /** Short label used in the fallback message (e.g. "dataset library"). */
  label?: string;
  /** Optional override for the fallback UI. */
  fallback?: React.ReactNode;
  children: React.ReactNode;
}

interface State {
  error: Error | null;
  componentStack: string | null;
}

function extractRequestId(error: Error): string | null {
  const apiErr = error as Partial<ApiError>;
  if (typeof apiErr.requestId === "string") return apiErr.requestId;
  const match = error.message.match(/\[request-id:\s*([^\]]+)\]/);
  return match?.[1] ?? null;
}

function buildDebugText(error: Error, componentStack: string | null, requestId: string | null): string {
  const parts: string[] = [];
  parts.push(`Error: ${error.message}`);
  if (requestId) parts.push(`Request ID: ${requestId}`);
  if (componentStack) parts.push(`\nComponent stack:${componentStack}`);
  return parts.join("\n");
}

/**
 * Generic React error boundary. Catches render-time exceptions in its
 * children so that a single broken panel can degrade to a contained
 * error message instead of taking down the entire UI tree (the page
 * body going blank).
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null, componentStack: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    this.setState({ componentStack: info.componentStack ?? null });
    if (typeof console !== "undefined") {
      console.error("[ErrorBoundary] caught error", error, info);
    }
  }

  reset = () => this.setState({ error: null, componentStack: null });

  render() {
    if (this.state.error) {
      if (this.props.fallback !== undefined) return this.props.fallback;
      const label = this.props.label ?? "this section";
      const error = this.state.error;
      const requestId = extractRequestId(error);
      const debugText = buildDebugText(error, this.state.componentStack, requestId);

      return (
        <div
          data-testid="error-boundary-fallback"
          style={{
            margin: "6px 8px",
            padding: "8px 10px",
            background: "rgba(239,68,68,0.08)",
            border: "1px solid rgba(239,68,68,0.35)",
            borderRadius: 4,
            fontSize: 10,
            color: "#fca5a5",
            fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
            userSelect: "text",
          }}
        >
          <div style={{ marginBottom: 4 }}>
            Something went wrong loading {label}.
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
            <button
              onClick={this.reset}
              style={{
                fontSize: 10,
                color: "#00e5ff",
                background: "transparent",
                border: "1px solid rgba(0,229,255,0.35)",
                borderRadius: 3,
                padding: "1px 6px",
                cursor: "pointer",
              }}
            >
              Try again
            </button>
            <button
              onClick={() => {
                void navigator.clipboard.writeText(debugText).catch(() => undefined);
              }}
              style={{
                fontSize: 10,
                color: "#94a3b8",
                background: "transparent",
                border: "1px solid rgba(148,163,184,0.3)",
                borderRadius: 3,
                padding: "1px 6px",
                cursor: "pointer",
              }}
            >
              Copy error details
            </button>
          </div>
          <details style={{ marginTop: 2 }}>
            <summary
              style={{
                cursor: "pointer",
                color: "#94a3b8",
                fontSize: 9,
                letterSpacing: "0.06em",
                userSelect: "none",
              }}
            >
              Error details
            </summary>
            <div
              style={{
                marginTop: 6,
                padding: "6px 8px",
                background: "rgba(0,0,0,0.3)",
                borderRadius: 3,
                fontSize: 9,
                color: "#cbd5e1",
                whiteSpace: "pre-wrap",
                wordBreak: "break-all",
                lineHeight: 1.5,
                userSelect: "text",
              }}
            >
              <div style={{ color: "#fca5a5", marginBottom: 4 }}>
                {error.message}
              </div>
              {requestId && (
                <div style={{ color: "#7dd3fc", marginBottom: 4 }}>
                  Request ID: {requestId}
                </div>
              )}
              {this.state.componentStack && (
                <div style={{ color: "#94a3b8", fontSize: 8 }}>
                  {this.state.componentStack}
                </div>
              )}
            </div>
          </details>
        </div>
      );
    }
    return this.props.children;
  }
}
