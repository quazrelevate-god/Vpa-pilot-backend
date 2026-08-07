import type { Metadata, Viewport } from "next";
import MinisterProviders from "./_components/MinisterProviders";
import SwRegister from "./_components/SwRegister";
import OrientationLock from "./_components/OrientationLock";
import "./minister.css";

export const metadata: Metadata = {
  title: "அமைச்சர் மேசை — Minister's Desk",
  description: "The Minister's office at a glance — petitions, proposals, tickets, associations, and the events diary.",
  manifest: "/minister/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "அமைச்சர் மேசை",
  },
  icons: {
    apple: "/minister/apple-touch-icon.png",
    icon: "/minister/icon-192.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#1B2946",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

// The Minister carries this on a tablet — full-width layout, persistent left
// sidebar, no mobile column. Aurora tokens; each screen fills the content area.
export default function MinisterLayout({ children }: { children: React.ReactNode }) {
  return (
    <MinisterProviders>
      <div className="mn-app min-h-screen bg-background text-[15px] text-foreground">
        {children}
      </div>
      <SwRegister />
      <OrientationLock />
    </MinisterProviders>
  );
}
