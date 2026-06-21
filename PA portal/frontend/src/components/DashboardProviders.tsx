"use client";

import { LangProvider } from "@/lib/lang-context";

export default function DashboardProviders({ children }: { children: React.ReactNode }) {
  return <LangProvider>{children}</LangProvider>;
}
