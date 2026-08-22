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
  const input: React.CSSProperties = {
    minWidth: 0,
    flex: "1 1 120px",
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(0,229,255,0.18)",
    borderRadius: 3,
    padding: "5px 7px",
    color: "#cbd5e1",
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: "calc(12px * var(--bs-font-scale, 1))",
  };
  return (
    <div data-testid={testId} style={{ marginTop: 10, padding: "8px 9px", border: "1px solid rgba(0,229,255,0.12)", borderRadius: 4, background: "rgba(255,255,255,0.02)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <span style={{ color: "#7dd3fc", fontSize: "calc(11px * var(--bs-font-scale, 1))", letterSpacing: "0.14em", textTransform: "uppercase" }}>Filter results</span>
        {active && <button type="button" onClick={() => onChange({ ...EMPTY_CATALOG_RESULT_FILTERS })} style={{ border: 0, background: "none", color: "#fca5a5", cursor: "pointer", fontSize: "calc(11px * var(--bs-font-scale, 1))" }}>CLEAR</button>}
      </div>
      <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
        <select aria-label="Filter by type" value={filters.type} onChange={(e) => update({ type: e.target.value })} style={input}>
          <option value="">All types</option>
          <option value="bathymetry">Bathymetry</option>
          <option value="substrate">Substrate</option>
          <option value="habitat">Habitat</option>
          <option value="lidar">Lidar</option>
          <option value="chart">Chart</option>
        </select>
        <input aria-label="Filter by name" placeholder="Name contains…" value={filters.name} onChange={(e) => update({ name: e.target.value })} style={input} />
        <input aria-label="Updated from" type="date" value={filters.updatedFrom} onChange={(e) => update({ updatedFrom: e.target.value })} style={input} />
        <input aria-label="Updated to" type="date" value={filters.updatedTo} onChange={(e) => update({ updatedTo: e.target.value })} style={input} />
      </div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 7, fontSize: "calc(11.5px * var(--bs-font-scale, 1))", color: "#cbd5e1" }}>
        <label><input type="checkbox" checked={filters.bathymetryOnly} onChange={(e) => update({ bathymetryOnly: e.target.checked })} /> Bathymetry</label>
        <label><input type="checkbox" checked={filters.efhOnly} onChange={(e) => update({ efhOnly: e.target.checked })} /> EFH</label>
      </div>
    </div>
  );
};