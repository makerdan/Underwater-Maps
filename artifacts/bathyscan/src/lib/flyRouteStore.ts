import { create } from "zustand";

export interface FlyWaypoint {
  x: number;
  y: number;
  z: number;
}

interface FlyRouteState {
  waypoints: FlyWaypoint[];
  currentTargetIndex: number;
  active: boolean;
  startFly: (waypoints: FlyWaypoint[]) => void;
  stopFly: () => void;
  nextWaypoint: () => void;
}

export const useFlyRouteStore = create<FlyRouteState>((set, get) => ({
  waypoints: [],
  currentTargetIndex: 0,
  active: false,

  startFly: (waypoints) => {
    if (waypoints.length === 0) return;
    set({ waypoints, currentTargetIndex: 0, active: true });
  },

  stopFly: () => {
    set({ active: false, waypoints: [], currentTargetIndex: 0 });
  },

  nextWaypoint: () => {
    const { waypoints, currentTargetIndex } = get();
    if (currentTargetIndex + 1 < waypoints.length) {
      set({ currentTargetIndex: currentTargetIndex + 1 });
    } else {
      set({ active: false, waypoints: [], currentTargetIndex: 0 });
    }
  },
}));
