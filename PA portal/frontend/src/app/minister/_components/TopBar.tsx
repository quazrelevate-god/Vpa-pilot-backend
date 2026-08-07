"use client";

import { PanelLeft } from "lucide-react";
import { useT } from "../_lib/i18n";

/** Page-level header for the tablet layout — a menu toggle + title on the left,
 *  EN/தமிழ் toggle on the right. The menu button shows/hides the side menu so a
 *  dashboard can fill the whole screen; logout lives in the side menu. */
export default function TopBar({
  title, subtitle, onMenu, navOpen,
}: { title: string; subtitle?: string; onMenu?: () => void; navOpen?: boolean }) {
  const { t, lang, setLang } = useT();

  return (
    <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-border bg-card/95 px-4 py-3.5 backdrop-blur sm:px-6">
      {onMenu && (
        <button
          onClick={onMenu}
          aria-label={navOpen ? t("Hide menu", "மெனுவை மறை") : t("Show menu", "மெனுவைக் காட்டு")}
          aria-expanded={navOpen}
          title={navOpen ? t("Hide menu", "மெனுவை மறை") : t("Show menu", "மெனுவைக் காட்டு")}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <PanelLeft className="h-5 w-5" strokeWidth={1.9} />
        </button>
      )}

      <div className="min-w-0 flex-1">
        <h1 className="truncate font-serif text-[22px] font-semibold leading-tight text-foreground">{title}</h1>
        {subtitle && <p className="truncate text-[12.5px] text-muted-foreground">{subtitle}</p>}
      </div>

      <div className="flex overflow-hidden rounded-lg border border-border">
        {(["en", "ta"] as const).map((l) => (
          <button
            key={l}
            onClick={() => setLang(l)}
            className={
              "px-3 py-1.5 text-[12px] font-semibold transition-colors " +
              (lang === l ? "bg-brand text-white" : "bg-card text-muted-foreground hover:bg-accent")
            }
          >
            {l === "en" ? "EN" : "தமிழ்"}
          </button>
        ))}
      </div>
    </header>
  );
}
