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

import { useLang } from "@/lib/lang-context";
import {
  listDepartments, createDepartment, updateDepartment, deleteDepartment,
  type DepartmentRow,
} from "../_lib/adminApi";

export default function DepartmentsTab() {
  const { t, lang } = useLang();
  const [rows, setRows] = useState<DepartmentRow[] | null>(null);
  const [openCreate, setOpenCreate] = useState(false);
  const [editing, setEditing] = useState<DepartmentRow | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<DepartmentRow | null>(null);

  const load = async () => {
    try { setRows(await listDepartments()); }
    catch (e) { toast.error(t("set.loadFailed"), { description: (e as Error).message }); }
  };

  useEffect(() => { load(); }, []);

  return (
    <SectionCard
      icon={Building2}
      title={t("set.deptTitle")}
      right={
        <Dialog open={openCreate} onOpenChange={setOpenCreate}>
          <DialogTrigger asChild>
            <Button size="sm" className="aurora-primary text-white">
              <Plus className="mr-1.5 h-3.5 w-3.5" /> {t("set.deptAdd")}
            </Button>
          </DialogTrigger>
          <DeptDialog
            title={t("set.deptAddTitle")}
            onSubmit={async (values) => {
              try {
                await createDepartment(values);
                toast.success(t("set.deptAddedToast"));
                setOpenCreate(false);
                load();
              } catch (e) {
                toast.error(t("set.createFailed"), { description: (e as Error).message });
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
                  <span className="text-sm font-semibold text-foreground">{lang === "ta" && d.display_ta ? d.display_ta : d.display_en}</span>
                  {d.is_builtin && <StatusDot label={t("set.builtin")} tone="brand" />}
                  {!d.is_active && <StatusDot label={t("set.inactive")} tone="slate" />}
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-3 text-[12px] text-muted-foreground">
                  <span className="font-mono">{d.key}</span>
                  {lang === "ta" ? <span>· {d.display_en}</span> : (d.display_ta && <span>· {d.display_ta}</span>)}
                  {d.email && (
                    <span className="inline-flex items-center gap-1">
                      <MailIcon className="h-3 w-3" /> {d.email}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex flex-shrink-0 items-center gap-1.5">
                <Button size="sm" variant="outline" onClick={() => setEditing(d)}>
                  <Pencil className="mr-1 h-3.5 w-3.5" /> {t("set.edit")}
                </Button>
                {d.is_builtin ? (
                  <Button
                    size="sm" variant="outline"
                    title={d.is_active ? t("set.deptDisableTitle") : t("set.deptEnableTitle")}
                    onClick={async () => {
                      try {
                        await updateDepartment(d.id, { is_active: !d.is_active });
                        toast.success(d.is_active ? t("set.disabledTag") : t("set.enabledTag"));
                        load();
                      } catch (e) {
                        toast.error(t("set.updateFailed"), { description: (e as Error).message });
                      }
                    }}
                  >
                    {d.is_active
                      ? <><PowerOff className="mr-1 h-3.5 w-3.5" /> {t("set.disable")}</>
                      : <><Power className="mr-1 h-3.5 w-3.5" /> {t("set.enable")}</>}
                  </Button>
                ) : (
                  <Button
                    size="sm" variant="outline"
                    className="text-red-700 hover:bg-red-50 hover:text-red-700 border-red-200"
                    onClick={() => setConfirmDelete(d)}
                  >
                    <Trash2 className="mr-1 h-3.5 w-3.5" /> {t("set.delete")}
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
              <DialogTitle>{t("set.deptDeletePrefix")} {lang === "ta" && confirmDelete.display_ta ? confirmDelete.display_ta : confirmDelete.display_en}?</DialogTitle>
              <DialogDescription>
                {t("set.deptDeleteDesc")}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmDelete(null)}>{t("set.cancel")}</Button>
              <Button
                className="bg-red-600 text-white hover:bg-red-700"
                onClick={async () => {
                  try {
                    await deleteDepartment(confirmDelete.id);
                    toast.success(t("set.deptDeletedToast"));
                    setConfirmDelete(null);
                    load();
                  } catch (e) {
                    toast.error(t("set.deleteFailed"), { description: (e as Error).message });
                  }
                }}
              >
                <Trash2 className="mr-1.5 h-3.5 w-3.5" /> {t("set.delete")}
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        {editing && (
          <DeptDialog
            title={`${t("set.deptEditPrefix")} ${lang === "ta" && editing.display_ta ? editing.display_ta : editing.display_en}`}
            initial={editing}
            allowInactivate
            onSubmit={async (values) => {
              try {
                await updateDepartment(editing.id, values);
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
  const { t } = useLang();
  const [key, setKey] = useState(initial?.key ?? "");
  const [en, setEn] = useState(initial?.display_en ?? "");
  const [ta, setTa] = useState(initial?.display_ta ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [active, setActive] = useState(initial?.is_active ?? true);
  const [busy, setBusy] = useState(false);

  const isEdit = !!initial;
  const emailInvalid = !!email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  return (
    <DialogContent>
      <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label>{t("set.deptKey")}</Label>
          <Input value={key} onChange={(e) => setKey(e.target.value)}
                 disabled={isEdit}
                 placeholder="lowercase_with_underscores"
                 className="font-mono" />
          <p className="text-[11px] text-muted-foreground">
            {t("set.deptKeyHint")}
          </p>
        </div>
        <div className="space-y-1.5">
          <Label>{t("set.deptNameEn")}</Label>
          <Input value={en} onChange={(e) => setEn(e.target.value)} placeholder="e.g. Elementary Education" />
        </div>
        <div className="space-y-1.5">
          <Label>{t("set.deptNameTa")}</Label>
          <Input value={ta} onChange={(e) => setTa(e.target.value)} placeholder="e.g. தொடக்கக் கல்வி" />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label>{t("set.email")}</Label>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                 placeholder="dept@office.gov.in"
                 aria-invalid={emailInvalid}
                 className={emailInvalid ? "border-red-400 focus-visible:ring-red-400" : ""} />
          {emailInvalid && <p className="text-xs text-red-600">{t("set.emailInvalid")}</p>}
          <p className="text-[11px] text-muted-foreground">
            {t("set.deptEmailHint")}
          </p>
        </div>
        {allowInactivate && (
          <label className="col-span-full flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-card p-3 text-sm">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            <span className="font-medium">{t("set.active")}</span>
            <span className="text-xs text-muted-foreground">
              {t("set.deptActiveHint")}
            </span>
          </label>
        )}
      </div>
      <DialogFooter>
        <Button
          className="aurora-primary text-white"
          disabled={busy || !key || !en || emailInvalid}
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
          <Check className="mr-1.5 h-3.5 w-3.5" /> {t("set.save")}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
