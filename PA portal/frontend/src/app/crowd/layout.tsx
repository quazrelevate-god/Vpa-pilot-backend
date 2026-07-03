import type { Metadata, Viewport } from "next";
import { CrowdI18nProvider } from "./_lib/i18n";
import SwRegister from "./_components/SwRegister";

export const metadata: Metadata = {
  title: "Crowd Management — Floor Operator",
  description: "Manage today's visitors, appointments and walk-ins with live slot availability.",
  manifest: "/crowd/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Crowd Board",
  },
  icons: {
    apple: "/crowd/icon-192.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#0f2a5b",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function CrowdLayout({ children }: { children: React.ReactNode }) {
  return (
    <CrowdI18nProvider>
      <div className="relative mx-auto min-h-screen max-w-[560px] bg-slate-50 text-slate-900 [--nav-h:64px]">
        {children}
      </div>
      <SwRegister />
    </CrowdI18nProvider>
  );
}
