import React from "react";
import { useUser, useClerk } from "@clerk/react";
import { useLocation } from "wouter";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

export function AppHeader() {
  const { user, isLoaded } = useUser();
  const { signOut } = useClerk();
  const [, setLocation] = useLocation();

  return (
    <header
      className="flex items-center justify-between px-4 shrink-0 bg-[#040810]/80 backdrop-blur-sm border-b border-[#1e3a5f]/60 z-30"
      style={{ height: 40 }}
    >
      <span className="font-mono text-[#38bdf8] text-sm tracking-[0.25em] uppercase font-semibold select-none">
        BATHYSCAN
      </span>

      {isLoaded && user && (
        <div className="flex items-center gap-3">
          <span className="font-mono text-[#94a3b8] text-xs hidden sm:block">
            {user.primaryEmailAddress?.emailAddress ?? user.username ?? ""}
          </span>
          <button
            data-testid="settings-link"
            onClick={() => setLocation(basePath + "/settings")}
            className="font-mono text-[#475569] hover:text-[#94a3b8] text-xs tracking-wider uppercase transition-colors"
          >
            Settings
          </button>
          <button
            onClick={() => signOut()}
            className="font-mono text-[#475569] hover:text-[#94a3b8] text-xs tracking-wider uppercase transition-colors"
          >
            Sign out
          </button>
        </div>
      )}
    </header>
  );
}
