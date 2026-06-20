import type { AppointmentRow } from "@/lib/types";
import PriorityBadge from "./PriorityBadge";

const DEPT_DISPLAY: Record<string, string> = {
  rural_development_water_resources:         "Rural Development & Water Resources",
  public_works_sports_development:           "Public Works & Sports Development",
  health_medical_education_family_welfare:   "Health, Medical Education & Family Welfare",
  revenue_disaster_management:               "Revenue & Disaster Management",
  food_civil_supplies_consumer_protection:   "Food, Civil Supplies & Consumer Protection",
  energy_law_courts_prevention_corruption:   "Energy, Law, Courts & Prevention of Corruption",
  school_education_tamil_dev_info_publicity: "School Education, Tamil Development, Information & Publicity",
  natural_resources_minerals_mines:          "Natural Resources (Minerals & Mines)",
  industries_investment_promotion:           "Industries & Investment Promotion",
  fisheries_fishermen_welfare:               "Fisheries & Fishermen Welfare",
  animal_husbandry:                          "Animal Husbandry",
  milk_dairy_development:                    "Milk & Dairy Development",
  forests:                                   "Forests",
  agriculture_farmers_welfare:               "Agriculture & Farmers Welfare",
  environment_climate_change:                "Environment & Climate Change",
  housing_urban_development:                 "Housing & Urban Development",
  cooperation:                               "Cooperation",
  msme:                                      "MSME",
  social_welfare_women_welfare:              "Social Welfare & Women Welfare",
  handlooms_textiles_khadi:                  "Handlooms, Textiles & Khadi",
  commercial_taxes_registration:             "Commercial Taxes & Registration",
  transport:                                 "Transport",
  hindu_religious_charitable_endowments:     "HR & CE",
  ai_information_technology:                 "AI & Information Technology",
  welfare_non_resident_tamils:               "Welfare of Non-Resident Tamils",
  backward_classes_welfare:                  "Backward Classes Welfare",
  labour_welfare_skill_development:          "Labour Welfare & Skill Development",
  human_resources_management:                "Human Resources Management",
  finance_planning_development:              "Finance, Planning & Development",
  prohibition_excise:                        "Prohibition & Excise",
  tourism:                                   "Tourism",
  higher_education_technical_education:      "Higher Education & Technical Education",
  minorities_welfare_wakf_board:             "Minorities Welfare & Wakf Board",
  social_justice_adi_dravidar_welfare:       "Social Justice & Adi Dravidar Welfare",
  other:                                     "Other / Unclassified",
};

