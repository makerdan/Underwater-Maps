/**
 * nceiClassify — heuristic data-type classification for NCEI Geoportal
 * records. The geoportal spans many disciplines (weather, climate,
 * oceanography …); when the search proxy is asked for a broadened result set
 * we classify each record client-side from its title + abstract so the
 * "Other data in this area" section can show type badges.
 */

export type NceiDataType =
  | "bathymetry"
  | "lidar"
  | "imagery"
  | "oceanographic"
  | "geophysical"
  | "climate"
  | "other";

const RULES: Array<{ type: NceiDataType; re: RegExp }> = [
  {
    type: "bathymetry",
    re: /\b(bathymetr|multibeam|hydrographic\s+survey|depth\s+sound|swath|dem\b|digital\s+elevation|seafloor\s+topo|bag\b)/i,
  },
  { type: "lidar", re: /\b(lidar|topobathy|laser\s+altimetr)/i },
  { type: "imagery", re: /\b(imagery|orthophoto|aerial\s+photo|satellite\s+image|side[-\s]?scan|backscatter)/i },
  {
    type: "oceanographic",
    re: /\b(ctd\b|salinity|water\s+temperature|current\s+meter|tide|sea\s+level|buoy|oceanograph|water\s+column|chlorophyll)/i,
  },
  {
    type: "geophysical",
    re: /\b(magnetic|gravity|seismic|sediment|geolog|core\s+sample|sub[-\s]?bottom)/i,
  },
  {
    type: "climate",
    re: /\b(climate|weather|precipitation|wind\s+speed|atmospher|storm|temperature\s+normals)/i,
  },
];

export function classifyNceiDataType(title: string, description?: string | null): NceiDataType {
  const text = `${title} ${description ?? ""}`;
  for (const rule of RULES) {
    if (rule.re.test(text)) return rule.type;
  }
  return "other";
}

export const NCEI_TYPE_BADGE_COLORS: Record<NceiDataType, string> = {
  bathymetry: "#00e5ff",
  lidar: "#a78bfa",
  imagery: "#f472b6",
  oceanographic: "#4ade80",
  geophysical: "#fb923c",
  climate: "#facc15",
  other: "#94a3b8",
};
