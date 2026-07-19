/**
 * OnboardingOverlay — first-time guided tour for new BathyScan users.
 *
 * Shows a 5-step modal walking through the core actions:
 *   1. Find data near you (or load the demo)
 *   2. Orbit / fly the scene
 *   3. Drop a marker
 *   4. Toggle an overlay
 *   5. Open the AI assistant
 *
 * Renders only when `!hasSeenOnboarding`. On "Done" or "Skip", sets
 * `hasSeenOnboarding` to true so the tour never auto-appears again.
 * The "Replay tour" button in Settings (and the link in the Help window)
 * reset the flag to false, making the overlay reappear.
 */
import React, { useCallback, useEffect, useState } from "react";
import { useSettingsStore } from "@/lib/settingsStore";
import { useUiStore } from "@/lib/uiStore";
import { requestDatasetSwitch } from "@/lib/simulatedDataStore";
import { useAppState } from "@/lib/context";
import { flushServerSync } from "@/hooks/useServerSettingsSync";

/** Catalog ID for the built-in Lake Ray Roberts demo dataset. */
const DEMO_DATASET_ID = "lake-ray-roberts";
const DEMO_DATASET_NAME = "Lake Ray Roberts (TX)";

const FONT = "'JetBrains Mono', 'Fira Code', monospace";

interface Step {
  title: string;
  description: string;
  /** Approximate region of the UI this step refers to. */
  region: "left" | "center" | "top-right" | "top-right-mid" | "bottom-center";
  icon: string;
}

const STEPS: Step[] = [
  {
    title: "Find data near you",
    description:
      "Search for bathymetric surveys near your location or by place name. Use the buttons below to open the search panel, or load the demo dataset to explore the viewer right away.",
    region: "left",
    icon: "◉",
  },
  {
    title: "Orbit & fly",
    description:
      "Click and drag to look around. Use W/A/S/D (or arrow keys) to move the camera. Scroll or use Q/E to rise and dive. Right-click drag orbits around a point.",
    region: "center",
    icon: "✦",
  },
  {
    title: "Drop a marker",
    description:
      "Right-click anywhere on the seafloor to open the context menu and place a marker. Add a label, category, and private notes to any spot of interest.",
    region: "center",
    icon: "◈",
  },
  {
    title: "Toggle overlays",
    description:
      'Use the 🌐 TIDAL 3D toggle in the Explore tab\u2019s Overlays panel (left sidebar) to enable current and water-level overlays. The same panel lets you layer wind, current-speed, and habitat data.',
    region: "left",
    icon: "◎",
  },
  {
    title: "Ask the AI assistant",
    description:
      'Press "/" or click the "/ QUERY" button at the bottom of the screen to open the natural-language assistant. Ask questions like "What fish are at this depth?"',
    region: "bottom-center",
    icon: "⟡",
  },
];

/**
 * Arrow pointing from the modal toward the relevant UI region.
 * Returns a CSS transform + position style for the arrow indicator.
 */
function ArrowIndicator({ region }: { region: Step["region"] }) {
  const arrowStyle: React.CSSProperties = {
    position: "absolute",
    fontSize: 33,
    color: "#00e5ff",
    textShadow: "0 0 10px rgba(0,229,255,0.8)",
    animation: "bs-onboard-pulse 1.4s ease-in-out infinite",
    pointerEvents: "none",
    userSelect: "none",
  };

  if (region === "left") {
    return (
      <div style={{ ...arrowStyle, left: -40, top: "50%", transform: "translateY(-50%)" }}>
        ◂
      </div>
    );
  }
  if (region === "top-right" || region === "top-right-mid") {
    return (
      <div style={{ ...arrowStyle, right: -40, top: "50%", transform: "translateY(-50%)" }}>
        ▸
      </div>
    );
  }
  if (region === "bottom-center") {
    return (
      <div style={{ ...arrowStyle, bottom: -40, left: "50%", transform: "translateX(-50%)" }}>
        ▾
      </div>
    );
  }
  return null;
}

interface OnboardingOverlayProps {
  /**
   * When true, the overlay hides itself without unmounting. This preserves
   * the current step in component state so a WebGL context-loss recovery
   * (which briefly sets contextLost=true then restores) cannot reset the tour
   * back to step 1.
   */
  suppressed?: boolean;
}

