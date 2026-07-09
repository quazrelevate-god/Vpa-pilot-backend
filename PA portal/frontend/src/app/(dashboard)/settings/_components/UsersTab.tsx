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

import {
  listUsers, createUser, updateUser, deleteUser, listDepartments,
  type UserRow, type Role, type DepartmentRow,
} from "../_lib/adminApi";

const ROLE_LABELS: Record<Role, string> = {
  super_admin:       "Super admin",
  pa:                "PA officer",
  petition_reviewer: "Petition reviewer",
  dept_officer:      "Department officer",
  auditor:           "Auditor (read-only)",
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
  const info = ROLE_CAPABILITIES[role];
  return (
    <div className="rounded-xl border border-border bg-muted/40 p-3">
      <div className="mb-1.5 flex items-center gap-2">
        <StatusDot label={ROLE_LABELS[role]} tone={ROLE_TONE[role]} />
        <span className="text-[12px] font-medium text-muted-foreground">{info.scope}</span>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">Can do</div>
          <ul className="mt-1 space-y-0.5 text-[12px] text-foreground/85">
            {info.can.map((c) => (
              <li key={c} className="flex gap-1.5"><span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-emerald-500" /><span>{c}</span></li>
            ))}
          </ul>
        </div>
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-600">Can't do</div>
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
  const [rows, setRows] = useState<UserRow[] | null>(null);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [openCreate, setOpenCreate] = useState(false);

  const load = async () => {
    try { setRows(await listUsers()); }
    catch (e) { toast.error("Load failed", { description: (e as Error).message }); }
  };

  useEffect(() => { load(); }, []);

  return (
    <SectionCard
      icon={Users}
      title="Staff logins"
      right={
        <Dialog open={openCreate} onOpenChange={setOpenCreate}>
          <DialogTrigger asChild>
            <Button size="sm" className="aurora-primary text-white">
              <Plus className="mr-1.5 h-3.5 w-3.5" /> Add user
            </Button>
          </DialogTrigger>
          <UserFormDialog
            title="Add new user"
            requirePassword
            onSubmit={async (values) => {
              if (!values.password) {
                toast.error("Password required"); return;
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
                toast.success("User created");
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
      ) : rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">No users yet.</p>
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
                  <StatusDot label={ROLE_LABELS[u.role]} tone={ROLE_TONE[u.role]} />
                  {!u.is_active && <StatusDot label="Disabled" tone="red" />}
                  {u.id === currentUserId && <StatusDot label="You" tone="brand" />}
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
                  <Pencil className="mr-1 h-3.5 w-3.5" /> Edit
                </Button>
                {u.is_active && u.id !== currentUserId && (
                  <Button
                    size="sm" variant="outline"
                    onClick={async () => {
                      try {
                        await deleteUser(u.id);
                        toast.success(`Disabled ${u.login_name}`);
                        load();
                      } catch (e) {
                        toast.error("Disable failed", { description: (e as Error).message });
                      }
                    }}
                  >
                    <ShieldOff className="mr-1 h-3.5 w-3.5" /> Disable
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
            title={`Edit ${editing.login_name}`}
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
          <Label>Username</Label>
          <Input
            value={loginName}
            onChange={(e) => setLoginName(e.target.value)}
            disabled={isEdit}
            placeholder="ex. bhuvanesh"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Full name</Label>
          <Input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Full name" />
        </div>
        <div className="space-y-1.5">
          <Label>Email</Label>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="user@office.gov.in" />
        </div>
        <div className="space-y-1.5">
          <Label>Role</Label>
          <Select value={role} onValueChange={(v) => setRole(v as Role)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {(Object.entries(ROLE_LABELS) as [Role, string][])
                // dept_officer is deprecated in the UI — only surface it when
                // editing a user who already has that role.
                .filter(([k]) => k !== "dept_officer" || initial?.role === "dept_officer")
                .map(([k, v]) =>
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                )}
            </SelectContent>
          </Select>
        </div>
        {needsDept && (
          <div className="space-y-1.5">
            <Label>Department</Label>
            <Select value={department} onValueChange={setDepartment}>
              <SelectTrigger><SelectValue placeholder="Select department" /></SelectTrigger>
              <SelectContent>
                {departments.map((d) =>
                  <SelectItem key={d.key} value={d.key}>{d.display_en}</SelectItem>
                )}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">This officer will only see tickets routed to this department.</p>
          </div>
        )}
        <div className="space-y-1.5">
          <Label>{isEdit ? "New password (leave blank to keep)" : "Password"}</Label>
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
          disabled={busy || !loginName || (requirePassword && !password) || (needsDept && !department)}
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
          <Check className="mr-1.5 h-3.5 w-3.5" /> Save
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
