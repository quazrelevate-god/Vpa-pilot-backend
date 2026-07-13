"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Users, Plus, Pencil, ShieldOff, Check, X, MailIcon, Trash2, KeyRound,
} from "lucide-react";

import { SectionCard, StatusDot } from "@/components/ui/detail-primitives";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { InitialsAvatar } from "@/components/ui/avatar";

import { useLang } from "@/lib/lang-context";
import {
  listUsers, createUser, updateUser, deleteUser, listDepartments,
  type UserRow, type Role, type DepartmentRow,
} from "../_lib/adminApi";

// Role → translation key (the "user type" badge/select label).
const ROLE_KEY: Record<Role, string> = {
  super_admin:       "set.roleSuperAdmin",
  pa:                "set.rolePa",
  petition_reviewer: "set.rolePetitionReviewer",
  dept_officer:      "set.roleDeptOfficer",
  auditor:           "set.roleAuditor",
};

const ROLE_TONE: Record<Role, Parameters<typeof StatusDot>[0]["tone"]> = {
  super_admin:       "brand",
  pa:                "blue",
  petition_reviewer: "amber",
  dept_officer:      "emerald",
  auditor:           "slate",
};

// Human-friendly "what does this role actually do" — shown live under the
// Role select when the admin is picking a role. Kept short and concrete —
// this is the moment where a wrong click grants too much access.
const ROLE_CAPABILITIES: Record<Role, {
  can: string[];
  cannot: string[];
  scope: string;
}> = {
  super_admin: {
    scope: "Full platform access.",
    can: [
      "Everything a PA officer can do",
      "Access the Settings page",
      "Create, edit, disable staff users + assign roles",
      "Add / rename / disable departments and set their emails",
      "Set the contact email for every Ministry",
      "Rotate / delete department shared login passwords",
    ],
    cannot: [
      "Delete their own account (safety guard)",
    ],
  },
  pa: {
    scope: "Daily case work in the PA portal.",
    can: [
      "See and edit appointments, tickets, petitions, referrals",
      "Run petition review + AI review",
      "Manage scheduling + slots",
      "Read the crowd QR + display board",
    ],
    cannot: [
      "Access Settings",
      "Create or edit other users",
      "Change department / ministry configuration",
    ],
  },
  petition_reviewer: {
    scope: "Case review across the PA portal.",
    can: [
      "View and edit appointments",
      "Run petition review + edit petitions",
      "View and edit tickets",
    ],
    cannot: [
      "Access Settings, Scheduling, AI Uploads, Executive Queue or Crowd QR",
      "Create or edit other users",
      "Change department / ministry configuration",
    ],
  },
  dept_officer: {
    scope: "Department workspace only.",
    can: [
      "Log in to the department dashboard (separate URL)",
      "Accept, progress, resolve tickets routed to this department",
      "Forward tickets to another department",
      "Upload resolution proofs",
    ],
    cannot: [
      "Access the PA portal or Settings",
      "See petitions routed to other departments",
      "Change classifications the AI made",
    ],
  },
  auditor: {
    scope: "Read-only visibility across the PA portal.",
    can: [
      "View appointments, tickets, activity timelines, reports",
      "Export petition / ticket lists",
    ],
    cannot: [
      "Create, edit or delete anything",
      "Access Settings",
      "Trigger status changes or notifications",
    ],
  },
};

