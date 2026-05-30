import React from "react";

interface Props {
  /** Short label used in the fallback message (e.g. "dataset library"). */
  label?: string;
  /** Optional override for the fallback UI. */
  fallback?: React.ReactNode;
  children: React.ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Generic React error boundary. Catches render-time exceptions in its
 * children so that a single broken panel can degrade to a contained
 * error message instead of taking down the entire UI tree (the page
 * body going blank).
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    if (typeof console !== "undefined") {
      console.error("[ErrorBoundary] caught error", error, info);
    }
  }

  reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      if (this.props.fallback !== undefined) return this.props.fallback;
      const label = this.props.label ?? "this section";
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
        </div>
      );
    }
    return this.props.children;
  }
}
