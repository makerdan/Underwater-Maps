/**
 * VirtualJoystick — touch-only floating joystick overlay for mobile fly controls.
 *
 * Only renders on touch devices. Uses two touch zones:
 *  - Left half: movement (WASD equivalent)
 *  - Right half: look (mouse drag equivalent)
 *
 * Writes normalised [-1,1] values to joystickStore which useFlyControls reads.
 *
 * Props:
 *  - forceVisible: render even on non-touch devices (e.g. in Settings preview)
 *  - showInOrbit: also render while a two-finger touch orbit gesture is active
 *    (reads isOrbitingTouch from cameraStore; requires actual touch device)
 */
import React, { useEffect, useRef } from "react";
import { create } from "zustand";
import { useCameraStore } from "@/lib/cameraStore";

// ---------------------------------------------------------------------------
// Shared joystick state — read by useFlyControls via getState()
// ---------------------------------------------------------------------------
interface JoystickStore {
  moveX: number;
  moveY: number;
  lookX: number;
  lookY: number;
}

export const useJoystickStore = create<JoystickStore>(() => ({
  moveX: 0,
  moveY: 0,
  lookX: 0,
  lookY: 0,
}));

// ---------------------------------------------------------------------------
// Simple touch-drag joystick (no external library required)
// ---------------------------------------------------------------------------
interface TouchState {
  id: number;
  startX: number;
  startY: number;
  curX: number;
  curY: number;
  zone: "left" | "right";
}

const RADIUS = 50;

export const VirtualJoystick: React.FC<{ forceVisible?: boolean; showInOrbit?: boolean }> = ({
  forceVisible = false,
  showInOrbit = false,
}) => {
  // Actual device capability — gates event listener registration.
  const isActualTouchDevice =
    typeof window !== "undefined" &&
    ("ontouchstart" in window || navigator.maxTouchPoints > 0);

  // Whether touch orbit is currently active (two fingers on the screen).
  const isOrbitingTouch = useCameraStore((s) => s.isOrbitingTouch);

  // Event listeners register when we're on a real touch device or force mode.
  const shouldRegisterListeners = forceVisible || isActualTouchDevice;

  // Render whenever listeners are active, OR when the showInOrbit option is
  // set and the user actually has two fingers down performing a touch orbit.
  const shouldRender = shouldRegisterListeners || (showInOrbit && isOrbitingTouch);

  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const touches = useRef<Map<number, TouchState>>(new Map());
  const leftPos = useRef({ x: 0, y: 0 });
  const rightPos = useRef({ x: 0, y: 0 });

  useEffect(() => {
    if (!shouldRegisterListeners) return;

    const updateStore = () => {
      let moveX = 0, moveY = 0, lookX = 0, lookY = 0;
      for (const t of touches.current.values()) {
        const dx = Math.max(-RADIUS, Math.min(RADIUS, t.curX - t.startX)) / RADIUS;
        const dy = Math.max(-RADIUS, Math.min(RADIUS, t.curY - t.startY)) / RADIUS;
        if (t.zone === "left") { moveX = dx; moveY = dy; }
        else { lookX = dx; lookY = dy; }
      }
      useJoystickStore.setState({ moveX, moveY, lookX, lookY });
    };

    const getNub = (container: HTMLDivElement): HTMLElement | null =>
      (container.children[1] as HTMLElement | null) ?? null;

    const updateNub = (id: number) => {
      const t = touches.current.get(id);
      if (!t) return;
      const dx = Math.max(-RADIUS, Math.min(RADIUS, t.curX - t.startX));
      const dy = Math.max(-RADIUS, Math.min(RADIUS, t.curY - t.startY));
      if (t.zone === "left" && leftRef.current) {
        leftPos.current = { x: t.startX + dx, y: t.startY + dy };
        const nub = getNub(leftRef.current);
        if (nub) Object.assign(nub.style, { left: `${leftPos.current.x - 22}px`, top: `${leftPos.current.y - 22}px` });
      } else if (t.zone === "right" && rightRef.current) {
        rightPos.current = { x: t.startX + dx, y: t.startY + dy };
        const nub = getNub(rightRef.current);
        if (nub) Object.assign(nub.style, { left: `${rightPos.current.x - 22}px`, top: `${rightPos.current.y - 22}px` });
      }
    };

    const resetNub = (zone: "left" | "right") => {
      const container = zone === "left" ? leftRef.current : rightRef.current;
      if (container) {
        const el = getNub(container);
        if (el) Object.assign(el.style, { left: "28px", top: "28px" });
      }
    };

    const onStart = (e: TouchEvent) => {
      const w = window.innerWidth;
      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];
        if (!touch) continue;
        const zone: "left" | "right" = touch.clientX < w / 2 ? "left" : "right";
        touches.current.set(touch.identifier, {
          id: touch.identifier,
          startX: touch.clientX,
          startY: touch.clientY,
          curX: touch.clientX,
          curY: touch.clientY,
          zone,
        });
      }
    };

    const onMove = (e: TouchEvent) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];
        if (!touch) continue;
        const t = touches.current.get(touch.identifier);
        if (!t) continue;
        t.curX = touch.clientX;
        t.curY = touch.clientY;
        updateNub(touch.identifier);
      }
      if (touches.current.size > 0) {
        e.preventDefault();
      }
      updateStore();
    };

    const onEnd = (e: TouchEvent) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];
        if (!touch) continue;
        const t = touches.current.get(touch.identifier);
        if (t) {
          resetNub(t.zone);
          touches.current.delete(touch.identifier);
        }
      }
      updateStore();
    };

    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onEnd, { passive: true });
    window.addEventListener("touchcancel", onEnd, { passive: true });

    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove, { passive: false } as EventListenerOptions);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
    };
  }, [shouldRegisterListeners]);

  if (!shouldRender) return null;

  const baseStyle: React.CSSProperties = {
    position: "absolute",
    width: 100,
    height: 100,
    borderRadius: "50%",
    background: "rgba(148,163,184,0.12)",
    border: "1.5px solid rgba(148,163,184,0.35)",
    pointerEvents: "none",
  };

  const nubStyle: React.CSSProperties = {
    position: "absolute",
    width: 44,
    height: 44,
    left: 28,
    top: 28,
    borderRadius: "50%",
    background: "rgba(0,229,255,0.45)",
    border: "1.5px solid rgba(0,229,255,0.7)",
    transition: "none",
    pointerEvents: "none",
  };

  return (
    <>
      {/* Left joystick — move */}
      <div
        style={{
          position: "absolute",
          left: 20,
          bottom: 80,
          pointerEvents: "none",
        }}
      >
        <div ref={leftRef} style={{ position: "relative", width: 100, height: 100 }}>
          <div style={baseStyle} />
          <div style={nubStyle} />
        </div>
        <div style={{ textAlign: "center", color: "rgba(148,163,184,0.5)", fontSize: "calc(13.5px * var(--bs-font-scale, 1))", marginTop: 4, fontFamily: "monospace" }}>
          MOVE
        </div>
      </div>

      {/* Right joystick — look */}
      <div
        style={{
          position: "absolute",
          right: 20,
          bottom: 80,
          pointerEvents: "none",
        }}
      >
        <div ref={rightRef} style={{ position: "relative", width: 100, height: 100 }}>
          <div style={baseStyle} />
          <div style={nubStyle} />
        </div>
        <div style={{ textAlign: "center", color: "rgba(148,163,184,0.5)", fontSize: "calc(13.5px * var(--bs-font-scale, 1))", marginTop: 4, fontFamily: "monospace" }}>
          LOOK
        </div>
      </div>
    </>
  );
};
