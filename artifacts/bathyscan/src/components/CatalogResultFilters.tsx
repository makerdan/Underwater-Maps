import React from "react";
import {
  EMPTY_CATALOG_RESULT_FILTERS,
  hasCatalogResultFilters,
  type CatalogResultFilters as Filters,
} from "@/lib/catalogResultFilters";

interface Props {
  filters: Filters;
  onChange: (filters: Filters) => void;
  testId?: string;
}

export const CatalogResultFilters: React.FC<Props> = ({ filters, onChange, testId = "catalog-result-filters" }) => {
  const update = (patch: Partial<Filters>) => onChange({ ...filters, ...patch });
  const active = hasCatalogResultFilters(filters);
  const activeCount = [
    filters.type,
    filters.name,
    filters.updatedFrom,
    filters.updatedTo,
    filters.bathymetryOnly,
    filters.efhOnly,
  ].filter(Boolean).length;
  const input: React.CSSProperties = {
    minWidth: 0,
    flex: "1 1 120px",
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(0,229,255,0.18)",
    borderRadius: 3,
    padding: "5px 7px",
    color: "#cbd5e1",
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: "calc(13.5px * var(--bs-font-scale, 1))",
    minHeight: 34,
  };
  const label: React.CSSProperties = {
    display: "grid",
    gap: 4,
    flex: "1 1 145px",
    minWidth: 0,
    color: "#94a3b8",
    fontSize: "calc(10.5px * var(--bs-font-scale, 1))",
    letterSpacing: "0.1em",
    textTransform: "uppercase",
  };
  return (
    <div data-testid={testId} style={{ marginTop: 10, padding: "11px 10px", border: "1px solid rgba(0,229,255,0.14)", borderRadius: 5, background: "rgba(255,255,255,0.025)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 9 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <span style={{ color: "#7dd3fc", fontSize: "calc(11px * var(--bs-font-scale, 1))", fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase" }}>Filter results</span>
          {activeCount > 0 && <span style={{ color: "#0e7490", background: "rgba(34,211,238,0.12)", borderRadius: 99, padding: "1px 6px", fontSize: "calc(10px * var(--bs-font-scale, 1))" }}>{activeCount}</span>}
        </div>
        {active && <button type="button" onClick={() => onChange({ ...EMPTY_CATALOG_RESULT_FILTERS })} style={{ border: 0, background: "none", color: "#fca5a5", cursor: "pointer", fontSize: "calc(11px * var(--bs-font-scale, 1))", letterSpacing: "0.08em" }}>CLEAR ALL</button>}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
        <label style={label}>
          Dataset type
          <select aria-label="Filter by type" value={filters.type} onChange={(e) => update({ type: e.target.value })} style={input}>
            <option value="">All types</option>
            <option value="bathymetry">Bathymetry</option>
            <option value="substrate">Substrate</option>
            <option value="habitat">Habitat</option>
            <option value="lidar">Lidar</option>
            <option value="chart">Chart</option>
            <option value="intertidal">Intertidal / shoreline</option>
          </select>
        </label>
        <label style={label}>
          Name
          <input aria-label="Filter by name" placeholder="Any name" value={filters.name} onChange={(e) => update({ name: e.target.value })} style={input} />
        </label>
        <label style={label}>
          Updated after
          <input aria-label="Updated from" type="date" value={filters.updatedFrom} onChange={(e) => update({ updatedFrom: e.target.value })} style={input} />
        </label>
        <label style={label}>
          Updated before
          <input aria-label="Updated to" type="date" value={filters.updatedTo} onChange={(e) => update({ updatedTo: e.target.value })} style={input} />
        </label>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8, marginTop: 8 }}>
        <label style={label}>
          Coverage
          <select aria-label="Bathymetry only" value={filters.bathymetryOnly ? "bathymetry" : ""} onChange={(e) => update({ bathymetryOnly: e.target.value === "bathymetry" })} style={input}>
            <option value="">Any coverage</option>
            <option value="bathymetry">Bathymetry only</option>
          </select>
        </label>
        <label style={label}>
          Habitat
          <select aria-label="EFH only" value={filters.efhOnly ? "efh" : ""} onChange={(e) => update({ efhOnly: e.target.value === "efh" })} style={input}>
            <option value="">Any habitat</option>
            <option value="efh">EFH only</option>
          </select>
        </label>
      </div>
    </div>
  );
};