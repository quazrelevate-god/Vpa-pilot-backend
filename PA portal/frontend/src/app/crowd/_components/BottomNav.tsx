"use client";

import { cn } from "@/lib/utils";
import { useT } from "../_lib/i18n";
import { Home, Calendar, Users, UserPlus, Menu } from "../_lib/icons";
import type { View, Tab } from "./CrowdApp";

function Item({ active, icon, label, onClick }: {
  active: boolean; icon: React.ReactNode; label: string; onClick: () => void;
}) {
  return (
    <button onClick={onClick}
      className={cn("flex flex-1 flex-col items-center justify-center gap-1 text-[0.62rem] font-bold transition-colors",
        active ? "text-blue-600" : "text-slate-400")}>
      <span className="[&_svg]:h-[21px] [&_svg]:w-[21px]">{icon}</span>
      <span>{label}</span>
    </button>
  );
}

export default function BottomNav({
  view, tab, onHome, onList, onMenu, onRegister,
}: {
  view: View;
  tab: Tab;
  onHome: () => void;
  onList: (t: Tab) => void;
  onMenu: () => void;
  onRegister: () => void;
}) {
  const { t } = useT();
  const on = (v: string) => v === view || (view === "list" && v === tab);

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 mx-auto flex h-[calc(var(--nav-h)+env(safe-area-inset-bottom))] max-w-[560px] border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
      <Item active={on("home")} icon={<Home />} label={t("Home", "முகப்பு")} onClick={onHome} />
      <Item active={on("appt")} icon={<Calendar />} label={t("Appointments", "சந்திப்புகள்")} onClick={() => onList("appt")} />
      <Item active={on("ref")} icon={<Users />} label={t("Referrals", "பரிந்துரைகள்")} onClick={() => onList("ref")} />
      <Item active={false} icon={<UserPlus />} label={t("Walk-ins", "நேரடி")} onClick={onRegister} />
      <Item active={on("menu")} icon={<Menu />} label={t("Menu", "மெனு")} onClick={onMenu} />
    </nav>
  );
}
