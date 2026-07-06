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
  listUsers, createUser, updateUser, deleteUser,
  type UserRow, type Role,
} from "../_lib/adminApi";

const ROLE_LABELS: Record<Role, string> = {
  super_admin:  "Super admin",
  pa:           "PA officer",
  dept_officer: "Department officer",
  auditor:      "Auditor (read-only)",
};

const ROLE_TONE: Record<Role, Parameters<typeof StatusDot>[0]["tone"]> = {
  super_admin:  "brand",
  pa:           "blue",
  dept_officer: "emerald",
  auditor:      "slate",
};

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
  }) => Promise<void>;
  requirePassword?: boolean;
}) {
  const [loginName, setLoginName] = useState(initial?.login_name ?? "");
  const [fullName, setFullName]   = useState(initial?.full_name ?? "");
  const [email, setEmail]         = useState(initial?.email ?? "");
  const [role, setRole]           = useState<Role>(initial?.role ?? "pa");
  const [password, setPassword]   = useState("");
  const [busy, setBusy]           = useState(false);

  const isEdit = !!initial;

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
              {(Object.entries(ROLE_LABELS) as [Role, string][]).map(([k, v]) =>
                <SelectItem key={k} value={k}>{v}</SelectItem>
              )}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>{isEdit ? "New password (leave blank to keep)" : "Password"}</Label>
          <Input
            type="password" value={password} onChange={(e) => setPassword(e.target.value)}
            placeholder={isEdit ? "•••••• (unchanged)" : "min 6 characters"}
          />
        </div>
      </div>
      <DialogFooter>
        <Button
          className="aurora-primary text-white"
          disabled={busy || !loginName || (requirePassword && !password)}
          onClick={async () => {
            setBusy(true);
            try {
              await onSubmit({
                login_name: loginName,
                password: password || undefined,
                full_name: fullName || undefined,
                email: email || undefined,
                role,
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
