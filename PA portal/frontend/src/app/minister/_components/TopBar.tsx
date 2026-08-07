"use client";

import { Menu, PanelLeftClose } from "lucide-react";
import { useT } from "../_lib/i18n";

/** Page header — menu toggle + title on the left, EN/தமிழ் on the right.
 *  Paper-toned with a hairline, so it anchors the content without competing
 *  with the navy rail. */
export default function TopBar({
  title, subtitle, onMenu, navOpen,
}: { title: string; subtitle?: string; onMenu?: () => void; navOpen?: boolean }) {
  const { t, lang, setLang } = useT();

  return (
    <header className="mn-topbar sticky top-0 z-30 flex items-center gap-3 px-4 py-3.5 sm:px-6">
      {onMenu && (
        <button
          onClick={onMenu}
          aria-label={navOpen ? t("Hide menu", "மெனுவை மறை") : t("Show menu", "மெனுவைக் காட்டு")}
          aria-expanded={navOpen}
          title={navOpen ? t("Hide menu", "மெனுவை மறை") : t("Show menu", "மெனுவைக் காட்டு")}
          className="mn-menu-btn grid h-10 w-10 shrink-0 place-items-center rounded-xl"
        >
          {/* A hamburger is the one glyph everyone reads as "menu"; once the
              rail is open we switch to a panel-close mark so the control also
              says what it will do next. */}
          {navOpen
            ? <PanelLeftClose className="h-[19px] w-[19px]" strokeWidth={2} />
            : <Menu className="h-[19px] w-[19px]" strokeWidth={2.25} />}
        </button>
      )}

      <div className="min-w-0 flex-1">
        <h1 className="mn-topbar-title truncate font-serif text-[23px] font-semibold leading-tight">{title}</h1>
        {subtitle && (
          <p className="truncate text-[12.5px]" style={{ color: "var(--mn-ink-3)" }}>{subtitle}</p>
        )}
      </div>

      <div className="mn-lang flex shrink-0">
        {(["en", "ta"] as const).map((l) => (
          <button
            key={l}
            onClick={() => setLang(l)}
            data-on={lang === l}
            className="mn-lang-btn px-3.5 py-2 text-[12px] font-bold"
          >
            {l === "en" ? "EN" : "தமிழ்"}
          </button>
        ))}
      </div>
    </header>
  );
}
