/**
 * ViewscreenTooltip — thin wrapper around the shadcn Tooltip primitive that
 * is gated on the `showUiTooltips` user preference.
 *
 * When the setting is OFF the wrapper simply returns its child unchanged so
 * no extra DOM/listeners are added to the viewscreen.
 *
 * A single <TooltipProvider> is mounted high in the viewscreen tree
 * (see App.tsx) so individual usages don't need their own provider.
 *
 * ── asChild contract ────────────────────────────────────────────────────────
 * `asChild` defaults to `true`. With asChild=true, Radix renders the
 * TooltipTrigger AS the child element (via the Slot primitive) rather than
 * wrapping it in an extra <button>. This is essential when the child is
 * already a <button> or <a> — without it the browser logs:
 *   "Warning: <button> cannot appear as a descendant of <button>"
 *
 * Rules for callers:
 *   • Child is a single <button>, <a>, or other focusable element
 *     → use the default (asChild=true). The trigger renders AS that element.
 *   • Child contains or IS another interactive element (e.g. HelpIcon which
 *     renders a <button>) → move the tooltip to the outermost interactive
 *     element only; keep HelpIcon as a sibling, not a descendant.
 *   • Child is a non-interactive element (e.g. <span>, <div>) inside a
 *     clickable ancestor → asChild=true still works; Radix merges only
 *     tooltip event handlers into the child, no extra DOM node is added.
 *   • Only use asChild={false} when the child genuinely cannot receive event
 *     handlers (e.g. a string or fragment) — in that case wrap it in a
 *     <span> first and leave asChild=true.
 * ────────────────────────────────────────────────────────────────────────────
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
