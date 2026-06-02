/**
 * Shared @react-three/fiber stub for vitest.
 *
 * Provides a minimal Canvas that renders children into a plain div,
 * plus no-op hooks (useThree, useFrame, extend) that satisfy type
 * checking without requiring a real WebGL context.
 *
 * Wire-up: __mocks__/@react-three/fiber.tsx re-exports this file so
 * that vi.mock("@react-three/fiber") (no factory) uses these stubs.
 *
 * Tests that need a test-specific useFrame callback capture (e.g.
 * zoneSettingsTerrainSync) or a real PerspectiveCamera (e.g.
 * useFlyControlsShortcut, useGpsFollowCamera) should keep their own
 * vi.mock factory — this shared stub is for the common case.
 */

import React from "react";

export const Canvas = ({
  children,
  ...rest
}: {
  children?: React.ReactNode;
  [key: string]: unknown;
}) =>
  React.createElement(
    "div",
    { "data-testid": "r3f-canvas-stub", ...rest },
    children,
  );

export const useThree = () => ({
  camera: {
    position: { set() {}, copy() {} },
    quaternion: { copy() {} },
    fov: 60,
  },
  gl: { domElement: typeof document !== "undefined" ? document.createElement("canvas") : null },
  scene: {},
  size: { width: 800, height: 600 },
});

export const useFrame = (_cb: unknown) => {};

export const extend = (_objects: unknown) => {};
