/**
 * RoutesPanel — collapsible side-pane section that lists all saved waypoint
 * routes for the current dataset. Users can load, fly, rename, and delete
 * routes. New routes are saved from DepthProfilePanel.
 */
import React, { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useUser } from "@/lib/clerkCompat";
import { useAppState } from "@/lib/context";
import { useDepthProfileStore, buildPathProfile, depthMetresToWorldY } from "@/lib/depthProfileStore";
import { useClassificationStore } from "@/lib/classificationStore";
import { usePanelCollapseStore } from "@/lib/panelCollapseStore";
import { lonLatToWorldXZ } from "@/lib/terrain";
import { formatDistance } from "@/lib/units";
import { useSettingsStore } from "@/lib/settingsStore";
import { useFlyRouteStore } from "@/lib/flyRouteStore";

interface RouteWaypoint {
  lon: number;
  lat: number;
  depth: number;
}

interface SavedRoute {
  id: string;
  name: string;
  datasetId: string;
  waypointCount: number;
  totalDistanceM: number;
  waypoints: RouteWaypoint[];
  createdAt: string;
}

const PANEL_STYLE: React.CSSProperties = {
  background: "rgba(2,8,18,0.94)",
  border: "1px solid rgba(0,229,255,0.22)",
  borderRadius: 6,
  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
  color: "#cbd5e1",
  fontSize: 12,
  minWidth: 230,
  maxWidth: 260,
  backdropFilter: "blur(6px)",
  pointerEvents: "auto",
};

const HEADER_BTN_STYLE: React.CSSProperties = {
  background: "none",
  border: "none",
  borderRadius: 0,
  cursor: "pointer",
  textAlign: "left",
  width: "100%",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "8px 10px",
};

const ACTION_BTN_STYLE: React.CSSProperties = {
  background: "rgba(0,229,255,0.08)",
  border: "1px solid rgba(0,229,255,0.35)",
  color: "#cbd5e1",
  cursor: "pointer",
  fontSize: 9,
  letterSpacing: "0.1em",
  padding: "2px 7px",
  borderRadius: 3,
  fontFamily: "inherit",
  whiteSpace: "nowrap",
};

const DELETE_BTN_STYLE: React.CSSProperties = {
  ...ACTION_BTN_STYLE,
  background: "rgba(248,113,113,0.08)",
  border: "1px solid rgba(248,113,113,0.35)",
  color: "#fca5a5",
};

function apiUrl(path: string): string {
  const base = (import.meta.env.BASE_URL as string).replace(/\/$/, "");
  return `${base}/api${path}`;
}

async function fetchRoutes(datasetId: string): Promise<SavedRoute[]> {
  const res = await fetch(apiUrl(`/routes?datasetId=${encodeURIComponent(datasetId)}`), {
    credentials: "include",
  });
  if (!res.ok) throw new Error(`Failed to fetch routes: ${res.status}`);
  return res.json() as Promise<SavedRoute[]>;
}

