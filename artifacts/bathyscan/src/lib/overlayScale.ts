/**
 * Central overlay contract. Keep these values separated so visibility is
 * determined by the layer's purpose, never by React mount order.
 */
export const OVERLAY_Z = {
  banner: 60,
  drawer: 100,
  contextMenu: 300,
  dialog: 9000,
  loader: 9100,
  toast: 9200,
} as const;

export type OverlayFamily = keyof typeof OVERLAY_Z;