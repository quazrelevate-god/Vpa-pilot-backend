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
          you navigate away. Defence-in-depth for html/body edge cases. */}
      <style dangerouslySetInnerHTML={{ __html: "html,body{overscroll-behavior:none;overflow:hidden;}" }} />
      {/* Anchored to the visual viewport with `fixed inset-0` so the wrapper
          always fills the actual visible area — including under the iOS
          home-indicator strip and the notch. `h-[100dvh]` was falling short
          of the physical viewport on some iOS Safari builds, leaving a gray
          strip below the bottom nav; `fixed inset-0` is the reliable fix
          that never leaves that gap. `mx-auto max-w-[560px]` still centers
          on wide screens because `left:0 right:0` (from inset-0) gives full
          width, and `mx-auto` recomputes once max-width kicks in. */}
      {/* --nav-h drives BottomNav's content height (safe-area padding for
          the iOS home-indicator strip is added on top of this by BottomNav
          itself). Trimmed from 76 → 60 so the nav no longer looks bottom-
          heavy on iOS Safari where the safe-area buffer already adds ~34px.
          60 gives ~5px of breathing room above/below the active pill + label
          without letting the icons crash into the border. */}
      <div className="fixed inset-0 mx-auto flex max-w-[560px] flex-col overflow-hidden bg-[#F3F5F8] text-[17px] text-slate-900 [--nav-h:60px]">
        {children}
      </div>
      <SwRegister />
    </EventsI18nProvider>
  );
}
