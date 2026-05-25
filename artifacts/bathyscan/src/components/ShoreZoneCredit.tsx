import React from "react";

export const SHOREZONE_CREDIT_URL =
  "https://alaskafisheries.noaa.gov/shorezone/";

interface Props {
  style?: React.CSSProperties;
  className?: string;
}

export const ShoreZoneCredit: React.FC<Props> = ({ style, className }) => {
  return (
    <div
      data-testid="shorezone-credit"
      className={className}
      style={{
        fontSize: 9,
        letterSpacing: "0.04em",
        color: "#94a3b8",
        pointerEvents: "auto",
        ...style,
      }}
    >
      Substrate:{" "}
      <a
        href={SHOREZONE_CREDIT_URL}
        target="_blank"
        rel="noopener noreferrer"
        style={{ color: "#94a3b8", textDecoration: "underline" }}
      >
        Alaska ShoreZone (NOAA AKR / ADF&amp;G)
      </a>
    </div>
  );
};
