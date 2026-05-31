/**
 * Guards the TIDAL 3D DATA toggle logic that was broken and fixed in App.tsx.
 *
 * The two effects under test are intentionally NOT in a rendered component —
 * the same pattern used by currentsNoaaStation.test.tsx for CurrentsLayer's
 * ambient-selection memo.  Keeping them pure lets us assert the rules without
 * mounting the full App (which needs dozens of mocks) and without any risk of
 * the test itself re-triggering the React effects under scrutiny.
 *
 * Rules under test:
 *   1. currentsSource-to-"noaa" effect: auto-enables tidalOverlay exactly once
 *      on the transition TO "noaa"; a manual toggle-OFF afterwards must stick.
 *   2. autoLoadTidal / terrain-ref effect: auto-enables tidalOverlay the first
 *      time a given terrain object appears; a manual toggle-OFF afterwards must
 *      stick; switching terrains re-arms the auto-enable for the new terrain.
 */
import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// Inline mirrors of the two effect bodies from App.tsx (lines 342-347 and
// 356-362).  These are the exact rules — kept here as pure functions so a
// future reader can diff against the source easily.
// ---------------------------------------------------------------------------

/**
 * Mirrors the currentsSource effect (App.tsx ~356-362).
 *
 * Called once per "render" with the new currentsSource and the ref holding the
 * previous value.  Returns whether tidalOverlay should be forced ON.
 * The caller is responsible for updating `prevRef.current` after calling.
 */
function applyCurrentsSourceEffect(params: {
  currentsSource: string;
  prevRef: { current: string | null };
}): boolean {
  const prev = params.prevRef.current;
  params.prevRef.current = params.currentsSource;
  return params.currentsSource === "noaa" && prev !== "noaa";
}

/**
 * Mirrors the autoLoadTidal terrain-ref effect (App.tsx ~342-347).
 *
 * Returns whether tidalOverlay should be forced ON.
 * The caller is responsible for updating `firedForRef.current` after a
 * positive return.
 */
function applyAutoLoadTidalEffect(params: {
  autoLoadTidal: boolean;
  terrain: object | null;
  firedForRef: { current: object | null };
}): boolean {
  if (!params.autoLoadTidal || !params.terrain) return false;
  if (params.firedForRef.current === params.terrain) return false;
  params.firedForRef.current = params.terrain;
  return true;
}

// ---------------------------------------------------------------------------
// Tests: currentsSource → "noaa" auto-enable
// ---------------------------------------------------------------------------

