/**
 * Shared @react-three/drei stub for vitest.
 *
 * Stubs the drei components used by BathyScan scene components
 * (Billboard, Line, Text) so that tests can import scene modules
 * without a real WebGL context.
 *
 * Wire-up: __mocks__/@react-three/drei.tsx re-exports this file so
 * that vi.mock("@react-three/drei") (no factory) uses these stubs.
 */

import React from "react";

export const Billboard = ({
  children,
}: {
  children?: React.ReactNode;
}) => children ?? null;

export const Line = () => null;

export const Text = () => null;
