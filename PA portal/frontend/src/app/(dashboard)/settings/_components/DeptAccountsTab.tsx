"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { KeyRound, Copy, Check, RefreshCw, Plus, Building2, Trash2, Eye, EyeOff } from "lucide-react";

import { SectionCard, StatusDot } from "@/components/ui/detail-primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

import {
  listDeptAccounts, listDepartments, createDeptAccount, resetDeptPassword,
  deleteDeptAccount,
  type DeptAccountRow, type DepartmentRow,
} from "../_lib/adminApi";

export default function DeptAccountsTab() {
  const [rows, setRows]         = useState<DeptAccountRow[] | null>(null);
  const [depts, setDepts]       = useState<DepartmentRow[] | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [reveal, setReveal]     = useState<null | { username: string; password: string; department: string }>(null);
  const [resetFor, setResetFor] = useState<DeptAccountRow | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<DeptAccountRow | null>(null);

  const load = async () => {
    try {
      const [a, d] = await Promise.all([listDeptAccounts(), listDepartments()]);
      setRows(a); setDepts(d);
    } catch (e) {
      toast.error("Load failed", { description: (e as Error).message });
    }
  };
  useEffect(() => { load(); }, []);

  const deptLabel = (key: string) =>
    depts?.find((d) => d.key === key)?.display_en ?? key;

  const deptsWithoutAccount = (depts ?? []).filter(
    (d) => d.is_active && !rows?.some((r) => r.department === d.key),
  );

  return (
    <SectionCard
      icon={KeyRound}
      title="Department shared logins"
      right={
        deptsWithoutAccount.length > 0 && (
          <Button size="sm" className="aurora-primary text-white" onClick={() => setShowCreate(true)}>
            <Plus className="mr-1.5 h-3.5 w-3.5" /> New account
          </Button>
        )
      }
    >
      <p className="mb-4 text-[13px] text-muted-foreground">
        One shared credential per department. Anyone from that team signs in with it — every action is
        attributed to the department, not the individual. Use <b>Reset</b> when staff turn over.
      </p>

      {rows === null ? (
        <div className="space-y-2">
          {[1, 2, 3].map((k) => <Skeleton key={k} className="h-14 w-full rounded-xl" />)}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center">
          <KeyRound className="mx-auto h-6 w-6 text-muted-foreground" />
          <p className="mt-2 text-sm font-medium">No department accounts yet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Create one per active department to unlock the dept workspace login.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-border rounded-xl border border-border bg-card">
          {rows.map((r) => (
            <div key={r.id} className="flex items-center gap-3 px-4 py-3">
              <div className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-lg bg-brand/10 text-brand">
                <Building2 className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-foreground">
                  {deptLabel(r.department)}
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-3 text-[12px] text-muted-foreground">
                  <span className="font-mono">@{r.username}</span>
                  {r.display_name && <span>· {r.display_name}</span>}
                </div>
              </div>
              <div className="flex flex-shrink-0 items-center gap-1.5">
                <Button
                  size="sm" variant="outline"
                  onClick={() => setResetFor(r)}
                >
                  <RefreshCw className="mr-1 h-3.5 w-3.5" /> Reset password
                </Button>
                <Button
                  size="sm" variant="outline"
                  className="text-red-700 hover:bg-red-50 hover:text-red-700 border-red-200"
                  title="Delete this shared login"
                  onClick={() => setConfirmDelete(r)}
                >
                  <Trash2 className="mr-1 h-3.5 w-3.5" /> Delete
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Delete confirmation */}
      <Dialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        {confirmDelete && (
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete {deptLabel(confirmDelete.department)} login?</DialogTitle>
              <DialogDescription>
                The department team will no longer be able to sign in. Historical tickets
                already accepted by this account remain in the system. You can re-create
                the account any time with a new username.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmDelete(null)}>Cancel</Button>
              <Button
                className="bg-red-600 text-white hover:bg-red-700"
                onClick={async () => {
                  try {
                    await deleteDeptAccount(confirmDelete.id);
                    toast.success("Account deleted");
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

      {/* Create dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <CreateDeptAccountDialog
          departments={deptsWithoutAccount}
          onCreated={(row, initialPassword) => {
            setShowCreate(false);
            setReveal({ username: row.username, password: initialPassword, department: row.department });
            load();
          }}
        />
      </Dialog>

      {/* Reset dialog — set a chosen password or auto-generate */}
      <Dialog open={!!resetFor} onOpenChange={(o) => !o && setResetFor(null)}>
        {resetFor && (
          <ResetDialog
            departmentLabel={deptLabel(resetFor.department)}
            onCancel={() => setResetFor(null)}
            onReset={async (password) => {
              const out = await resetDeptPassword(resetFor.department, password);
              setResetFor(null);
              setReveal({ username: out.username, password: out.password, department: resetFor.department });
              toast.success("Password reset");
            }}
          />
        )}
      </Dialog>

      {/* Password reveal dialog */}
      <Dialog open={!!reveal} onOpenChange={(o) => !o && setReveal(null)}>
        {reveal && (
          <RevealDialog
            username={reveal.username}
            password={reveal.password}
            departmentLabel={deptLabel(reveal.department)}
          />
        )}
      </Dialog>
    </SectionCard>
  );
}

function CreateDeptAccountDialog({
  departments, onCreated,
}: {
  departments: DepartmentRow[];
  onCreated: (row: DeptAccountRow, initialPassword: string) => void;
}) {
  const [dept, setDept] = useState<string>(departments[0]?.key ?? "");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>New department account</DialogTitle>
        <DialogDescription>
          The initial password is shown once — copy and hand it to the department team.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label>Department</Label>
          <Select value={dept} onValueChange={setDept}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {departments.map((d) =>
                <SelectItem key={d.key} value={d.key}>{d.display_en}</SelectItem>
              )}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Username</Label>
          <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="scert_team" />
        </div>
        <div className="space-y-1.5">
          <Label>Display name (optional)</Label>
          <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)}
                 placeholder="SCERT operations desk" />
        </div>
      </div>
      <DialogFooter>
        <Button
          className="aurora-primary text-white"
          disabled={busy || !dept || !username}
          onClick={async () => {
            setBusy(true);
            try {
              const out = await createDeptAccount({
                department: dept,
                username,
                display_name: displayName || undefined,
              });
              onCreated({
                id: out.id, department: out.department, username: out.username,
                display_name: out.display_name,
              }, out.initial_password);
            } catch (e) {
              toast.error("Create failed", { description: (e as Error).message });
            } finally {
              setBusy(false);
            }
          }}
        >
          <Check className="mr-1.5 h-3.5 w-3.5" /> Create + generate password
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

function ResetDialog({
  departmentLabel, onCancel, onReset,
}: {
  departmentLabel: string;
  onCancel: () => void;
  onReset: (password?: string) => Promise<void>;
}) {
  const [pw, setPw] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const trimmed = pw.trim();
  const custom = trimmed.length > 0;
  const tooShort = custom && trimmed.length < 8;

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Reset password — {departmentLabel}</DialogTitle>
        <DialogDescription>
          Set a password the team will remember, or leave it blank to generate a strong one.
          The new password is shown once so you can hand it over.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-1.5">
        <Label>New password <span className="font-normal text-muted-foreground">(optional)</span></Label>
        <div className="relative">
          <Input
            type={show ? "text" : "password"}
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            placeholder="Leave blank to auto-generate"
            className="pr-11 font-mono"
          />
          <button
            type="button"
            onClick={() => setShow((v) => !v)}
            aria-label={show ? "Hide password" : "Show password"}
            className="absolute right-1.5 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-md text-muted-foreground transition-colors hover:text-foreground"
          >
            {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        {tooShort && <p className="text-xs font-medium text-red-600">At least 8 characters.</p>}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button
          className="aurora-primary text-white"
          disabled={busy || tooShort}
          onClick={async () => {
            setBusy(true);
            try {
              await onReset(custom ? trimmed : undefined);
            } catch (e) {
              toast.error("Reset failed", { description: (e as Error).message });
            } finally {
              setBusy(false);
            }
          }}
        >
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> {custom ? "Set password" : "Generate + reset"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

function RevealDialog({
  username, password, departmentLabel,
}: {
  username: string; password: string; departmentLabel: string;
}) {
  const [copiedPw, setCopiedPw] = useState(false);
  const [copiedBoth, setCopiedBoth] = useState(false);

  const copy = async (text: string, kind: "pw" | "both") => {
    try {
      await navigator.clipboard.writeText(text);
      if (kind === "pw") { setCopiedPw(true); setTimeout(() => setCopiedPw(false), 1500); }
      else { setCopiedBoth(true); setTimeout(() => setCopiedBoth(false), 1500); }
    } catch {}
  };

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>New password for {departmentLabel}</DialogTitle>
        <DialogDescription>
          This password is shown once. Copy it now — after closing this dialog it can't be retrieved.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/40 px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Username</div>
            <div className="font-mono text-sm font-semibold text-foreground">{username}</div>
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-xl border-2 border-brand/40 bg-brand/5 px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-bold uppercase tracking-wider text-brand">Password</div>
            <div className="font-mono text-lg font-bold text-foreground">{password}</div>
          </div>
          <Button size="sm" variant="outline" onClick={() => copy(password, "pw")}>
            {copiedPw ? <Check className="mr-1 h-3.5 w-3.5" /> : <Copy className="mr-1 h-3.5 w-3.5" />}
            {copiedPw ? "Copied" : "Copy"}
          </Button>
        </div>
      </div>
      <DialogFooter>
        <Button
          variant="outline"
          onClick={() => copy(`Username: ${username}\nPassword: ${password}`, "both")}
        >
          {copiedBoth ? <Check className="mr-1 h-3.5 w-3.5" /> : <Copy className="mr-1 h-3.5 w-3.5" />}
          {copiedBoth ? "Copied both" : "Copy both"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
