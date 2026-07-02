import type { Metadata } from "next";
import { Catamaran, Fraunces, Noto_Serif_Tamil, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import SentryInit from "@/components/SentryInit";

// UI / body — warm humanist, covers Latin + Tamil in one family
const catamaran = Catamaran({
  subsets: ["latin", "tamil"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-catamaran",
  display: "swap",
});
// Headlines + long-form reading — elegant serif (Latin)
const fraunces = Fraunces({
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  variable: "--font-fraunces",
  display: "swap",
});
// Headlines + long-form reading — elegant serif (Tamil)
const notoSerifTamil = Noto_Serif_Tamil({
  subsets: ["tamil"],
  weight: ["400", "600", "700"],
  variable: "--font-noto-tamil",
  display: "swap",
});
// IDs, tokens, tabular numbers
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-plex-mono",
  display: "swap",
});

const fontVars = `${catamaran.variable} ${fraunces.variable} ${notoSerifTamil.variable} ${plexMono.variable}`;

export const metadata: Metadata = {
  title: "Petition Management — Staff Portal",
  description: "Petition & appointment management for grievance triage and scheduling",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={fontVars}>
      <body className="bg-background text-foreground antialiased">
        <SentryInit />
        {children}
        <Toaster />
      </body>
    </html>
  );
}
