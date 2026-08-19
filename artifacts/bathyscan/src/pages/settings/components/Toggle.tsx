import React from "react";
import { S } from "../styles";

export function Toggle({ value, onChange, "aria-label": ariaLabel }: { value: boolean; onChange: (v: boolean) => void; "aria-label"?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      aria-label={ariaLabel}
      onClick={() => onChange(!value)}
      style={S.toggleTarget}
    >
      <span aria-hidden="true" style={S.toggle(value)}>
        <span style={S.toggleKnob(value)} />
      </span>
    </button>
  );
}

export function Select<T extends string>({
  value, onChange, options, id,
}: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; id?: string }) {
  return (
    <select
      id={id}
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
