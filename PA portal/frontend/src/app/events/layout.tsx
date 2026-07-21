import type { Metadata, Viewport } from "next";
import { EventsI18nProvider } from "./_lib/i18n";
import SwRegister from "./_components/SwRegister";

export const metadata: Metadata = {
  title: "Events Calendar — PA Office",
  description: "Photograph invitation cards and manage the shared greetings calendar.",
  manifest: "/events/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Events Desk",
  },
  icons: {
    apple: "/events/icon-192.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#21395B",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function EventsLayout({ children }: { children: React.ReactNode }) {
  return (
    <EventsI18nProvider>
      <div className="relative mx-auto min-h-screen max-w-[560px] bg-[#F3F5F8] text-slate-900 [--nav-h:64px]">
        {children}
      </div>
      <SwRegister />
    </EventsI18nProvider>
  );
}
