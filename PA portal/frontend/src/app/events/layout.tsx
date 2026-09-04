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
      {/* Kill the iOS/Android rubber-band on the events segment only.
          Scoped to /events routes because this style tag lives inside the
          layout — it mounts when a /events page renders and unmounts when
          you navigate away. The overflow-hidden on the wrapper below stops
          the page from being scrollable in the first place, but this style
          is defence-in-depth for the html/body edge cases. */}
      <style dangerouslySetInnerHTML={{ __html: "html,body{overscroll-behavior:none;overflow:hidden;}" }} />
      {/* Fixed-height viewport container. `h-[100dvh]` follows the mobile
          URL-bar so it never overflows past the visible area, and
          `overflow-hidden` on the wrapper prevents ANY page-level scroll —
          only the internal <main> region scrolls (see EventsApp). */}
      <div className="relative mx-auto flex h-[100dvh] max-w-[560px] flex-col overflow-hidden bg-[#F3F5F8] text-[17px] text-slate-900 [--nav-h:76px]">
        {children}
      </div>
      <SwRegister />
    </EventsI18nProvider>
  );
}
