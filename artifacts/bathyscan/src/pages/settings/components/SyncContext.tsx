import React, { useEffect, useRef, useState } from "react";
import {
  useSettingsStore,
  SECTION_KEYS,
  type SettingsSection,
} from "@/lib/settingsStore";
import { FONT } from "../styles";

export const SyncContext = React.createContext<{
  flush: () => Promise<void>;
  isSignedIn: boolean;
} | null>(null);

export function SectionSaveButton({
  section,
  sections: sectionsProp,
}: {
  section?: SettingsSection;
  sections?: SettingsSection[];
}) {
  const allSections: SettingsSection[] = sectionsProp ?? (section ? [section] : []);
  const dirty = useSettingsStore((s) => {
    const snap = s.syncedSnapshot ?? {};
    for (const sec of allSections) {
      for (const k of SECTION_KEYS[sec]) {
        if (!Object.is(
          (s as unknown as Record<string, unknown>)[k],
          (snap as Record<string, unknown>)[k],
        )) return true;
      }
    }
    return false;
  });
  const sectionKey = allSections[0] ?? "visuals";
  const ctx = React.useContext(SyncContext);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  useEffect(() => {
    if (dirty && status === "saved") setStatus("idle");
    if (!dirty && status === "error") {
      setStatus("idle");
      setErrMsg(null);
    }
  }, [dirty, status]);

  const onClick = async () => {
    if (!ctx) return;
    setStatus("saving");
    setErrMsg(null);
    try {
      await ctx.flush();
      const ts = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      setSavedAt(ts);
      setStatus("saved");
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setStatus("idle"), 3000);
    } catch (e) {
      setStatus("error");
      setErrMsg((e as Error)?.message || "Save failed");
    }
  };

  const isClean = !dirty && status !== "saving" && status !== "error";
  const disabled = status === "saving" || (!dirty && status !== "error");

  let label: string;
  if (status === "saving") label = "SAVING…";
  else if (status === "error") label = "RETRY SAVE";
  else if (status === "saved") label = savedAt ? `✓ SAVED ${savedAt}` : "✓ SAVED";
  else if (isClean) label = "✓ SAVED";
  else label = "SAVE";

  const isErrorStyle = status === "error";
  const isSavedStyle = isClean || status === "saved";

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      {status === "error" && errMsg && (
        <span
          data-testid={`save-section-${sectionKey}-error`}
          style={{ fontSize: 9, color: "#f87171", letterSpacing: "0.1em", userSelect: "text" }}
        >
          {errMsg}
        </span>
      )}
      <button
        data-testid={`save-section-${sectionKey}-btn`}
        data-state={status}
        data-dirty={dirty ? "true" : "false"}
        onClick={() => void onClick()}
        disabled={disabled}
        style={{
          background: isErrorStyle
            ? "rgba(239,68,68,0.08)"
            : isSavedStyle
              ? "rgba(74,222,128,0.06)"
              : "rgba(0,229,255,0.08)",
          border: `1px solid ${
            isErrorStyle
              ? "rgba(239,68,68,0.35)"
              : isSavedStyle
                ? "rgba(74,222,128,0.25)"
                : "rgba(0,229,255,0.3)"
          }`,
          borderRadius: 3,
          color: isErrorStyle ? "#f87171" : isSavedStyle ? "#4ade80" : "#67e8f9",
          fontSize: 9,
          letterSpacing: "0.15em",
          padding: "3px 10px",
          cursor: disabled ? "default" : "pointer",
          fontFamily: FONT,
          opacity: status === "saving" ? 0.7 : 1,
        }}
      >
        {label}
      </button>
    </div>
  );
}

export function SectionActionsRow({
  section,
  sections: sectionsProp,
  withReset = true,
  withSave = true,
}: {
  section?: SettingsSection;
  sections?: SettingsSection[];
  withReset?: boolean;
  withSave?: boolean;
}) {
  const allSections: SettingsSection[] = sectionsProp ?? (section ? [section] : []);
  const resetSection = useSettingsStore((s) => s.resetSection);
  const resetKey = allSections[0] ?? "visuals";
  return (
    <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginBottom: 8 }}>
      {withReset && (
        <button
          onClick={() => allSections.forEach((sec) => resetSection(sec))}
          data-testid={`reset-section-${resetKey}-btn`}
          style={{
            background: "none",
            border: "1px solid rgba(0,229,255,0.15)",
            borderRadius: 3,
            color: "#cbd5e1",
            fontSize: 9,
            letterSpacing: "0.15em",
            padding: "3px 10px",
            cursor: "pointer",
            fontFamily: FONT,
          }}
        >
          RESET SECTION
        </button>
      )}
      {withSave && <SectionSaveButton sections={allSections} />}
    </div>
  );
}

export function SectionResetRow({ section }: { section: SettingsSection }) {
  return <SectionActionsRow section={section} withSave={false} />;
}
