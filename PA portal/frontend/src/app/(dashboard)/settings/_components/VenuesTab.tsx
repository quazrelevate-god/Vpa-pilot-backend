"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { MapPin, Plus, Check, Pencil, Power } from "lucide-react";

import { SectionCard, StatusDot } from "@/components/ui/detail-primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";

import { useLang } from "@/lib/lang-context";
import { listVenues, createVenue, updateVenue, type VenueRow } from "../_lib/adminApi";

export default function VenuesTab() {
  const { t } = useLang();
  const [rows, setRows] = useState<VenueRow[] | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<VenueRow | null>(null);

  const load = async () => {
    try { setRows(await listVenues()); }
    catch (e) { toast.error(t("set.loadFailed"), { description: (e as Error).message }); }
  };
  useEffect(() => { load(); }, []);

  const toggleActive = async (v: VenueRow) => {
    try {
      await updateVenue(v.id, { is_active: !v.is_active });
      toast.success(v.is_active ? t("set.venuesDisabledToast") : t("set.venuesEnabledToast"));
      load();
    } catch (e) { toast.error(t("set.updateFailed"), { description: (e as Error).message }); }
  };

  return (
    <SectionCard
      icon={MapPin}
      title={t("set.venuesTitle")}
      right={
        <Button size="sm" className="aurora-primary text-white" onClick={() => setShowCreate(true)}>
          <Plus className="mr-1.5 h-3.5 w-3.5" /> {t("set.venuesAdd")}
        </Button>
      }
    >
      <p className="mb-4 text-[13px] text-muted-foreground">
        {t("set.venuesDesc")}
      </p>

      {rows === null ? (
        <div className="space-y-2">{[1, 2, 3].map((k) => <Skeleton key={k} className="h-14 w-full rounded-xl" />)}</div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center">
          <MapPin className="mx-auto h-6 w-6 text-muted-foreground" />
          <p className="mt-2 text-sm font-medium">{t("set.venuesNone")}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t("set.venuesNoneHint")}</p>
        </div>
      ) : (
        <div className="divide-y divide-border rounded-xl border border-border bg-card">
          {rows.map((v) => (
            <div key={v.id} className="flex items-center gap-3 px-4 py-3">
              <div className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-lg bg-brand/10 text-brand">
                <MapPin className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-foreground">{v.display_en}</span>
                  {v.is_builtin && <StatusDot label={t("set.builtin")} tone="slate" />}
                  {!v.is_active && <StatusDot label={t("set.disabledTag")} tone="red" />}
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-3 text-[12px] text-muted-foreground">
                  <span className="font-mono">{v.key}</span>
                  {v.address && <span>· {v.address}</span>}
                </div>
              </div>
              <div className="flex flex-shrink-0 items-center gap-1.5">
                <Button size="sm" variant="outline" onClick={() => setEditing(v)}>
                  <Pencil className="mr-1 h-3.5 w-3.5" /> {t("set.venuesRename")}
                </Button>
                <Button
                  size="sm" variant="outline"
                  className={v.is_active ? "border-red-200 text-red-700 hover:bg-red-50 hover:text-red-700" : ""}
                  onClick={() => toggleActive(v)}
                >
                  <Power className="mr-1 h-3.5 w-3.5" /> {v.is_active ? t("set.disable") : t("set.enable")}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <VenueFormDialog
          title={t("set.venuesAdd")}
          onSubmit={async (vals) => {
            await createVenue({ key: vals.key, display_en: vals.display_en, display_ta: vals.display_ta, address: vals.address });
            toast.success(t("set.venuesAddedToast"));
            setShowCreate(false);
            load();
          }}
        />
      </Dialog>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        {editing && (
          <VenueFormDialog
            title={`${t("set.venuesRenamePrefix")} ${editing.display_en}`}
            initial={editing}
            onSubmit={async (vals) => {
              await updateVenue(editing.id, { display_en: vals.display_en, display_ta: vals.display_ta, address: vals.address });
              toast.success(t("set.saved"));
              setEditing(null);
              load();
            }}
          />
        )}
      </Dialog>
    </SectionCard>
  );
}

function VenueFormDialog({
  title, initial, onSubmit,
}: {
  title: string;
  initial?: VenueRow;
  onSubmit: (vals: { key: string; display_en: string; display_ta?: string; address?: string }) => Promise<void>;
}) {
  const { t } = useLang();
  const isEdit = !!initial;
  const [key, setKey] = useState(initial?.key ?? "");
  const [displayEn, setDisplayEn] = useState(initial?.display_en ?? "");
  const [displayTa, setDisplayTa] = useState(initial?.display_ta ?? "");
  const [address, setAddress] = useState(initial?.address ?? "");
  const [busy, setBusy] = useState(false);

  const keyValid = isEdit || /^[a-z0-9][a-z0-9_]*$/.test(key);

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>
          {isEdit ? t("set.venuesEditDesc") : t("set.venuesAddDesc")}
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        {!isEdit && (
          <div className="space-y-1.5">
            <Label>{t("set.venueId")}</Label>
            <Input value={key} onChange={(e) => setKey(e.target.value)} placeholder="ward5_office" className="font-mono" />
            {key && !keyValid && <p className="text-xs text-red-600">{t("set.venueKeyErr")}</p>}
          </div>
        )}
        <div className="space-y-1.5">
          <Label>{t("set.displayName")}</Label>
          <Input value={displayEn} onChange={(e) => setDisplayEn(e.target.value)} placeholder="Ward 5 Office" />
        </div>
        <div className="space-y-1.5">
          <Label>{t("set.tamilName")} <span className="font-normal text-muted-foreground">({t("set.optional")})</span></Label>
          <Input value={displayTa} onChange={(e) => setDisplayTa(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>{t("set.address")} <span className="font-normal text-muted-foreground">({t("set.optional")})</span></Label>
          <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Street, city" />
        </div>
      </div>
      <DialogFooter>
        <Button
          className="aurora-primary text-white"
          disabled={busy || !displayEn || !keyValid || (!isEdit && !key)}
          onClick={async () => {
            setBusy(true);
            try {
              await onSubmit({ key, display_en: displayEn, display_ta: displayTa || undefined, address: address || undefined });
            } catch (e) {
              toast.error(t("set.failed"), { description: (e as Error).message });
            } finally { setBusy(false); }
          }}
        >
          <Check className="mr-1.5 h-3.5 w-3.5" /> {isEdit ? t("set.save") : t("set.venuesAdd")}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
