"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Building2, Plus, Check, X, MailIcon, Pencil, Save, Star, Trash2, Power, PowerOff,
} from "lucide-react";

import { SectionCard, StatusDot } from "@/components/ui/detail-primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";

import {
  listDepartments, createDepartment, updateDepartment, deleteDepartment,
  type DepartmentRow,
} from "../_lib/adminApi";

export default function DepartmentsTab() {
  const [rows, setRows] = useState<DepartmentRow[] | null>(null);
  const [openCreate, setOpenCreate] = useState(false);
  const [editing, setEditing] = useState<DepartmentRow | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<DepartmentRow | null>(null);

  const load = async () => {
    try { setRows(await listDepartments()); }
    catch (e) { toast.error("Load failed", { description: (e as Error).message }); }
  };

  useEffect(() => { load(); }, []);

  return (
    <SectionCard
      icon={Building2}
      title="School-education departments"
      right={
        <Dialog open={openCreate} onOpenChange={setOpenCreate}>
          <DialogTrigger asChild>
            <Button size="sm" className="aurora-primary text-white">
              <Plus className="mr-1.5 h-3.5 w-3.5" /> Add department
            </Button>
          </DialogTrigger>
          <DeptDialog
            title="Add new department"
            onSubmit={async (values) => {
              try {
                await createDepartment(values);
                toast.success("Department added");
                setOpenCreate(false);
                load();
              } catch (e) {
                toast.error("Create failed", { description: (e as Error).message });
              }
            }}
          />
        </Dialog>
      }
    >
      {rows === null ? (
        <div className="space-y-2">
          {[1, 2, 3].map((k) => <Skeleton key={k} className="h-14 w-full rounded-xl" />)}
        </div>
      ) : (
        <div className="divide-y divide-border rounded-xl border border-border bg-card">
          {rows.map((d) => (
            <div key={d.id} className="flex items-center gap-3 px-4 py-3">
              <div className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-lg bg-brand/10 text-brand">
                <Building2 className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-foreground">{d.display_en}</span>
                  {d.is_builtin && <StatusDot label="Built-in" tone="brand" />}
                  {!d.is_active && <StatusDot label="Inactive" tone="slate" />}
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-3 text-[12px] text-muted-foreground">
                  <span className="font-mono">{d.key}</span>
                  {d.display_ta && <span>· {d.display_ta}</span>}
                  {d.email && (
                    <span className="inline-flex items-center gap-1">
                      <MailIcon className="h-3 w-3" /> {d.email}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex flex-shrink-0 items-center gap-1.5">
                <Button size="sm" variant="outline" onClick={() => setEditing(d)}>
                  <Pencil className="mr-1 h-3.5 w-3.5" /> Edit
                </Button>
                {d.is_builtin ? (
                  <Button
                    size="sm" variant="outline"
                    title={d.is_active ? "Disable this department" : "Re-enable this department"}
                    onClick={async () => {
                      try {
                        await updateDepartment(d.id, { is_active: !d.is_active });
                        toast.success(d.is_active ? "Disabled" : "Enabled");
                        load();
                      } catch (e) {
                        toast.error("Update failed", { description: (e as Error).message });
                      }
                    }}
                  >
                    {d.is_active
                      ? <><PowerOff className="mr-1 h-3.5 w-3.5" /> Disable</>
                      : <><Power className="mr-1 h-3.5 w-3.5" /> Enable</>}
                  </Button>
                ) : (
                  <Button
                    size="sm" variant="outline"
                    className="text-red-700 hover:bg-red-50 hover:text-red-700 border-red-200"
                    onClick={() => setConfirmDelete(d)}
                  >
                    <Trash2 className="mr-1 h-3.5 w-3.5" /> Delete
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Delete confirmation — only for non-builtin. Server also blocks. */}
      <Dialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        {confirmDelete && (
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete {confirmDelete.display_en}?</DialogTitle>
              <DialogDescription>
                This removes the custom department along with its shared login account.
                Historical tickets already routed to this department will keep the key
                stored but the label will fall back to the raw identifier. This can't be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmDelete(null)}>Cancel</Button>
              <Button
                className="bg-red-600 text-white hover:bg-red-700"
                onClick={async () => {
                  try {
                    await deleteDepartment(confirmDelete.id);
                    toast.success("Department deleted");
                    setConfirmDelete(null);
                    load();
                  } catch (e) {
                    toast.error("Delete failed", { description: (e as Error).message });
                  }
                }}
              >
                <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        {editing && (
          <DeptDialog
            title={`Edit ${editing.display_en}`}
            initial={editing}
            allowInactivate
            onSubmit={async (values) => {
              try {
                await updateDepartment(editing.id, values);
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

function DeptDialog({
  title, initial, onSubmit, allowInactivate,
}: {
  title: string;
  initial?: DepartmentRow;
  onSubmit: (values: {
    key: string; display_en: string; display_ta?: string; email?: string; is_active?: boolean;
  }) => Promise<void>;
  allowInactivate?: boolean;
}) {
  const [key, setKey] = useState(initial?.key ?? "");
  const [en, setEn] = useState(initial?.display_en ?? "");
  const [ta, setTa] = useState(initial?.display_ta ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [active, setActive] = useState(initial?.is_active ?? true);
  const [busy, setBusy] = useState(false);

  const isEdit = !!initial;

  return (
    <DialogContent>
      <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label>Key</Label>
          <Input value={key} onChange={(e) => setKey(e.target.value)}
                 disabled={isEdit}
                 placeholder="lowercase_with_underscores"
                 className="font-mono" />
          <p className="text-[11px] text-muted-foreground">
            Stable identifier used internally. Lowercase letters, digits, underscores. Cannot be changed later.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label>Display name (English)</Label>
          <Input value={en} onChange={(e) => setEn(e.target.value)} placeholder="e.g. Elementary Education" />
        </div>
        <div className="space-y-1.5">
          <Label>Display name (Tamil)</Label>
          <Input value={ta} onChange={(e) => setTa(e.target.value)} placeholder="e.g. தொடக்கக் கல்வி" />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label>Email</Label>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                 placeholder="dept@office.gov.in" />
          <p className="text-[11px] text-muted-foreground">
            Used for auto-forwarding petitions to this department once the email workflow ships.
          </p>
        </div>
        {allowInactivate && (
          <label className="col-span-full flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-card p-3 text-sm">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            <span className="font-medium">Active</span>
            <span className="text-xs text-muted-foreground">
              Uncheck to hide from routing without losing history.
            </span>
          </label>
        )}
      </div>
      <DialogFooter>
        <Button
          className="aurora-primary text-white"
          disabled={busy || !key || !en}
          onClick={async () => {
            setBusy(true);
            try {
              await onSubmit({
                key,
                display_en: en,
                display_ta: ta || undefined,
                email: email || undefined,
                ...(allowInactivate ? { is_active: active } : {}),
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
