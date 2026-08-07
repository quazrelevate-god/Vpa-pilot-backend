"use client";

import type { ReactNode } from "react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useT } from "../_lib/i18n";

/**
 * Read-only detail drawer shell for the Minister app — the same right-side
 * Sheet the staff dashboards use (full-width, no built-in close, decision bar
 * hidden by the drawer's own readOnly prop). Handles the loading / error /
 * ready states around whatever detail component `render` returns.
 */
export function DrawerSheet<T>({
  open, onClose, loading, detail, render,
}: {
  open: boolean;
  onClose: () => void;
  loading: boolean;
  detail: T | null;
  render: (d: T) => ReactNode;
}) {
  const { t } = useT();
  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent
        side="right"
        hideClose
        className="flex w-full flex-col gap-0 p-0 sm:max-w-[95vw] lg:max-w-[92vw]"
      >
        {!open ? null : loading && !detail ? (
          <div className="flex h-full items-center justify-center p-10 text-sm text-muted-foreground">
            {t("Loading…", "ஏற்றுகிறோம்…")}
          </div>
        ) : detail ? (
          render(detail)
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-10 text-center">
            <p className="text-sm font-medium text-foreground">{t("Couldn't load this record.", "இதை ஏற்ற முடியவில்லை.")}</p>
            <p className="text-[13px] text-muted-foreground">{t("Please try again.", "மீண்டும் முயற்சிக்கவும்.")}</p>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
