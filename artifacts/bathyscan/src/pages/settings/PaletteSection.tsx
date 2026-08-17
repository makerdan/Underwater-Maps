import React from "react";
import { PaletteSuggestionBanner } from "@/components/PaletteSuggestionBanner";
import { SectionTitle } from "./components/SectionTitle";
import { SectionActionsRow } from "./components/SyncContext";
import { DepthColorsCard } from "./components/DepthColorsCard";

export function PaletteSection() {
  return (
    <>
      <SectionTitle helpId="settings" helpLabel="Depth Banding: Color Palettes">◈ DEPTH COLOR PALETTE</SectionTitle>
      <SectionActionsRow section="palette" />
      <PaletteSuggestionBanner />
      <DepthColorsCard />
    </>
  );
}
