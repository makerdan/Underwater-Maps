import React from "react";
import { useHelpStore } from "@/lib/helpStore";

export const HelpButton: React.FC = () => {
  const open = useHelpStore((s) => s.open);
  const openHelp = useHelpStore((s) => s.openHelp);
  const closeHelp = useHelpStore((s) => s.closeHelp);

  return (
    <button
      type="button"
      onClick={() => (open ? closeHelp() : openHelp())}
      aria-pressed={open}
      aria-label="Open help"
      title="Help (articles, search, and AI Q&A)"
      data-testid="help-button"
      className="help-launch-btn"
    >
      <span className="help-launch-glyph">?</span>
      <span className="help-launch-text">HELP</span>
    </button>
  );
};

interface HelpIconProps {
  articleId: string;
  label?: string;
}

export const HelpIcon: React.FC<HelpIconProps> = ({ articleId, label }) => {
  const openHelp = useHelpStore((s) => s.openHelp);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        openHelp(articleId);
      }}
      className="help-inline-icon"
      aria-label={label ? `Help: ${label}` : "Open help for this control"}
      title={label ? `Help: ${label}` : "Open help"}
      data-testid={`help-icon-${articleId}`}
    >
      ?
    </button>
  );
};
