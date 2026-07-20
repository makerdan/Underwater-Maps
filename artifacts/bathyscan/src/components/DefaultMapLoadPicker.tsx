/**
 * DefaultMapLoadPicker — a grouped <select> for the Settings "Data & Storage"
 * section that lets users choose which dataset opens automatically on launch.
 *
 * Lists built-in presets (/api/datasets) and, when signed in, the user's own
 * uploaded datasets (/api/user/datasets) in separate labelled groups.
 */
import React from "react";
import {
  useGetDatasets,
  useGetUserDatasets,
  getGetDatasetsQueryKey,
  getGetUserDatasetsQueryKey,
} from "@workspace/api-client-react";
import { useUser } from "@/lib/clerkCompat";
import { useSettingsStore } from "@/lib/settingsStore";
import type { DefaultMapLoad } from "@/lib/settingsStore";

const FONT = "'JetBrains Mono', 'Fira Code', monospace";

const selectStyle: React.CSSProperties = {
  background: "rgba(0,10,20,0.8)",
  border: "1px solid rgba(0,229,255,0.2)",
  borderRadius: 4,
  color: "#e2e8f0",
  fontSize: 15,
  padding: "4px 8px",
  fontFamily: FONT,
  cursor: "pointer",
  outline: "none",
  maxWidth: 220,
  minWidth: 180,
};

interface DefaultMapLoadPickerProps {
  value: DefaultMapLoad | null;
  onChange: (v: DefaultMapLoad | null) => void;
}

function encode(v: DefaultMapLoad | null): string {
  if (!v) return "";
  return `${v.kind}:${v.id}`;
}

function decode(raw: string): DefaultMapLoad | null {
  if (!raw) return null;
  const colonIdx = raw.indexOf(":");
  if (colonIdx === -1) return null;
  const kind = raw.slice(0, colonIdx) as "preset" | "upload";
  const id = raw.slice(colonIdx + 1);
  if (kind !== "preset" && kind !== "upload") return null;
  return { kind, id };
}

export function DefaultMapLoadPicker({ value, onChange }: DefaultMapLoadPickerProps) {
  const { isSignedIn, isLoaded } = useUser();
  const waterType = useSettingsStore((s) => s.waterType);

  const { data: presets, isLoading: presetsLoading } = useGetDatasets(
    { waterType },
    { query: { queryKey: getGetDatasetsQueryKey({ waterType }), staleTime: 60_000 } },
  );

  const { data: uploads, isLoading: uploadsLoading } = useGetUserDatasets({
    query: { enabled: isLoaded && isSignedIn === true, queryKey: getGetUserDatasetsQueryKey(), staleTime: 60_000 },
  });

  const loading = presetsLoading || (!!isSignedIn && uploadsLoading);

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    onChange(decode(e.target.value));
  };

  return (
    <select
      value={encode(value)}
      onChange={handleChange}
      style={selectStyle}
      disabled={loading}
      aria-label="Default map load"
      data-testid="default-map-load-select"
    >
      <option value="">
        {loading ? "Loading…" : "App default (first available)"}
      </option>

      {presets && presets.length > 0 && (
        <optgroup label="Built-in Presets">
          {presets.map((d) => (
            <option key={`preset:${d.id}`} value={`preset:${d.id}`}>
              {d.name}
            </option>
          ))}
        </optgroup>
      )}

      {isSignedIn && !uploadsLoading && uploads && uploads.length > 0 && (
        <optgroup label="My Library">
          {uploads.map((d) => (
            <option key={`upload:${d.id}`} value={`upload:${d.id}`}>
              {d.name}
            </option>
          ))}
        </optgroup>
      )}
    </select>
  );
}
