"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Landmark, Check, MailIcon, Pencil, Search, Power, PowerOff } from "lucide-react";

import { SectionCard, StatusDot } from "@/components/ui/detail-primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

import { useLang } from "@/lib/lang-context";
import { listMinistries, updateMinistry, type MinistryRow } from "../_lib/adminApi";

export default function MinistriesTab() {
  const { t, lang } = useLang();
  const [rows, setRows] = useState<MinistryRow[] | null>(null);
  const [editing, setEditing] = useState<MinistryRow | null>(null);
  const [q, setQ] = useState("");

  const load = async () => {
    try { setRows(await listMinistries()); }
    catch (e) { toast.error(t("set.loadFailed"), { description: (e as Error).message }); }
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    if (!rows) return null;
    const query = q.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter((m) =>
      m.display_en.toLowerCase().includes(query) ||
      m.key.toLowerCase().includes(query) ||
      (m.email ?? "").toLowerCase().includes(query)
    );
  }, [rows, q]);

  const emailedCount = rows?.filter((m) => m.email).length ?? 0;
  const totalCount = rows?.length ?? 0;

  return (
    <SectionCard
      icon={Landmark}
      title={t("set.minTitle")}
      right={
        totalCount ? (
          <StatusDot
            label={`${emailedCount} / ${totalCount} ${t("set.minConfigured")}`}
            tone={emailedCount === totalCount ? "emerald" : "amber"}
          />
        ) : undefined
      }
    >
      <div className="mb-4 flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2">
        <Search className="h-4 w-4 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("set.minSearch")}
          className="flex-1 bg-transparent text-sm placeholder:text-muted-foreground focus:outline-none"
        />
      </div>

      {filtered === null ? (
        <div className="space-y-2">
          {[1, 2, 3, 4].map((k) => <Skeleton key={k} className="h-14 w-full rounded-xl" />)}
        </div>
      ) : filtered.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">{t("set.noMatches")}</p>
      ) : (
        <div className="divide-y divide-border rounded-xl border border-border bg-card">
          {filtered.map((m) => (
            <div key={m.id} className="flex items-center gap-3 px-4 py-3">
              <div className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-lg bg-brand/10 text-brand">
                <Landmark className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-foreground">{lang === "ta" && m.display_ta ? m.display_ta : m.display_en}</span>
                  {!m.is_active && <StatusDot label={t("set.inactive")} tone="slate" />}
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-3 text-[12px] text-muted-foreground">
                  <span className="font-mono">{m.key}</span>
                  {m.email ? (
                    <span className="inline-flex items-center gap-1 text-emerald-700">
                      <MailIcon className="h-3 w-3" /> {m.email}
                    </span>
                  ) : (
                    <span className="italic">{t("set.minNoEmail")}</span>
                  )}
                  {lang === "ta" ? <span>· {m.display_en}</span> : (m.display_ta && <span>· {m.display_ta}</span>)}
                </div>
              </div>
              <div className="flex flex-shrink-0 items-center gap-1.5">
                <Button size="sm" variant="outline" onClick={() => setEditing(m)}>
                  <Pencil className="mr-1 h-3.5 w-3.5" /> {t("set.edit")}
                </Button>
                <Button
                  size="sm" variant="outline"
                  title={m.is_active ? t("set.minHideTitle") : t("set.minShowTitle")}
                  onClick={async () => {
                    try {
                      await updateMinistry(m.id, { is_active: !m.is_active });
                      toast.success(m.is_active ? t("set.disabledTag") : t("set.enabledTag"));
                      load();
                    } catch (e) {
                      toast.error(t("set.updateFailed"), { description: (e as Error).message });
                    }
                  }}
                >
                  {m.is_active
                    ? <><PowerOff className="mr-1 h-3.5 w-3.5" /> {t("set.disable")}</>
                    : <><Power className="mr-1 h-3.5 w-3.5" /> {t("set.enable")}</>}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        {editing && (
          <MinistryDialog
            row={editing}
            onSubmit={async (patch) => {
              try {
                await updateMinistry(editing.id, patch);
                toast.success(t("set.saved"));
                setEditing(null);
                load();
              } catch (e) {
                toast.error(t("set.saveFailed"), { description: (e as Error).message });
              }
            }}
          />
        )}
      </Dialog>
    </SectionCard>
  );
}

function MinistryDialog({
  row, onSubmit,
}: {
  row: MinistryRow;
  onSubmit: (patch: { email?: string; display_ta?: string; is_active?: boolean }) => Promise<void>;
}) {
  const { t, lang } = useLang();
  const [email, setEmail] = useState(row.email ?? "");
  const [ta, setTa]       = useState(row.display_ta ?? "");
  const [active, setActive] = useState(row.is_active);
  const [busy, setBusy]   = useState(false);
  const emailInvalid = !!email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{lang === "ta" && row.display_ta ? row.display_ta : row.display_en}</DialogTitle>
      </DialogHeader>
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label>{t("set.email")}</Label>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ministry@tn.gov.in"
            aria-invalid={emailInvalid}
            className={emailInvalid ? "border-red-400 focus-visible:ring-red-400" : ""} />
          {emailInvalid && <p className="text-xs text-red-600">{t("set.emailInvalid")}</p>}
          <p className="text-[11px] text-muted-foreground">
            {t("set.minEmailHint")}
          </p>
        </div>
        <div className="space-y-1.5">
          <Label>{t("set.minDisplayTa")}</Label>
          <Input value={ta} onChange={(e) => setTa(e.target.value)} placeholder="தமிழ் பெயர்" />
        </div>
        <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-card p-3 text-sm">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          <span className="font-medium">{t("set.active")}</span>
          <span className="text-xs text-muted-foreground">
            {t("set.minActiveHint")}
          </span>
        </label>
      </div>
      <DialogFooter>
        <Button
          className="aurora-primary text-white"
          disabled={busy || emailInvalid}
          onClick={async () => {
            setBusy(true);
            try {
              await onSubmit({
                email: email || undefined,
                display_ta: ta || undefined,
                is_active: active,
              });
            } finally { setBusy(false); }
          }}
        >
          <Check className="mr-1.5 h-3.5 w-3.5" /> {t("set.save")}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
