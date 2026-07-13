"use client";

/**
 * Settings — super-admin control panel.
 *
 * One page, four tabs:
 *   1. Users            — create / edit / disable staff login accounts
 *   2. Departments      — school-education sub-departments (label + email)
 *   3. Ministries       — 34 TN ministries, email + Tamil label editable
 *   4. Dept accounts    — shared-login credentials handed to each department
 *
 * Gated three ways:
 *   - Feature flag: /api/v1/features returns superadmin_ui = true
 *   - Cookie auth: /api/v1/me succeeds
 *   - Role: role === "super_admin"
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Users, Building2, Landmark, KeyRound, Settings as CogIcon, ShieldCheck, MapPin,
} from "lucide-react";

import TopBar from "@/components/TopBar";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { useLang } from "@/lib/lang-context";
import { fetchMe, fetchFeatures, type SessionUser } from "./_lib/adminApi";

import UsersTab from "./_components/UsersTab";
import DepartmentsTab from "./_components/DepartmentsTab";
import VenuesTab from "./_components/VenuesTab";
import MinistriesTab from "./_components/MinistriesTab";
import DeptAccountsTab from "./_components/DeptAccountsTab";

type GateState =
  | { kind: "loading" }
  | { kind: "flag_off" }
  | { kind: "not_super_admin"; me: SessionUser | null }
  | { kind: "ok"; me: SessionUser };

export default function SettingsPage() {
  const router = useRouter();
  const { t } = useLang();
  const [gate, setGate] = useState<GateState>({ kind: "loading" });
  const [tab, setTab] = useState<string>("users");

  useEffect(() => {
    const ac = new AbortController();
    (async () => {
      try {
        const [flags, me] = await Promise.all([
          fetchFeatures(ac.signal),
          fetchMe(ac.signal),
        ]);
        if (!flags.superadmin_ui)      { setGate({ kind: "flag_off" }); return; }
        if (!me)                       { router.replace("/login"); return; }
        if (me.role !== "super_admin") { setGate({ kind: "not_super_admin", me }); return; }
        setGate({ kind: "ok", me });
      } catch (e) {
        if (!ac.signal.aborted) {
          toast.error(t("set.loadError"), { description: (e as Error).message });
          setGate({ kind: "not_super_admin", me: null });
        }
      }
    })();
    return () => ac.abort();
  }, [router]);

  return (
    <div className="flex h-full flex-1 flex-col overflow-hidden">
      <TopBar
        title={t("set.title")}
        subtitle={t("set.subtitle")}
        icon={<CogIcon className="h-4 w-4" />}
      />

      <main className="flex-1 overflow-y-auto px-6 py-6 sm:px-10 sm:py-8">
        <div className="mx-auto max-w-6xl space-y-6">
          {gate.kind === "loading" && <LoadingShell />}
          {gate.kind === "flag_off" && <FeatureDisabled />}
          {gate.kind === "not_super_admin" && <NotAuthorized user={gate.me} />}
          {gate.kind === "ok" && (
            <>
              <HeaderCard me={gate.me} />
              <Tabs value={tab} onValueChange={setTab}>
                <TabsList className="h-11 gap-1 rounded-xl bg-card p-1 shadow-card">
                  <TabTrigger value="users"       icon={Users}     label={t("set.tabUsers")} />
                  <TabTrigger value="departments" icon={Building2} label={t("set.tabDepartments")} />
                  <TabTrigger value="venues"      icon={MapPin}    label={t("set.tabVenues")} />
                  <TabTrigger value="ministries"  icon={Landmark}  label={t("set.tabMinistries")} />
                  <TabTrigger value="dept-logins" icon={KeyRound}  label={t("set.tabDeptLogins")} />
                </TabsList>

                <TabsContent value="users" className="mt-6">
                  <UsersTab currentUserId={gate.me.id} />
                </TabsContent>
                <TabsContent value="departments" className="mt-6">
                  <DepartmentsTab />
                </TabsContent>
                <TabsContent value="venues" className="mt-6">
                  <VenuesTab />
                </TabsContent>
                <TabsContent value="ministries" className="mt-6">
                  <MinistriesTab />
                </TabsContent>
                <TabsContent value="dept-logins" className="mt-6">
                  <DeptAccountsTab />
                </TabsContent>
              </Tabs>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

// ── Trigger with icon ─────────────────────────────────────────────────────

function TabTrigger({
  value, icon: Icon, label,
}: { value: string; icon: React.ElementType; label: string }) {
  return (
    <TabsTrigger
      value={value}
      className="flex-1 gap-2 rounded-lg px-4 py-2 text-sm font-semibold data-[state=active]:bg-brand data-[state=active]:text-white"
    >
      <Icon className="h-4 w-4" />
      <span className="hidden sm:inline">{label}</span>
    </TabsTrigger>
  );
}

// ── States ────────────────────────────────────────────────────────────────

function HeaderCard({ me }: { me: SessionUser }) {
  const { t } = useLang();
  return (
    <Card className="flex items-start gap-4 rounded-2xl border-border p-5 shadow-card">
      <div className="grid h-11 w-11 flex-shrink-0 place-items-center rounded-xl bg-brand/10 text-brand">
        <ShieldCheck className="h-6 w-6" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-brand">{t("set.superAdmin")}</div>
        <div className="mt-0.5 text-lg font-bold text-foreground">
          {me.full_name || me.login_name}
        </div>
        <p className="mt-1 text-[13px] text-muted-foreground">
          {t("set.headerDesc")}
        </p>
      </div>
    </Card>
  );
}

function FeatureDisabled() {
  const { t } = useLang();
  return (
    <Card className="rounded-2xl border-amber-200 bg-amber-50/50 p-8 text-center shadow-card">
      <CogIcon className="mx-auto h-8 w-8 text-amber-600" />
      <h2 className="mt-3 text-lg font-bold text-foreground">{t("set.disabledTitle")}</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {t("set.disabledDesc")}
      </p>
    </Card>
  );
}

function NotAuthorized({ user }: { user: SessionUser | null }) {
  const { t } = useLang();
  return (
    <Card className="rounded-2xl border-border p-8 text-center shadow-card">
      <ShieldCheck className="mx-auto h-8 w-8 text-muted-foreground" />
      <h2 className="mt-3 text-lg font-bold text-foreground">{t("set.notAuthTitle")}</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {user
          ? <>{t("set.yourRoleIs")} <span className="font-mono text-xs">{user.role}</span>. {t("set.notAuthRole")}</>
          : t("set.notAuthSignin")}
      </p>
    </Card>
  );
}

function LoadingShell() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-24 w-full rounded-2xl" />
      <Skeleton className="h-11 w-full max-w-md rounded-xl" />
      <Skeleton className="h-64 w-full rounded-2xl" />
    </div>
  );
}
