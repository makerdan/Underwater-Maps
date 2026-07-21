/**
 * DataUnavailable — compact single-line notice shown when a real-data
 * environmental layer has no data source for the current location.
 *
 * Used by the Tide/Water Level, Currents, and Temperature overlay panels
 * in freshwater mode when the backend has no USGS / GLERL station in range.
 */
import React from "react";

const FONT = "'JetBrains Mono', 'Fira Code', monospace";

export interface DataUnavailableProps {
  message: string;
  "data-testid"?: string;
}

export const DataUnavailable: React.FC<DataUnavailableProps> = ({
  message,
  "data-testid": testId = "data-unavailable",
}) => (
  <div
    data-testid={testId}
    style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      fontSize: "calc(13.5px * var(--bs-font-scale, 1))",
      fontFamily: FONT,
      letterSpacing: "0.13em",
      textTransform: "uppercase",
      padding: "3px 7px",
      borderRadius: 3,
      background: "rgba(51,65,85,0.35)",
      border: "1px dashed rgba(148,163,184,0.3)",
      color: "#94a3b8",
    }}
  >
    <span aria-hidden="true">◌</span>
    <span>{message}</span>
  </div>
);
