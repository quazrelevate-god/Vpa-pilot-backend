import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import SentryInit from "@/components/SentryInit";

export const metadata: Metadata = {
  title: "Petition Management — Staff Portal",
  description: "Petition & appointment management for grievance triage and scheduling",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-background text-foreground antialiased">
        <SentryInit />
        {children}
        <Toaster />
      </body>
    </html>
  );
}
