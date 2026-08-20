// Typed fetch wrappers for the /api/v1/admin/* surface + /api/v1/me and
// /api/v1/features. All endpoints assume the caller has a valid dash_session
// cookie; admin/* additionally require role=super_admin server-side.

export type Role = "super_admin" | "pa" | "petition_reviewer" | "dept_officer" | "auditor";

// Capability roles are additive — a user can hold any subset independently
// of their primary Role. First surface to consume them is the events PWA.
export type CapabilityRole = "event_uploader" | "event_reviewer";
export const ALL_CAPABILITY_ROLES: readonly CapabilityRole[] = ["event_uploader", "event_reviewer"];

export interface SessionUser {
  id: number;
  login_name: string;
  full_name: string | null;
  email: string | null;
  role: Role;
  department: string | null;   // set for dept_officer — the department they're scoped to
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
  department: string | null;
  capability_roles: CapabilityRole[];
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

export interface VenueRow {
  id: number;
  key: string;
  display_en: string;
  display_ta: string | null;
  address: string | null;
  is_active: boolean;
  is_builtin: boolean;
}

// ── Error parsing ──────────────────────────────────────────────────────────
/**
 * Turn a failed Response into a readable Error. FastAPI's 422 validation errors
 * return `detail` as an ARRAY of objects ([{loc, msg, type}]) — passing that to
 * `new Error()` stringifies to "[object Object]". Flatten it to the message(s).
 */
export async function apiError(r: Response): Promise<Error & { status?: number }> {
  // 5xx: never surface the body (may be an HTML page or a stack). Attach the
  // status; lib/errors.toUserMessage turns it into a friendly generic.
  if (r.status >= 500) {
    const err = new Error(`Request failed (${r.status})`) as Error & { status?: number };
    err.status = r.status;
    return err;
  }
  let data: unknown = null;
  try { data = await r.json(); } catch { /* non-JSON body */ }
  const d = (data as { detail?: unknown })?.detail;
  let msg: string;
  if (typeof d === "string") {
    msg = d;
  } else if (Array.isArray(d)) {
    msg = d.map((x) => (x as { msg?: string })?.msg).filter(Boolean).join("; ") || "Invalid input.";
  } else if (d && typeof d === "object") {
    msg = (d as { msg?: string }).msg ?? "Invalid input.";
  } else {
    msg = String((data as { error?: string })?.error ?? r.statusText ?? `Request failed (${r.status})`);
  }
  const err = new Error(msg) as Error & { status?: number };
  err.status = r.status;
  return err;
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
  if (!r.ok) throw await apiError(r);
  return r.json();
}

export async function createUser(body: {
  login_name: string; password: string; full_name?: string; email?: string; role: Role;
  department?: string; capability_roles?: CapabilityRole[];
}): Promise<UserRow> {
  const r = await fetch("/api/v1/admin/users", {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw await apiError(r);
  return r.json();
}

export async function updateUser(id: number, patch: {
  full_name?: string; email?: string; role?: Role; is_active?: boolean; password?: string;
  department?: string; capability_roles?: CapabilityRole[];
}): Promise<UserRow> {
  const r = await fetch(`/api/v1/admin/users/${id}`, {
    method: "PATCH", credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!r.ok) throw await apiError(r);
  return r.json();
}

export async function deleteUser(id: number): Promise<void> {
  const r = await fetch(`/api/v1/admin/users/${id}`, { method: "DELETE", credentials: "include" });
  if (!r.ok) throw await apiError(r);
}

// ── Departments ────────────────────────────────────────────────────────────
export async function listDepartments(): Promise<DepartmentRow[]> {
  const r = await fetch("/api/v1/admin/departments", { credentials: "include", cache: "no-store" });
  if (!r.ok) throw await apiError(r);
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
  if (!r.ok) throw await apiError(r);
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
  if (!r.ok) throw await apiError(r);
  return r.json();
}

export async function deleteDepartment(id: number): Promise<void> {
  const r = await fetch(`/api/v1/admin/departments/${id}`, {
    method: "DELETE", credentials: "include",
  });
  if (!r.ok) throw await apiError(r);
}

// ── Venues ─────────────────────────────────────────────────────────────────
export async function listVenues(): Promise<VenueRow[]> {
  const r = await fetch("/api/v1/admin/venues", { credentials: "include", cache: "no-store" });
  if (!r.ok) throw await apiError(r);
  return r.json();
}

export async function createVenue(body: {
  key: string; display_en: string; display_ta?: string; address?: string;
}): Promise<VenueRow> {
  const r = await fetch("/api/v1/admin/venues", {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw await apiError(r);
  return r.json();
}

export async function updateVenue(id: number, patch: {
  display_en?: string; display_ta?: string; address?: string; is_active?: boolean;
}): Promise<VenueRow> {
  const r = await fetch(`/api/v1/admin/venues/${id}`, {
    method: "PATCH", credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!r.ok) throw await apiError(r);
  return r.json();
}

// ── Ministries ─────────────────────────────────────────────────────────────
export async function listMinistries(): Promise<MinistryRow[]> {
  const r = await fetch("/api/v1/admin/ministries", { credentials: "include", cache: "no-store" });
  if (!r.ok) throw await apiError(r);
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
  if (!r.ok) throw await apiError(r);
  return r.json();
}

// ── Department shared accounts ─────────────────────────────────────────────
export async function listDeptAccounts(): Promise<DeptAccountRow[]> {
  const r = await fetch("/api/v1/admin/dept-accounts", { credentials: "include", cache: "no-store" });
  if (!r.ok) throw await apiError(r);
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
  if (!r.ok) throw await apiError(r);
  return r.json();
}

export async function deleteDeptAccount(id: number): Promise<void> {
  const r = await fetch(`/api/v1/admin/dept-accounts/${id}`, {
    method: "DELETE", credentials: "include",
  });
  if (!r.ok) throw await apiError(r);
}

export async function resetDeptPassword(deptKey: string, password?: string): Promise<{
  department: string; username: string; password: string;
}> {
  const r = await fetch(`/api/v1/admin/dept-accounts/${deptKey}/reset-password`, {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(password ? { password } : {}),
  });
  if (!r.ok) throw await apiError(r);
  return r.json();
}