async function deleteRoute(id: string): Promise<void> {
  const res = await fetch(apiUrl(`/routes/${id}`), {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok && res.status !== 404) throw new Error(`Failed to delete route: ${res.status}`);
}

async function renameRoute(id: string, name: string): Promise<SavedRoute> {
  const res = await fetch(apiUrl(`/routes/${id}`), {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(`Failed to rename route: ${res.status}`);
  return res.json() as Promise<SavedRoute>;
}

export function routesQueryKey(datasetId: string) {
  return ["routes", datasetId] as const;
}

export const RoutesPanel: React.FC = () => {
  const { isSignedIn } = useUser();
  const { datasetId, terrain } = useAppState();
  const units = useSettingsStore((s) => s.units);
  const collapsed = usePanelCollapseStore((s) => s.collapsed["routes"]);
  const toggle = usePanelCollapseStore((s) => s.toggle);
  const qc = useQueryClient();

  const [flyingRouteId, setFlyingRouteId] = useState<string | null>(null);
  const isFlyActive = useFlyRouteStore((s) => s.active);

  useEffect(() => {
    if (!isFlyActive) setFlyingRouteId(null);
  }, [isFlyActive]);

  const { data: routes, isLoading } = useQuery<SavedRoute[]>({
    queryKey: datasetId ? routesQueryKey(datasetId) : ["routes", "__none__"],
    queryFn: () => fetchRoutes(datasetId!),
    enabled: !!isSignedIn && !!datasetId,
    staleTime: 30_000,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteRoute(id),
    onSuccess: () => {
      if (datasetId) {
        void qc.invalidateQueries({ queryKey: routesQueryKey(datasetId) });
      }
    },
  });

  const renameMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => renameRoute(id, name),
    onSuccess: () => {
      if (datasetId) {
        void qc.invalidateQueries({ queryKey: routesQueryKey(datasetId) });
      }
    },
  });

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  const loadRoute = (route: SavedRoute) => {
    if (!terrain || route.waypoints.length < 2) return;
    const store = useDepthProfileStore.getState();
    const zoneMap = useClassificationStore.getState().zoneMap;
    const result = buildPathProfile(terrain, route.waypoints, zoneMap);
    store.pushProfile(result);
  };

  const stopFly = () => {
    useFlyRouteStore.getState().stopFly();
    setFlyingRouteId(null);
  };

  const flyRoute = (route: SavedRoute) => {
    if (!terrain || route.waypoints.length < 1) return;
    if (flyingRouteId === route.id) {
      stopFly();
      return;
    }

    stopFly();
    setFlyingRouteId(route.id);

    const waypoints = route.waypoints.map((wp) => {
      const { x, z } = lonLatToWorldXZ(wp.lon, wp.lat, terrain);
      const y = depthMetresToWorldY(wp.depth, terrain) + 12;
      return { x, y, z };
    });

    useFlyRouteStore.getState().startFly(waypoints);
  };

  const startEditName = (route: SavedRoute) => {
    setEditingId(route.id);
    setEditName(route.name);
  };

  const commitRename = (id: string) => {
    const trimmed = editName.trim();
    if (trimmed) {
      renameMutation.mutate({ id, name: trimmed });
    }
    setEditingId(null);
  };

  const routeList = routes ?? [];

  return (
    <div data-testid="routes-panel" style={PANEL_STYLE}>
      <button
        type="button"
        onClick={() => toggle("routes")}
        aria-expanded={!collapsed}
        style={HEADER_BTN_STYLE}
      >
        <span style={{ fontSize: 11, letterSpacing: "0.2em", textTransform: "uppercase", color: "#00e5ff", textShadow: "0 0 6px rgba(0,229,255,0.5)", fontWeight: 700 }}>
          🛤 Routes {routeList.length > 0 ? `(${routeList.length})` : ""}
        </span>
        <span style={{ color: "#cbd5e1", fontSize: 22, lineHeight: 1 }}>
          {collapsed ? "▸" : "▾"}
        </span>
      </button>

      {!collapsed && (
        <div style={{ padding: "6px 10px 10px" }}>
          {!isSignedIn ? (
            <div style={{ fontSize: 10, color: "#94a3b8", textAlign: "center", padding: "8px 0" }}>
              Sign in to save and view routes.
            </div>
          ) : !datasetId ? (
            <div style={{ fontSize: 10, color: "#94a3b8" }}>
              Load a dataset to view routes.
            </div>
          ) : isLoading ? (
            <div style={{ fontSize: 10, color: "#94a3b8" }}>Loading…</div>
          ) : routeList.length === 0 ? (
            <div style={{ fontSize: 10, color: "#94a3b8" }}>
              No saved routes. Use the depth profile panel to save a path profile as a route.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {routeList.map((route) => {
                const distStr = formatDistance(route.totalDistanceM, { units });
                const isFlyingThis = flyingRouteId === route.id;

                return (
                  <div
                    key={route.id}
                    data-testid={`route-entry-${route.id}`}
                    style={{
                      background: "rgba(0,229,255,0.04)",
                      border: "1px solid rgba(0,229,255,0.14)",
                      borderRadius: 4,
                      padding: "6px 8px",
                    }}
                  >
                    {editingId === route.id ? (
                      <div style={{ marginBottom: 4 }}>
                        <input
                          autoFocus
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          onBlur={() => commitRename(route.id)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") commitRename(route.id);
                            if (e.key === "Escape") setEditingId(null);
                          }}
                          style={{
                            background: "rgba(0,10,20,0.8)",
                            border: "1px solid rgba(0,229,255,0.5)",
                            color: "#e2e8f0",
                            fontFamily: "inherit",
                            fontSize: 11,
                            padding: "2px 6px",
                            borderRadius: 3,
                            width: "100%",
                          }}
                        />
                      </div>
                    ) : (
                      <div
                        style={{ fontSize: 11, color: "#e2e8f0", marginBottom: 3, cursor: "pointer", wordBreak: "break-word" }}
                        title="Click to rename"
                        onClick={() => startEditName(route)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => { if (e.key === "Enter") startEditName(route); }}
                      >
                        {route.name}
                      </div>
                    )}

                    <div style={{ fontSize: 9, color: "#94a3b8", marginBottom: 5 }}>
                      {route.waypointCount} wpt · {distStr}
                    </div>

                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                      <button
                        type="button"
                        style={ACTION_BTN_STYLE}
                        aria-label={`Load route ${route.name}`}
                        disabled={!terrain}
                        onClick={() => loadRoute(route)}
                      >
                        LOAD
                      </button>
                      <button
                        type="button"
                        style={{
                          ...ACTION_BTN_STYLE,
                          background: isFlyingThis ? "rgba(250,204,21,0.15)" : ACTION_BTN_STYLE.background,
                          border: isFlyingThis ? "1px solid rgba(250,204,21,0.5)" : ACTION_BTN_STYLE.border as string,
                          color: isFlyingThis ? "#fde68a" : "#cbd5e1",
                        }}
                        aria-label={isFlyingThis ? "Stop flying route" : `Fly route ${route.name}`}
                        disabled={!terrain}
                        onClick={() => flyRoute(route)}
                      >
                        {isFlyingThis ? "◼ STOP" : "▶ FLY"}
                      </button>
                      <button
                        type="button"
                        style={{
                          ...DELETE_BTN_STYLE,
                          opacity: deleteMutation.isPending ? 0.5 : 1,
                          cursor: deleteMutation.isPending ? "not-allowed" : "pointer",
                        }}
                        aria-label={`Delete route ${route.name}`}
                        disabled={deleteMutation.isPending}
                        onClick={() => {
                          if (window.confirm(`Delete route "${route.name}"?`)) {
                            deleteMutation.mutate(route.id);
                          }
                        }}
                      >
                        DEL
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