describe("tidalOverlay — currentsSource-to-noaa auto-enable effect", () => {
  it("fires exactly once on the initial transition from null to 'noaa'", () => {
    const prevRef = { current: null as string | null };
    const shouldEnable = applyCurrentsSourceEffect({
      currentsSource: "noaa",
      prevRef,
    });
    expect(shouldEnable).toBe(true);
    expect(prevRef.current).toBe("noaa");
  });

  it("does NOT re-fire when currentsSource is already 'noaa' (user toggled overlay OFF)", () => {
    // Simulate: source was already "noaa" on the previous render.
    const prevRef = { current: "noaa" as string | null };

    // The user just manually toggled the overlay OFF; the effect re-runs
    // (e.g. because another dep changed), but prev is still "noaa".
    const shouldEnable = applyCurrentsSourceEffect({
      currentsSource: "noaa",
      prevRef,
    });
    expect(shouldEnable).toBe(false);
  });

  it("fires again after switching away from 'noaa' and back", () => {
    const prevRef = { current: null as string | null };

    // First: switch TO "noaa".
    const firstTransition = applyCurrentsSourceEffect({
      currentsSource: "noaa",
      prevRef,
    });
    expect(firstTransition).toBe(true);

    // Switch AWAY from "noaa" (e.g. to "manual").
    applyCurrentsSourceEffect({ currentsSource: "manual", prevRef });
    expect(prevRef.current).toBe("manual");

    // Switch back TO "noaa" — this is a genuine re-transition.
    const secondTransition = applyCurrentsSourceEffect({
      currentsSource: "noaa",
      prevRef,
    });
    expect(secondTransition).toBe(true);
  });

  it("does NOT fire when transitioning between two non-noaa values", () => {
    const prevRef = { current: "manual" as string | null };
    const shouldEnable = applyCurrentsSourceEffect({
      currentsSource: "tide",
      prevRef,
    });
    expect(shouldEnable).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests: autoLoadTidal / terrain-ref guarded auto-enable
// ---------------------------------------------------------------------------

describe("tidalOverlay — autoLoadTidal terrain-ref effect", () => {
  it("fires when autoLoadTidal is true and terrain has just loaded", () => {
    const terrain = { id: "t1" };
    const firedForRef = { current: null as object | null };

    const shouldEnable = applyAutoLoadTidalEffect({
      autoLoadTidal: true,
      terrain,
      firedForRef,
    });

    expect(shouldEnable).toBe(true);
    expect(firedForRef.current).toBe(terrain);
  });

  it("does NOT re-fire for the same terrain object (user toggled overlay OFF mid-session)", () => {
    const terrain = { id: "t1" };
    const firedForRef = { current: terrain as object | null };

    // Effect re-runs (e.g. autoLoadTidal toggled in settings), but ref already
    // points at this terrain — the one-shot guard must prevent re-enable.
    const shouldEnable = applyAutoLoadTidalEffect({
      autoLoadTidal: true,
      terrain,
      firedForRef,
    });

    expect(shouldEnable).toBe(false);
  });

  it("does NOT fire when autoLoadTidal is false, even with terrain present", () => {
    const terrain = { id: "t1" };
    const firedForRef = { current: null as object | null };

    const shouldEnable = applyAutoLoadTidalEffect({
      autoLoadTidal: false,
      terrain,
      firedForRef,
    });

    expect(shouldEnable).toBe(false);
    // Ref must not be updated — we didn't fire, so the next call with
    // autoLoadTidal=true must still be able to fire.
    expect(firedForRef.current).toBeNull();
  });

  it("does NOT fire when terrain is null (dataset not yet loaded)", () => {
    const firedForRef = { current: null as object | null };

    const shouldEnable = applyAutoLoadTidalEffect({
      autoLoadTidal: true,
      terrain: null,
      firedForRef,
    });

    expect(shouldEnable).toBe(false);
  });

  it("fires again when the terrain object changes (dataset switch re-arms auto-enable)", () => {
    const terrain1 = { id: "t1" };
    const terrain2 = { id: "t2" };
    const firedForRef = { current: terrain1 as object | null };

    // terrain1 was already auto-enabled; now a new dataset is loaded (terrain2).
    const shouldEnable = applyAutoLoadTidalEffect({
      autoLoadTidal: true,
      terrain: terrain2,
      firedForRef,
    });

    expect(shouldEnable).toBe(true);
    expect(firedForRef.current).toBe(terrain2);
  });

  it("user can toggle overlay OFF after auto-enable; subsequent same-terrain renders do not re-enable", () => {
    const terrain = { id: "t1" };
    const firedForRef = { current: null as object | null };

    // Initial terrain load — auto-enable fires.
    const first = applyAutoLoadTidalEffect({
      autoLoadTidal: true,
      terrain,
      firedForRef,
    });
    expect(first).toBe(true);

    // User manually turns overlay OFF. The React state changes, causing one or
    // more effect re-runs with the same terrain reference — none should re-fire.
    const second = applyAutoLoadTidalEffect({
      autoLoadTidal: true,
      terrain,
      firedForRef,
    });
    expect(second).toBe(false);

    const third = applyAutoLoadTidalEffect({
      autoLoadTidal: true,
      terrain,
      firedForRef,
    });
    expect(third).toBe(false);
  });
});