export default function AppointmentExpand({ row }: { row: AppointmentRow }) {
  const attachments = row.attachments ?? [];

  // Debug logging
  if (attachments.length > 0) {
    console.log('Attachments for appointment:', row.id, attachments);
  }

  const deptLabel = row.department ? (DEPT_DISPLAY[row.department] ?? row.department) : null;
  const secondaryDepts = (row.secondary_departments ?? []).map(
    (d) => DEPT_DISPLAY[d] ?? d
  );
  return (
    <td colSpan={9} className="p-0">
      <div className="px-8 py-5 border-l-4 border-brand">
        {/* Top: name + mobile */}
        <div className="grid grid-cols-2 gap-4 bg-white p-4 rounded border border-slate-200 mb-4 max-w-lg">
          <div>
            <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">Name</div>
            <div className="font-medium text-slate-800">{row.name}</div>
          </div>
          <div>
            <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">Mobile</div>
            <div className="font-medium text-slate-800">{row.mobile}</div>
          </div>
        </div>

        <div className="flex gap-6">
          {/* Left: description + audio + AI summary */}
          <div className="flex-1 min-w-0">
            {row.description && (
              <div className="mb-4">
                <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                  Citizen's Description
                </div>
                <p className="text-sm text-slate-700 bg-white p-4 rounded border border-slate-200 leading-relaxed">
                  {row.description}
                </p>
              </div>
            )}
            <div className="bg-white p-4 rounded border border-slate-200">
              <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">
                AI Summary
              </div>
              {row.headline && (
                <div className="font-semibold text-slate-800 mb-1">{row.headline}</div>
              )}
              {row.summary
                ? <p className="text-sm text-slate-700 leading-relaxed">{row.summary}</p>
                : <p className="text-sm text-slate-400 italic">AI summary not yet generated.</p>}
              {row.citizen_ask && (
                <div className="mt-3">
                  <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                    Citizen's Ask
                  </div>
                  <p className="text-sm text-slate-700">{row.citizen_ask}</p>
                </div>
              )}
              {row.key_details && row.key_details.length > 0 && (
                <div className="mt-3">
                  <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                    Key Details
                  </div>
                  <ul className="list-disc pl-4 space-y-0.5">
                    {row.key_details.map((d, i) => (
                      <li key={i} className="text-sm text-slate-600">{d}</li>
                    ))}
                  </ul>
                </div>
              )}
              {(row.urgency || deptLabel || secondaryDepts.length > 0) && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {row.urgency && <PriorityBadge urgency={row.urgency} />}
                  {deptLabel && (
                    <span className="inline-flex items-center gap-1 px-2 py-1 bg-indigo-50 border border-indigo-200 rounded text-[11px] font-semibold text-indigo-700">
                      🏛️ {deptLabel}
                    </span>
                  )}
                  {secondaryDepts.map((d, i) => (
                    <span
                      key={i}
                      className="inline-flex items-center gap-1 px-2 py-1 bg-slate-50 border border-slate-200 rounded text-[11px] font-medium text-slate-600"
                      title="Also looped in"
                    >
                      ↳ {d}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Audio transcript (Gemini STT) */}
            {(row.audio_transcript || row.audio_url) && (
              <div className="mt-4 bg-white p-4 rounded border border-slate-200">
                <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">
                  🎤 Voice Recording {row.audio_transcript ? "(Transcribed)" : ""}
                </div>
                {row.audio_url && (
                  <audio controls src={row.audio_url} className="w-full mb-2 h-8" />
                )}
                {row.audio_transcript && (
                  <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">
                    {row.audio_transcript}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Right: attachments */}
          <div className="w-72 flex-shrink-0">
            <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">
              Attachments ({attachments.length})
            </div>
            <div className="grid grid-cols-2 gap-2">
              {attachments.length === 0 ? (
                <div className="col-span-2 h-32 bg-slate-100 rounded border border-slate-200 flex items-center justify-center text-slate-400 text-sm">
                  No files attached
                </div>
              ) : attachments.map((a, i) => {
                if (a.type === "IMAGE") {
                  return (
                    <div key={i} className="relative group">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={a.url} alt={a.name}
                           className="w-full h-36 object-cover rounded border border-slate-200" />
                      <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition flex items-center justify-center rounded">
                        <a href={a.url} target="_blank" rel="noreferrer"
                           className="text-white text-xs font-medium bg-black/50 px-2 py-1 rounded">
                          View
                        </a>
                      </div>
                      <p className="text-[10px] text-slate-400 mt-1 truncate">{a.name}</p>
                    </div>
                  );
                } else if (a.type === "AUDIO") {
                  return (
                    <div key={i} className="col-span-2 bg-white p-3 rounded border border-slate-200">
                      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">
                        🎵 Voice Recording
                      </div>
                      <audio controls className="w-full" style={{ height: '32px' }}>
                        <source src={a.url} type="audio/webm" />
                        Your browser does not support the audio element.
                      </audio>
                    </div>
                  );
                } else {
                  return (
                    <a key={i} href={a.url} target="_blank" rel="noreferrer"
                       className="flex flex-col items-center justify-center h-36 bg-slate-50 rounded border border-slate-200 hover:bg-slate-100 transition text-center p-2">
                      <span className="text-3xl mb-2">
                        {a.type === "DOCUMENT" ? "📄" : "🎬"}
                      </span>
                      <span className="text-[10px] text-slate-500 truncate w-full text-center">{a.name}</span>
                    </a>
                  );
                }
              })}
            </div>
          </div>
        </div>
      </div>
    </td>
  );
}
