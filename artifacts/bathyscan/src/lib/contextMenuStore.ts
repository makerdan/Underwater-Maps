import { create } from "zustand";

export interface ContextMenuItem {
  label: string;
  icon?: string;
  onClick: () => void;
  separator?: boolean;
  disabled?: boolean;
  /** Item is processing (e.g. delete pending/in-flight). Renders dimmed with a spinner; click is suppressed. */
  pending?: boolean;
}

interface ContextMenuStore {
  open: boolean;
  x: number;
  y: number;
  items: ContextMenuItem[];
  show: (x: number, y: number, items: ContextMenuItem[]) => void;
  hide: () => void;
}

export const useContextMenuStore = create<ContextMenuStore>((set) => ({
  open: false,
  x: 0,
  y: 0,
  items: [],
  show: (x, y, items) => set({ open: true, x, y, items }),
  hide: () => set({ open: false, items: [] }),
}));
