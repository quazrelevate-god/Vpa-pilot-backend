import type { Metadata } from "next";
import { Fraunces, IBM_Plex_Mono, Noto_Sans_Tamil, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import SentryInit from "@/components/SentryInit";

// UI / body (Latin) — crisp geometric sans (Aurora type spec)
const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-jakarta",
  display: "swap",
});
// Tamil — matches Latin sizes, weights 400–600 (Aurora type spec)
const notoTamil = Noto_Sans_Tamil({
  subsets: ["tamil"],
  weight: ["400", "500", "600"],
  variable: "--font-noto-tamil",
  display: "swap",
});
// Display + page titles only (Aurora type spec: 36/600, 32/600)
const fraunces = Fraunces({
  subsets: ["latin"],
  weight: ["600"],
  variable: "--font-fraunces",
  display: "swap",
});
// IDs, tokens, tabular numbers
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-plex-mono",
  display: "swap",
});

const fontVars = `${jakarta.variable} ${notoTamil.variable} ${fraunces.variable} ${plexMono.variable}`;

export const metadata: Metadata = {
  title: "Petition Management — Staff Portal",
  description: "Petition & appointment management for grievance triage and scheduling",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={fontVars}>
      <body className="bg-background text-foreground">
        <SentryInit />
        {children}
        <Toaster />
      </body>
    </html>
  );
}
