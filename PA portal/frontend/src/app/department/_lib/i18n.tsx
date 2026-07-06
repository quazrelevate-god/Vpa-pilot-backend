"use client";

// Small, self-contained i18n for the department workspace so we don't drag in
// the PA portal's 900-line translation table. Persists language choice under
// its own localStorage key ("dept.lang").
import { createContext, useCallback, useContext, useEffect, useState } from "react";

type Lang = "en" | "ta";

const DICT: Record<Lang, Record<string, string>> = {
  en: {
    "workspace":        "Department Workspace",
    "signOut":          "Sign out",
    "refresh":          "Refresh",
    "search":           "Search ticket #, name, mobile, subject…",
    "empty":            "No tickets in this view.",
    "loading":          "Loading…",

    "seg.toAccept":     "To Accept",
    "seg.inProgress":   "In Progress",
    "seg.resolved":     "Resolved",
    "seg.closed":       "Closed",
    "seg.all":          "All",

    "kpi.toAccept":     "To accept",
    "kpi.inProgress":   "In progress",
    "kpi.resolvedWeek": "Resolved this week",
    "kpi.overdue":      "SLA breached",

    "priority.all":     "All priority",
    "priority.critical":"Critical",
    "priority.high":    "High",
    "priority.medium":  "Medium",
    "priority.low":     "Low",

    "sla.on":           "On track",
    "sla.hot":          "Due soon",
    "sla.breached":     "Overdue",
    "sla.na":           "No SLA",

    "detail.overview":  "Overview",
    "detail.summary":   "Summary",
    "detail.ask":       "Citizen's ask",
    "detail.details":   "Key details",
    "detail.timeline":  "Activity",
    "detail.attachments":"Original petition",
    "detail.proofs":    "Resolution proofs",
    "detail.noEvents":  "No activity yet.",
    "detail.showTa":    "தமிழ்",
    "detail.showEn":    "English",

    "field.ticket":     "Ticket",
    "field.citizen":    "Citizen",
    "field.mobile":     "Mobile",
    "field.priority":   "Priority",
    "field.category":   "Category",
    "field.ministry":   "Ministry",
    "field.sla":        "SLA",
    "field.created":    "Created",
    "field.accepted":   "Accepted",
    "field.resolved":   "Resolved",

    "action.accept":    "Accept",
    "action.forward":   "Forward",
    "action.updateProgress": "Update progress",
    "action.resolve":   "Mark resolved",
    "action.cancel":    "Cancel",
    "action.post":      "Post update",
    "action.forwardWith":"Forward with reason",

    "form.forwardTo":   "Forward to which department?",
    "form.reason":      "Reason for forwarding (required)",
    "form.note":        "Progress note",
    "form.progress":    "Progress",
    "form.remarks":     "Resolution remarks (required)",
    "form.attachProof": "Attach proof (required)",
    "form.filesSelected":"file(s) selected",

    "state.done":       "This ticket is",
    "state.doneAfter":  "No action needed from your department.",
  },
  ta: {
    "workspace":        "துறை பணியிடம்",
    "signOut":          "வெளியேறு",
    "refresh":          "புதுப்பி",
    "search":           "டிக்கெட் #, பெயர், கைபேசி, தலைப்பு தேடு…",
    "empty":            "இந்தப் பார்வையில் டிக்கெட்டுகள் இல்லை.",
    "loading":          "ஏற்றுகிறது…",

    "seg.toAccept":     "ஏற்க வேண்டியவை",
    "seg.inProgress":   "நடைபெறுகிறது",
    "seg.resolved":     "தீர்க்கப்பட்டவை",
    "seg.closed":       "மூடப்பட்டவை",
    "seg.all":          "அனைத்தும்",

    "kpi.toAccept":     "ஏற்க வேண்டியவை",
    "kpi.inProgress":   "நடைபெறுகிறது",
    "kpi.resolvedWeek": "இந்த வாரம் தீர்க்கப்பட்டவை",
    "kpi.overdue":      "SLA மீறல்",

    "priority.all":     "எல்லா முன்னுரிமையும்",
    "priority.critical":"முக்கியம்",
    "priority.high":    "உயர்",
    "priority.medium":  "நடுத்தர",
    "priority.low":     "குறை",

    "sla.on":           "சரியான வேகம்",
    "sla.hot":          "விரைவில் காலாவதி",
    "sla.breached":     "காலாவதி",
    "sla.na":           "SLA இல்லை",

    "detail.overview":  "மேலோட்டம்",
    "detail.summary":   "சுருக்கம்",
    "detail.ask":       "குடிமகனின் கோரிக்கை",
    "detail.details":   "முக்கிய விவரங்கள்",
    "detail.timeline":  "செயல்பாடு",
    "detail.attachments":"அசல் மனு",
    "detail.proofs":    "தீர்வு ஆதாரங்கள்",
    "detail.noEvents":  "இதுவரை செயல்பாடு எதுவும் இல்லை.",
    "detail.showTa":    "தமிழ்",
    "detail.showEn":    "English",

    "field.ticket":     "டிக்கெட்",
    "field.citizen":    "குடிமகன்",
    "field.mobile":     "கைபேசி",
    "field.priority":   "முன்னுரிமை",
    "field.category":   "வகை",
    "field.ministry":   "அமைச்சகம்",
    "field.sla":        "SLA",
    "field.created":    "உருவாக்கப்பட்டது",
    "field.accepted":   "ஏற்கப்பட்டது",
    "field.resolved":   "தீர்க்கப்பட்டது",

    "action.accept":    "ஏற்று",
    "action.forward":   "பரிந்துரை",
    "action.updateProgress": "முன்னேற்றம் புதுப்பி",
    "action.resolve":   "தீர்த்ததாக குறி",
    "action.cancel":    "ரத்து",
    "action.post":      "புதுப்பிப்பை பதிவிடு",
    "action.forwardWith":"காரணத்துடன் பரிந்துரை",

    "form.forwardTo":   "எந்த துறைக்கு பரிந்துரை?",
    "form.reason":      "பரிந்துரையின் காரணம் (கட்டாயம்)",
    "form.note":        "முன்னேற்றக் குறிப்பு",
    "form.progress":    "முன்னேற்றம்",
    "form.remarks":     "தீர்வுக் குறிப்புகள் (கட்டாயம்)",
    "form.attachProof": "ஆதாரம் இணை (கட்டாயம்)",
    "form.filesSelected":"கோப்பு(கள்) தேர்ந்தெடுக்கப்பட்டன",

    "state.done":       "இந்த டிக்கெட்",
    "state.doneAfter":  "உங்கள் துறையிடமிருந்து மேலும் நடவடிக்கை தேவையில்லை.",
  },
};

interface LangCtx {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string) => string;
}

const Ctx = createContext<LangCtx | null>(null);

export function DeptLangProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>("en");
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("dept.lang") as Lang | null;
      if (saved === "en" || saved === "ta") setLangState(saved);
    } catch {}
  }, []);
  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try { window.localStorage.setItem("dept.lang", l); } catch {}
  }, []);
  const t = useCallback((key: string) => DICT[lang][key] ?? key, [lang]);
  return <Ctx.Provider value={{ lang, setLang, t }}>{children}</Ctx.Provider>;
}

export function useDeptLang(): LangCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useDeptLang must be inside <DeptLangProvider>");
  return c;
}
