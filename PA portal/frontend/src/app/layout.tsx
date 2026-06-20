import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Petition Management — Staff Portal",
  description: "Government of Tamil Nadu — petition appointment management",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="text-slate-800 bg-slate-50">{children}</body>
    </html>
  );
}