export function OnboardingOverlay({ suppressed = false }: OnboardingOverlayProps) {
  const hasSeenOnboarding = useSettingsStore((s) => s.hasSeenOnboarding);
  const setHasSeenOnboarding = useSettingsStore((s) => s.setHasSeenOnboarding);
  const setFindDataPanelOpen = useUiStore((s) => s.setFindDataPanelOpen);
  const { setDatasetId } = useAppState();

  const [step, setStep] = useState(0);
  const [visible, setVisible] = useState(true);

  const dismiss = useCallback(() => {
    setHasSeenOnboarding(true);
    void flushServerSync();
  }, [setHasSeenOnboarding]);

  const handleSkip = useCallback(() => {
    dismiss();
  }, [dismiss]);

  const handleDone = useCallback(() => {
    dismiss();
  }, [dismiss]);

  const handleNext = useCallback(() => {
    if (step < STEPS.length - 1) {
      setStep((s) => s + 1);
    } else {
      handleDone();
    }
  }, [step, handleDone]);

  /** Step 1 primary CTA: open Find Data panel and dismiss the tour. */
  const handleOpenFindData = useCallback(() => {
    dismiss();
    setFindDataPanelOpen(true);
  }, [dismiss, setFindDataPanelOpen]);

  /** Step 1 secondary CTA: load the demo dataset and dismiss the tour. */
  const handleLoadDemo = useCallback(() => {
    dismiss();
    void requestDatasetSwitch({
      datasetId: DEMO_DATASET_ID,
      datasetName: DEMO_DATASET_NAME,
      onConfirm: () => {
        setDatasetId(DEMO_DATASET_ID);
      },
    });
  }, [dismiss, setDatasetId]);

  const handleBack = useCallback(() => {
    setStep((s) => Math.max(0, s - 1));
  }, []);

  // Keyboard: Escape = skip, ArrowRight / Enter = next, ArrowLeft = back
  useEffect(() => {
    if (hasSeenOnboarding) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleSkip();
      if (e.key === "ArrowRight" || e.key === "Enter") handleNext();
      if (e.key === "ArrowLeft") handleBack();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [hasSeenOnboarding, handleSkip, handleNext, handleBack]);

  // Animate in when step changes
  useEffect(() => {
    setVisible(false);
    const t = setTimeout(() => setVisible(true), 60);
    return () => clearTimeout(t);
  }, [step]);

  if (hasSeenOnboarding) return null;

  // During WebGL context loss/recovery the parent passes suppressed=true so
  // we hide without unmounting — preserving `step` in component state.
  // This prevents the tour from restarting at step 1 after a context restore.
  if (suppressed) return null;

  const current = STEPS[step]!;
  const isLast = step === STEPS.length - 1;

  return (
    <>
      {/* Inject keyframe animation once */}
      <style>{`
        @keyframes bs-onboard-pulse {
          0%, 100% { opacity: 1; transform: translateY(-50%) scale(1); }
          50% { opacity: 0.5; transform: translateY(-50%) scale(1.25); }
        }
        @keyframes bs-onboard-fadein {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      {/* Backdrop */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 9000,
          background: "rgba(2,8,20,0.72)",
          backdropFilter: "blur(2px)",
        }}
        onClick={handleSkip}
        aria-hidden="true"
      />

      {/* Modal card */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="BathyScan guided tour"
        aria-live="polite"
        style={{
          position: "fixed",
          zIndex: 9001,
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: 420,
          maxWidth: "calc(100vw - 32px)",
          background: "rgba(4,12,28,0.97)",
          border: "1px solid rgba(0,229,255,0.28)",
          borderRadius: 10,
          boxShadow: "0 20px 60px rgba(0,0,0,0.7), 0 0 40px rgba(0,229,255,0.06)",
          fontFamily: FONT,
          color: "#e2e8f0",
          overflow: "visible",
          animation: "bs-onboard-fadein 0.2s ease",
          opacity: visible ? 1 : 0,
          transition: "opacity 0.12s ease",
        }}
      >
        {/* Arrow pointing toward the highlighted UI area */}
        <ArrowIndicator region={current.region} />

        {/* Header */}
        <div
          style={{
            padding: "14px 18px 0 18px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span
            style={{
              fontSize: 13.5,
              letterSpacing: "0.28em",
              color: "#00e5ff",
              fontWeight: 700,
              textShadow: "0 0 6px rgba(0,229,255,0.4)",
            }}
          >
            GUIDED TOUR — STEP {step + 1} OF {STEPS.length}
          </span>
          <button
            type="button"
            onClick={handleSkip}
            aria-label="Skip tour"
            style={{
              background: "none",
              border: "none",
              color: "#64748b",
              fontSize: 15,
              letterSpacing: "0.15em",
              cursor: "pointer",
              fontFamily: FONT,
              padding: "2px 4px",
            }}
          >
            SKIP
          </button>
        </div>

        {/* Progress bar */}
        <div
          style={{
            margin: "10px 18px 0",
            height: 2,
            background: "rgba(0,229,255,0.12)",
            borderRadius: 1,
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${((step + 1) / STEPS.length) * 100}%`,
              background: "#00e5ff",
              borderRadius: 1,
              boxShadow: "0 0 6px rgba(0,229,255,0.5)",
              transition: "width 0.25s ease",
            }}
          />
        </div>

        {/* Body */}
        <div style={{ padding: "20px 18px" }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 14, marginBottom: 14 }}>
            <span
              style={{
                fontSize: 42,
                lineHeight: 1,
                color: "#00e5ff",
                textShadow: "0 0 12px rgba(0,229,255,0.5)",
                flexShrink: 0,
                marginTop: 2,
              }}
            >
              {current.icon}
            </span>
            <div>
              <div
                style={{
                  fontSize: 19.5,
                  fontWeight: 700,
                  letterSpacing: "0.1em",
                  color: "#ffffff",
                  marginBottom: 8,
                  textShadow: "0 0 8px rgba(255,255,255,0.15)",
                }}
              >
                {current.title}
              </div>
              <div
                style={{
                  fontSize: 16.5,
                  lineHeight: 1.65,
                  color: "#cbd5e1",
                  letterSpacing: "0.02em",
                }}
              >
                {current.description}
              </div>
            </div>
          </div>

          {/* Step 1 action buttons — primary: open Find Data; secondary: try demo */}
          {step === 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
              <button
                type="button"
                data-testid="onboarding-open-find-data-btn"
                onClick={handleOpenFindData}
                style={{
                  width: "100%",
                  background: "rgba(0,229,255,0.14)",
                  border: "1px solid rgba(0,229,255,0.45)",
                  borderRadius: 5,
                  color: "#00e5ff",
                  fontSize: 14,
                  fontWeight: 700,
                  letterSpacing: "0.18em",
                  padding: "10px 0",
                  cursor: "pointer",
                  fontFamily: FONT,
                  textShadow: "0 0 6px rgba(0,229,255,0.4)",
                }}
              >
                ◉ OPEN FIND DATA →
              </button>
              <button
                type="button"
                data-testid="onboarding-load-demo-btn"
                onClick={handleLoadDemo}
                style={{
                  width: "100%",
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 5,
                  color: "#94a3b8",
                  fontSize: 13,
                  letterSpacing: "0.12em",
                  padding: "8px 0",
                  cursor: "pointer",
                  fontFamily: FONT,
                }}
              >
                Try demo: Lake Ray Roberts, TX →
              </button>
            </div>
          )}

          {/* Step dots */}
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              gap: 6,
              marginBottom: 18,
              marginTop: 4,
            }}
          >
            {STEPS.map((_, i) => (
              <button
                key={i}
                type="button"
                aria-label={`Go to step ${i + 1}`}
                onClick={() => setStep(i)}
                style={{
                  width: i === step ? 18 : 7,
                  height: 7,
                  borderRadius: 4,
                  background: i === step ? "#00e5ff" : "rgba(0,229,255,0.2)",
                  border: "none",
                  cursor: "pointer",
                  padding: 0,
                  transition: "width 0.2s ease, background 0.2s ease",
                  boxShadow: i === step ? "0 0 6px rgba(0,229,255,0.5)" : "none",
                }}
              />
            ))}
          </div>

          {/* Navigation buttons */}
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={handleBack}
              disabled={step === 0}
              style={{
                flex: 1,
                background: "rgba(0,229,255,0.05)",
                border: "1px solid rgba(0,229,255,0.15)",
                borderRadius: 4,
                color: step === 0 ? "#334155" : "#94a3b8",
                fontSize: 13.5,
                letterSpacing: "0.2em",
                padding: "9px 0",
                cursor: step === 0 ? "default" : "pointer",
                fontFamily: FONT,
                transition: "color 0.1s, background 0.1s",
              }}
            >
              ← BACK
            </button>
            <button
              type="button"
              onClick={handleNext}
              autoFocus
              style={{
                flex: 2,
                background: "rgba(0,229,255,0.12)",
                border: "1px solid rgba(0,229,255,0.35)",
                borderRadius: 4,
                color: "#00e5ff",
                fontSize: 13.5,
                letterSpacing: "0.2em",
                padding: "9px 0",
                cursor: "pointer",
                fontFamily: FONT,
                fontWeight: 700,
                textShadow: "0 0 6px rgba(0,229,255,0.4)",
                transition: "background 0.1s",
              }}
            >
              {isLast ? "DONE ✓" : "NEXT →"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
