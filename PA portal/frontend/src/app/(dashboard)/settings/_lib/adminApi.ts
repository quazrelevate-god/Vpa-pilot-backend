// Typed fetch wrappers for the /api/v1/admin/* surface + /api/v1/me and
// /api/v1/features. All endpoints assume the caller has a valid dash_session
// cookie; admin/* additionally require role=super_admin server-side.

export type Role = "super_admin" | "pa" | "dept_officer" | "auditor";

export interface SessionUser {
  id: number;
  login_name: string;
  full_name: string | null;
  email: string | null;
  role: Role;
}

export interface FeatureFlags {
  superadmin_ui: boolean;
}

export interface UserRow {
  id: number;
  login_name: string;
  full_name: string | null;
  email: string | null;
  role: Role;
  is_active: boolean;
  created_at: string;
}

export interface DepartmentRow {
  id: number;
  key: string;
  display_en: string;
  display_ta: string | null;
  email: string | null;
  is_active: boolean;
  is_builtin: boolean;
}

export interface MinistryRow {
  id: number;
  key: string;
  display_en: string;
  display_ta: string | null;
  email: string | null;
  is_active: boolean;
}

export interface DeptAccountRow {
  id: number;
  department: string;
  username: string;
  display_name: string | null;
}

// ── Session helpers ────────────────────────────────────────────────────────
export async function fetchMe(signal?: AbortSignal): Promise<SessionUser | null> {
  const r = await fetch("/api/v1/me", { credentials: "include", cache: "no-store", signal });
  if (r.status === 401) return null;
  if (!r.ok) throw new Error(`me ${r.status}`);
  return r.json();
}

export async function fetchFeatures(signal?: AbortSignal): Promise<FeatureFlags> {
  const r = await fetch("/api/v1/features", { credentials: "include", cache: "no-store", signal });
  if (!r.ok) throw new Error(`features ${r.status}`);
  return r.json();
}

// ── Users ──────────────────────────────────────────────────────────────────
export async function listUsers(): Promise<UserRow[]> {
  const r = await fetch("/api/v1/admin/users", { credentials: "include", cache: "no-store" });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function createUser(body: {
  login_name: string; password: string; full_name?: string; email?: string; role: Role;
}): Promise<UserRow> {
  const r = await fetch("/api/v1/admin/users", {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error((await r.json()).detail ?? r.statusText);
  return r.json();
}

export async function updateUser(id: number, patch: {
  full_name?: string; email?: string; role?: Role; is_active?: boolean; password?: string;
}): Promise<UserRow> {
  const r = await fetch(`/api/v1/admin/users/${id}`, {
    method: "PATCH", credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!r.ok) throw new Error((await r.json()).detail ?? r.statusText);
  return r.json();
}

export async function deleteUser(id: number): Promise<void> {
  const r = await fetch(`/api/v1/admin/users/${id}`, { method: "DELETE", credentials: "include" });
  if (!r.ok) throw new Error((await r.json()).detail ?? r.statusText);
}

// ── Departments ────────────────────────────────────────────────────────────
export async function listDepartments(): Promise<DepartmentRow[]> {
  const r = await fetch("/api/v1/admin/departments", { credentials: "include", cache: "no-store" });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function createDepartment(body: {
  key: string; display_en: string; display_ta?: string; email?: string;
}): Promise<DepartmentRow> {
  const r = await fetch("/api/v1/admin/departments", {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error((await r.json()).detail ?? r.statusText);
  return r.json();
}

export async function updateDepartment(id: number, patch: {
  display_en?: string; display_ta?: string; email?: string; is_active?: boolean;
}): Promise<DepartmentRow> {
  const r = await fetch(`/api/v1/admin/departments/${id}`, {
    method: "PATCH", credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!r.ok) throw new Error((await r.json()).detail ?? r.statusText);
  return r.json();
}

// ── Ministries ─────────────────────────────────────────────────────────────
export async function listMinistries(): Promise<MinistryRow[]> {
  const r = await fetch("/api/v1/admin/ministries", { credentials: "include", cache: "no-store" });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function updateMinistry(id: number, patch: {
  email?: string; display_ta?: string; is_active?: boolean;
}): Promise<MinistryRow> {
  const r = await fetch(`/api/v1/admin/ministries/${id}`, {
    method: "PATCH", credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!r.ok) throw new Error((await r.json()).detail ?? r.statusText);
  return r.json();
}

// ── Department shared accounts ─────────────────────────────────────────────
export async function listDeptAccounts(): Promise<DeptAccountRow[]> {
  const r = await fetch("/api/v1/admin/dept-accounts", { credentials: "include", cache: "no-store" });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function createDeptAccount(body: {
  department: string; username: string; display_name?: string;
}): Promise<DeptAccountRow & { initial_password: string }> {
  const r = await fetch("/api/v1/admin/dept-accounts", {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error((await r.json()).detail ?? r.statusText);
  return r.json();
}

export async function resetDeptPassword(deptKey: string, password?: string): Promise<{
  department: string; username: string; password: string;
}> {
  const r = await fetch(`/api/v1/admin/dept-accounts/${deptKey}/reset-password`, {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(password ? { password } : {}),
  });
  if (!r.ok) throw new Error((await r.json()).detail ?? r.statusText);
  return r.json();
}
