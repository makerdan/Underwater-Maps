import React from "react";
import { S } from "../styles";

export function Toggle({ value, onChange, "aria-label": ariaLabel }: { value: boolean; onChange: (v: boolean) => void; "aria-label"?: string }) {
  return (
    <div
      role="switch"
      aria-checked={value}
      aria-label={ariaLabel}
      onClick={() => onChange(!value)}
      style={S.toggle(value)}
      tabIndex={0}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onChange(!value)}
    >
      <div style={S.toggleKnob(value)} />
    </div>
  );
}

export function Select<T extends string>({
  value, onChange, options,
}: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      style={S.select}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}
