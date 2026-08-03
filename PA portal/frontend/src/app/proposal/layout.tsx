import type { Metadata } from "next";
import "./proposal.css";

// Nam Kural proposal site — fonts loaded exactly as the standalone app did
// (Anek Tamil for display, Noto Sans + Noto Sans Tamil for body). These are
// referenced by literal family name in tailwind.config.ts (font-disp / font-body),
// so they must be fetched under those names rather than via next/font aliases.
export const metadata: Metadata = {
  title:
    "Nam Kural | நம் குரல் · Office of the Minister for Education, Government of Tamil Nadu",
  description:
    "Nam Kural, the proposal channel to the Office of the Hon'ble Minister for Education, Government of Tamil Nadu. Give your idea for the betterment of tomorrow.",
};

export default function ProposalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link
        rel="preconnect"
        href="https://fonts.gstatic.com"
        crossOrigin="anonymous"
      />
      <link
        href="https://fonts.googleapis.com/css2?family=Anek+Tamil:wght@400;500;600;700;800&family=Noto+Sans:ital,wght@0,400;0,500;0,600;1,400&family=Noto+Sans+Tamil:wght@400;500;600;700&display=swap"
        rel="stylesheet"
      />
      {children}
    </>
  );
}
