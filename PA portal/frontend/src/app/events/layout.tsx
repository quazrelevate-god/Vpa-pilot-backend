import type { Metadata, Viewport } from "next";
import { EventsI18nProvider } from "./_lib/i18n";
import SwRegister from "./_components/SwRegister";

export const metadata: Metadata = {
  title: "நம் குரல் — Nam Kural Events",
  description: "Photograph or speak invitation details and manage the shared greetings calendar.",
  manifest: "/events/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "நம் குரல்",
  },
  icons: {
    apple: "/events/apple-touch-icon.png",
    icon: "/events/icon-192.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#14233F",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function EventsLayout({ children }: { children: React.ReactNode }) {
  return (
    <EventsI18nProvider>
      <div className="relative mx-auto min-h-screen max-w-[560px] bg-[#F3F5F8] text-[17px] text-slate-900 [--nav-h:76px]">
        {children}
      </div>
      <SwRegister />
    </EventsI18nProvider>
  );
}
