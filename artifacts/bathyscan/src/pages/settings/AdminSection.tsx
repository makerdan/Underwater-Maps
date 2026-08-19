import React from "react";
import { AdminPanel } from "@/components/AdminPanel";
import { SectionTitle } from "./components/SectionTitle";

/** Settings-only home for the existing, server-authorized admin operations. */
export function AdminSection() {
  return (
    <section data-testid="settings-admin-section">
      <SectionTitle helpId="admin" helpLabel="Administration">◈ ADMIN</SectionTitle>
      <p
        style={{
          color: "#94a3b8",
          fontSize: "calc(10px * var(--bs-font-scale, 1))",
          margin: "0 0 16px",
        }}
      >
        User access, delivery verification, and operational diagnostics.
      </p>
      <AdminPanel />
    </section>
  );
}