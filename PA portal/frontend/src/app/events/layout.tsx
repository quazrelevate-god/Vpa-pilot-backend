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
      {/* iOS Safari's "100vh doesn't match the visible viewport" quirk is
          the reason the gray strip kept coming back at the bottom of the
          nav. The reliable fix is to pin html + body to the actual visible
          height and let the wrapper `h-full` inherit that — every unit down
          the chain then matches the physical viewport regardless of URL-bar
          state. Multiple height values give a graceful fallback ladder:
            · `100%`                  — desktop / older browsers
            · `-webkit-fill-available` — iOS Safari legacy (pre-dvh)
            · `100dvh`                 — modern spec, tracks URL bar
          `overflow:hidden` on html + body kills page-level scroll (only
          the internal <main> region scrolls). `overscroll-behavior:none`
          kills iOS/Android rubber-band.  */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
            html,body{
              height:100%;
              height:-webkit-fill-available;
              height:100dvh;
              margin:0;
              overflow:hidden;
              overscroll-behavior:none;
            }
          `,
        }}
      />
      {/* --nav-h drives BottomNav's content height (safe-area padding for
          the iOS home-indicator strip is added on top of this by BottomNav
          itself). 60 gives ~5px breathing room above/below the active pill
          + label without letting the icons crash into the border. */}
      <div className="mx-auto flex h-full max-w-[560px] flex-col overflow-hidden bg-[#F3F5F8] text-[17px] text-slate-900 [--nav-h:60px]">
        {children}
      </div>
      <SwRegister />
    </EventsI18nProvider>
  );
}
