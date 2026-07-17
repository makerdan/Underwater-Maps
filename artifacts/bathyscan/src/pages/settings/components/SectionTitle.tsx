import React from "react";
import { HelpIcon } from "@/components/help/HelpButton";
import { S } from "../styles";

export const SectionTitle: React.FC<{ children: React.ReactNode; helpId?: string; helpLabel?: string }> =
  ({ children, helpId, helpLabel }) => (
    <h2 style={S.sectionTitle}>
      {children}
      {helpId && (
        <span style={{ marginLeft: 8, display: "inline-block", verticalAlign: "middle" }}>
          <HelpIcon articleId={helpId} {...(helpLabel ? { label: helpLabel } : {})} />
        </span>
      )}
    </h2>
  );
