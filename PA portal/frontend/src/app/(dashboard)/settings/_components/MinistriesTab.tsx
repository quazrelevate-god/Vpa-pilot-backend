"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Landmark, Check, MailIcon, Pencil, Search } from "lucide-react";

import { SectionCard, StatusDot } from "@/components/ui/detail-primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

import { listMinistries, updateMinistry, type MinistryRow } from "../_lib/adminApi";

export default function MinistriesTab() {
  const [rows, setRows] = useState<MinistryRow[] | null>(null);
  const [editing, setEditing] = useState<MinistryRow | null>(null);
  const [q, setQ] = useState("");

  const load = async () => {
    try { setRows(await listMinistries()); }
    catch (e) { toast.error("Load failed", { description: (e as Error).message }); }
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
      title="Ministry contact emails"
      right={
        totalCount ? (
          <StatusDot
            label={`${emailedCount} / ${totalCount} configured`}
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
          placeholder="Search ministries…"
          className="flex-1 bg-transparent text-sm placeholder:text-muted-foreground focus:outline-none"
        />
      </div>

      {filtered === null ? (
        <div className="space-y-2">
          {[1, 2, 3, 4].map((k) => <Skeleton key={k} className="h-14 w-full rounded-xl" />)}
        </div>
      ) : filtered.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">No matches.</p>
      ) : (
        <div className="divide-y divide-border rounded-xl border border-border bg-card">
          {filtered.map((m) => (
            <div key={m.id} className="flex items-center gap-3 px-4 py-3">
              <div className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-lg bg-brand/10 text-brand">
                <Landmark className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-foreground">{m.display_en}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-3 text-[12px] text-muted-foreground">
                  <span className="font-mono">{m.key}</span>
                  {m.email ? (
                    <span className="inline-flex items-center gap-1 text-emerald-700">
                      <MailIcon className="h-3 w-3" /> {m.email}
                    </span>
                  ) : (
                    <span className="italic">no email set</span>
                  )}
                  {m.display_ta && <span>· {m.display_ta}</span>}
                </div>
              </div>
              <Button size="sm" variant="outline" onClick={() => setEditing(m)}>
                <Pencil className="mr-1 h-3.5 w-3.5" /> Edit
              </Button>
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
                toast.success("Saved");
                setEditing(null);
                load();
              } catch (e) {
                toast.error("Save failed", { description: (e as Error).message });
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
  const [email, setEmail] = useState(row.email ?? "");
  const [ta, setTa]       = useState(row.display_ta ?? "");
  const [active, setActive] = useState(row.is_active);
  const [busy, setBusy]   = useState(false);
  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{row.display_en}</DialogTitle>
      </DialogHeader>
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label>Email</Label>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ministry@tn.gov.in" />
          <p className="text-[11px] text-muted-foreground">
            Petitions marked with this ministry auto-forward here once the email workflow ships.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label>Display name (Tamil)</Label>
          <Input value={ta} onChange={(e) => setTa(e.target.value)} placeholder="தமிழ் பெயர்" />
        </div>
        <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-card p-3 text-sm">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          <span className="font-medium">Active</span>
          <span className="text-xs text-muted-foreground">
            Uncheck to hide from AI routing without touching historical data.
          </span>
        </label>
      </div>
      <DialogFooter>
        <Button
          className="aurora-primary text-white"
          disabled={busy}
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
          <Check className="mr-1.5 h-3.5 w-3.5" /> Save
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
