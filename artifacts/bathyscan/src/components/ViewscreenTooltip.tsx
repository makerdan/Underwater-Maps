/**
 * ViewscreenTooltip — thin wrapper around the shadcn Tooltip primitive that
 * is gated on the `showUiTooltips` user preference.
 *
 * When the setting is OFF the wrapper simply returns its child unchanged so
 * no extra DOM/listeners are added to the viewscreen.
 *
 * A single <TooltipProvider> is mounted high in the viewscreen tree
 * (see App.tsx) so individual usages don't need their own provider.
 */
import React from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useSettingsStore } from "@/lib/settingsStore";

export interface ViewscreenTooltipProps {
  /** Short, plain-language description (<= ~60 chars). */
  label: React.ReactNode;
  /** The interactive control / readout to annotate. */
  children: React.ReactElement;
  /** Preferred side for the tooltip, forwarded to Radix. */
  side?: "top" | "right" | "bottom" | "left";
  /** Tooltip alignment, forwarded to Radix. */
  align?: "start" | "center" | "end";
  /** Optional delay override (defaults to provider value). */
  delayDuration?: number;
  /** Render as <span> wrapper instead of asChild (for non-element children). */
  asChild?: boolean;
}

export const ViewscreenTooltip: React.FC<ViewscreenTooltipProps> = ({
  label,
  children,
  side = "top",
  align = "center",
  delayDuration,
  asChild = true,
}) => {
  const enabled = useSettingsStore((s) => s.showUiTooltips);
  if (!enabled || !label) return children;

  return (
    <Tooltip delayDuration={delayDuration}>
      <TooltipTrigger asChild={asChild}>{children}</TooltipTrigger>
      <TooltipContent side={side} align={align} className="font-mono text-[11px]">
        {label}
      </TooltipContent>
    </Tooltip>
  );
};