function RolePreview({ role }: { role: Role }) {
  const { t } = useLang();
  const info = ROLE_CAPABILITIES[role];
  return (
    <div className="rounded-xl border border-border bg-muted/40 p-3">
      <div className="mb-1.5 flex items-center gap-2">
        <StatusDot label={t(ROLE_KEY[role])} tone={ROLE_TONE[role]} />
        <span className="text-[12px] font-medium text-muted-foreground">{info.scope}</span>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">{t("set.canDo")}</div>
          <ul className="mt-1 space-y-0.5 text-[12px] text-foreground/85">
            {info.can.map((c) => (
              <li key={c} className="flex gap-1.5"><span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-emerald-500" /><span>{c}</span></li>
            ))}
          </ul>
        </div>
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-600">{t("set.cantDo")}</div>
          <ul className="mt-1 space-y-0.5 text-[12px] text-muted-foreground">
            {info.cannot.map((c) => (
              <li key={c} className="flex gap-1.5"><span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-slate-400" /><span>{c}</span></li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

export default function UsersTab({ currentUserId }: { currentUserId: number }) {
  const { t } = useLang();
  const [rows, setRows] = useState<UserRow[] | null>(null);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [openCreate, setOpenCreate] = useState(false);

  const load = async () => {
    try { setRows(await listUsers()); }
    catch (e) { toast.error(t("set.loadFailed"), { description: (e as Error).message }); }
  };

  useEffect(() => { load(); }, []);

  return (
    <SectionCard
      icon={Users}
      title={t("set.usersTitle")}
      right={
        <Dialog open={openCreate} onOpenChange={setOpenCreate}>
          <DialogTrigger asChild>
            <Button size="sm" className="aurora-primary text-white">
              <Plus className="mr-1.5 h-3.5 w-3.5" /> {t("set.usersAdd")}
            </Button>
          </DialogTrigger>
          {openCreate && (
          <UserFormDialog
            title={t("set.usersAddTitle")}
            requirePassword
            onSubmit={async (values) => {
              if (!values.password) {
                toast.error(t("set.passwordRequired")); return;
              }
              try {
                await createUser({
                  login_name: values.login_name,
                  password: values.password,
                  full_name: values.full_name,
                  email: values.email,
                  role: values.role,
                  department: values.department,
                });
                toast.success(t("set.userCreated"));
                setOpenCreate(false);
                load();
              } catch (e) {
                toast.error(t("set.createFailed"), { description: (e as Error).message });
              }
            }}
          />
          )}
        </Dialog>
      }
    >
      {rows === null ? (
        <div className="space-y-2">
          {[1, 2, 3].map((k) => <Skeleton key={k} className="h-14 w-full rounded-xl" />)}
        </div>
      ) : rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">{t("set.usersNone")}</p>
      ) : (
        <div className="divide-y divide-border rounded-xl border border-border bg-card">
          {rows.map((u) => (
            <div key={u.id} className="flex items-center gap-3 px-4 py-3">
              <InitialsAvatar name={u.full_name || u.login_name} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-foreground">
                    {u.full_name || u.login_name}
                  </span>
                  <StatusDot label={t(ROLE_KEY[u.role])} tone={ROLE_TONE[u.role]} />
                  {!u.is_active && <StatusDot label={t("set.disabledTag")} tone="red" />}
                  {u.id === currentUserId && <StatusDot label={t("set.you")} tone="brand" />}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-3 text-[12px] text-muted-foreground">
                  <span className="font-mono">@{u.login_name}</span>
                  {u.email && (
                    <span className="inline-flex items-center gap-1"><MailIcon className="h-3 w-3" /> {u.email}</span>
                  )}
                </div>
              </div>
              <div className="flex flex-shrink-0 items-center gap-1.5">
                <Button size="sm" variant="outline" onClick={() => setEditing(u)}>
                  <Pencil className="mr-1 h-3.5 w-3.5" /> {t("set.edit")}
                </Button>
                {u.is_active && u.id !== currentUserId && (
                  <Button
                    size="sm" variant="outline"
                    onClick={async () => {
                      try {
                        await deleteUser(u.id);
                        toast.success(`${t("set.disabledPrefix")} ${u.login_name}`);
                        load();
                      } catch (e) {
                        toast.error(t("set.disableFailed"), { description: (e as Error).message });
                      }
                    }}
                  >
                    <ShieldOff className="mr-1 h-3.5 w-3.5" /> {t("set.disable")}
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Edit dialog — reused UserFormDialog */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        {editing && (
          <UserFormDialog
            title={`${t("set.edit")} ${editing.login_name}`}
            initial={editing}
            onSubmit={async (values) => {
              try {
                await updateUser(editing.id, {
                  full_name: values.full_name,
                  email: values.email,
                  role: values.role,
                  department: values.department,
                  ...(values.password ? { password: values.password } : {}),
                });
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

// ── Reusable form dialog ───────────────────────────────────────────────────

function UserFormDialog({
  title, initial, onSubmit, requirePassword,
}: {
  title: string;
  initial?: UserRow;
  onSubmit: (values: {
    login_name: string;
    password: string | undefined;
    full_name?: string;
    email?: string;
    role: Role;
    department?: string;
  }) => Promise<void>;
  requirePassword?: boolean;
}) {
  const { t, lang } = useLang();
  const [loginName, setLoginName] = useState(initial?.login_name ?? "");
  const [fullName, setFullName]   = useState(initial?.full_name ?? "");
  const [email, setEmail]         = useState(initial?.email ?? "");
  const [role, setRole]           = useState<Role>(initial?.role ?? "pa");
  const [department, setDepartment] = useState<string>(initial?.department ?? "");
  const [departments, setDepartments] = useState<DepartmentRow[]>([]);
  const [password, setPassword]   = useState("");
  const [busy, setBusy]           = useState(false);

  const isEdit = !!initial;
  const needsDept = role === "dept_officer";
  const emailInvalid = !!email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  useEffect(() => {
    listDepartments().then((d) => setDepartments(d.filter((x) => x.is_active))).catch(() => {});
  }, []);

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
      </DialogHeader>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label>{t("set.username")}</Label>
          <Input
            value={loginName}
            onChange={(e) => setLoginName(e.target.value)}
            disabled={isEdit}
            placeholder="ex. bhuvanesh"
          />
        </div>
        <div className="space-y-1.5">
          <Label>{t("set.fullName")}</Label>
          <Input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Full name" />
        </div>
        <div className="space-y-1.5">
          <Label>{t("set.email")}</Label>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="user@office.gov.in"
            aria-invalid={emailInvalid}
            className={emailInvalid ? "border-red-400 focus-visible:ring-red-400" : ""} />
          {emailInvalid && <p className="text-xs text-red-600">{t("set.emailInvalid")}</p>}
        </div>
        <div className="space-y-1.5">
          <Label>{t("set.role")}</Label>
          <Select value={role} onValueChange={(v) => setRole(v as Role)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {(Object.keys(ROLE_KEY) as Role[])
                // dept_officer is deprecated in the UI — only surface it when
                // editing a user who already has that role.
                .filter((k) => k !== "dept_officer" || initial?.role === "dept_officer")
                .map((k) =>
                  <SelectItem key={k} value={k}>{t(ROLE_KEY[k])}</SelectItem>
                )}
            </SelectContent>
          </Select>
        </div>
        {needsDept && (
          <div className="space-y-1.5">
            <Label>{t("set.department")}</Label>
            <Select value={department} onValueChange={setDepartment}>
              <SelectTrigger><SelectValue placeholder={t("set.selectDepartment")} /></SelectTrigger>
              <SelectContent>
                {departments.map((d) =>
                  <SelectItem key={d.key} value={d.key}>{lang === "ta" && d.display_ta ? d.display_ta : d.display_en}</SelectItem>
                )}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">{t("set.deptOfficerHint")}</p>
          </div>
        )}
        <div className="space-y-1.5">
          <Label>{isEdit ? t("set.newPassword") : t("set.password")}</Label>
          <Input
            type="password" value={password} onChange={(e) => setPassword(e.target.value)}
            placeholder={isEdit ? "•••••• (unchanged)" : "min 6 characters"}
          />
        </div>
        <div className="sm:col-span-2">
          <RolePreview role={role} />
        </div>
      </div>
      <DialogFooter>
        <Button
          className="aurora-primary text-white"
          disabled={busy || !loginName || emailInvalid || (requirePassword && !password) || (needsDept && !department)}
          onClick={async () => {
            setBusy(true);
            try {
              await onSubmit({
                login_name: loginName,
                password: password || undefined,
                full_name: fullName || undefined,
                email: email || undefined,
                role,
                department: needsDept ? department : undefined,
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
