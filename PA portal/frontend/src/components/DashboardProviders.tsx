"use client";

import { LangProvider } from "@/lib/lang-context";
import SessionGuard from "@/components/SessionGuard";

export default function DashboardProviders({ children }: { children: React.ReactNode }) {
  return (
    <LangProvider>
      <SessionGuard />
      {children}
    </LangProvider>
  );
}
