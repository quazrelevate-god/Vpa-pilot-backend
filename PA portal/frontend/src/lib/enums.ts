// Mirror of the Python enums in backend/src/models/grievance_summary.py and
// ticket_models.py. Keep in sync when those enums change.

// Ministry = the top-level portfolio that contains a Minister's office
// (School Education, Transport, Revenue …). Distinct from the sub-department
// on a ticket (SCERT, Elementary Education …), which stays under "Department".
export const MINISTRY_DISPLAY: Record<string, string> = {
  rural_development_water_resources:         "Rural Development & Water Resources",
  public_works_sports_development:           "Public Works & Sports Development",
  health_medical_education_family_welfare:   "Health, Medical Education & Family Welfare",
  revenue_disaster_management:               "Revenue & Disaster Management",
  food_civil_supplies_consumer_protection:   "Food, Civil Supplies & Consumer Protection",
  energy_law_courts_prevention_corruption:   "Energy, Law, Courts & Prevention of Corruption",
  school_education_tamil_dev_info_publicity: "School Education, Tamil Development, Info & Publicity",
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

// Tamil Nadu districts (38 as of 2020). Key mirrors the backend District enum
// exactly. Used by every review/edit drawer that surfaces district selection.
export const DISTRICT_DISPLAY: Record<string, string> = {
  ariyalur:        "Ariyalur",
  chengalpattu:    "Chengalpattu",
  chennai:         "Chennai",
  coimbatore:      "Coimbatore",
  cuddalore:       "Cuddalore",
  dharmapuri:      "Dharmapuri",
  dindigul:        "Dindigul",
  erode:           "Erode",
  kallakurichi:    "Kallakurichi",
  kanchipuram:     "Kanchipuram",
  kanyakumari:     "Kanyakumari",
  karur:           "Karur",
  krishnagiri:     "Krishnagiri",
  madurai:         "Madurai",
  mayiladuthurai:  "Mayiladuthurai",
  nagapattinam:    "Nagapattinam",
  namakkal:        "Namakkal",
  nilgiris:        "The Nilgiris",
  perambalur:      "Perambalur",
  pudukkottai:     "Pudukkottai",
  ramanathapuram:  "Ramanathapuram",
  ranipet:         "Ranipet",
  salem:           "Salem",
  sivaganga:       "Sivaganga",
  tenkasi:         "Tenkasi",
  thanjavur:       "Thanjavur",
  theni:           "Theni",
  thoothukudi:     "Thoothukudi",
  tiruchirappalli: "Tiruchirappalli",
  tirunelveli:     "Tirunelveli",
  tirupattur:      "Tirupattur",
  tiruppur:        "Tiruppur",
  tiruvallur:      "Tiruvallur",
  tiruvannamalai:  "Tiruvannamalai",
  tiruvarur:       "Tiruvarur",
  vellore:         "Vellore",
  viluppuram:      "Viluppuram",
  virudhunagar:    "Virudhunagar",
};

// English-only category labels — used in PA portal (English UI)
export const CATEGORY_DISPLAY_EN: Record<string, string> = {
  action_required:     "Action Required",
  proposals:           "Proposals",
  transfer_requests:   "Transfer Requests",
  pension_requests:    "Pension Requests",
  school_admission:    "School Admission",
  job_requests:        "Job Requests",
  rti:                 "RTI",
  associations_unions: "Associations / Unions",
  other:               "Other",
  general:             "General",
  greetings:           "Greetings",
  school_upgradation:  "School Upgradation",
  invitation:          "Invitation",
};

// Tamil-only category labels — used where Tamil display is needed
export const CATEGORY_DISPLAY_TA: Record<string, string> = {
  action_required:     "உடனடி நடவடிக்கை தேவை",
  proposals:           "முன்மொழிவுகள்",
  transfer_requests:   "பணியிட மாற்றக் கோரிக்கைகள்",
  pension_requests:    "ஓய்வூதியக் கோரிக்கைகள்",
  school_admission:    "பள்ளி சேர்க்கை",
  job_requests:        "வேலைவாய்ப்பு கோரிக்கைகள்",
  rti:                 "தகவல் அறியும் உரிமை",
  associations_unions: "சங்கங்கள் / தொழிற்சங்கங்கள்",
  other:               "பிற",
  general:             "பொது மனுக்கள்",
  greetings:           "வாழ்த்து செய்திகள்",
  school_upgradation:  "பள்ளி தரம் உயர்த்துதல்",
  invitation:          "அழைப்பிதழ்",
};

// Default alias — PA portal is English-first
export const CATEGORY_DISPLAY = CATEGORY_DISPLAY_EN;

export const TICKET_STATUS_DISPLAY: Record<string, string> = {
  open:               "Open",
  triaged:            "Triaged",
  assigned:           "Assigned",
  in_progress:        "In Progress",
  forwarded_to_dept:  "Forwarded to Dept",
  pending_citizen:    "Pending Citizen",
  resolved:           "Resolved",
  closed:             "Closed",
  reopened:           "Reopened",
  reverted:           "Reverted to review",
};

export const TICKET_STATUS_COLOR: Record<string, string> = {
  open:               "bg-blue-100 text-blue-700 border-blue-200",
  triaged:            "bg-indigo-100 text-indigo-700 border-indigo-200",
  assigned:           "bg-purple-100 text-purple-700 border-purple-200",
  in_progress:        "bg-amber-100 text-amber-700 border-amber-200",
  forwarded_to_dept:  "bg-cyan-100 text-cyan-700 border-cyan-200",
  pending_citizen:    "bg-orange-100 text-orange-700 border-orange-200",
  resolved:           "bg-green-100 text-green-700 border-green-200",
  closed:             "bg-slate-200 text-slate-700 border-slate-300",
  reopened:           "bg-red-100 text-red-700 border-red-200",
  reverted:           "bg-amber-100 text-amber-700 border-amber-200",
};

// Priority is driven by the AI review (low | medium | high | critical).
export const PRIORITY_COLOR: Record<string, string> = {
  critical: "bg-red-600 text-white",
  high:     "bg-orange-500 text-white",
  medium:   "bg-yellow-400 text-yellow-900",
  low:      "bg-slate-300 text-slate-700",
};

export const CLOSURE_REASON_DISPLAY: Record<string, string> = {
  action_taken:             "Action Taken",
  not_actionable:           "Not Actionable",
  duplicate:                "Duplicate",
  resolved_by_dept:         "Resolved by Department",
  no_response_from_citizen: "No Response from Citizen",
  out_of_scope:             "Out of Scope",
};

export const PRIORITY_DISPLAY: Record<string, string> = {
  low: "Low", medium: "Medium", high: "High", critical: "Critical",
};

export const ministryOptions = Object.entries(MINISTRY_DISPLAY).map(([value, label]) => ({ value, label }));
export const categoryOptions = Object.entries(CATEGORY_DISPLAY).map(([value, label]) => ({ value, label }));
export const ticketStatusOptions = Object.entries(TICKET_STATUS_DISPLAY).map(([value, label]) => ({ value, label }));
// In-drawer manual status picker. The PA only owns the pre-assignment
// lifecycle — Open, and Assigned (auto-set when they pick a department).
// Every other status is driven by the department workspace or the dedicated
// bottom-bar actions:
//   in_progress / forwarded_to_dept  → department accepts / forwards
//   pending_citizen                  → department paused for citizen input
//   triaged / resolved / closed / reopened → bottom-bar action buttons
//   awaiting_department              → legacy value; new assigns land at ASSIGNED
export const ticketManualStatusOptions = ticketStatusOptions.filter(
  (o) => !["triaged", "resolved", "closed", "reopened",
            "in_progress", "forwarded_to_dept", "pending_citizen",
            "awaiting_department"].includes(o.value)
);
export const priorityOptions = Object.entries(PRIORITY_DISPLAY).map(([value, label]) => ({ value, label }));
export const closureReasonOptions = Object.entries(CLOSURE_REASON_DISPLAY).map(([value, label]) => ({ value, label }));

/** School Education departments a ticket can be routed to. Shared between the
 *  TicketDetailDrawer assignment select and the tickets-page department filter
 *  so the two never drift. */
export const SCHOOL_DEPARTMENTS: { key: string; label: string }[] = [
  { key: "director_school_education",   label: "Director of School Education" },
  { key: "private_schools",             label: "Directorate of Private Schools" },
  { key: "elementary_education",        label: "Elementary Education" },
  { key: "govt_examination",            label: "Government Examinations" },
  { key: "non_formal_adult_education",  label: "Non-Formal & Adult Education" },
  { key: "public_libraries",            label: "Public Libraries" },
  { key: "scert",                       label: "SCERT" },
  { key: "teacher_recruitment_board",   label: "Teacher Recruitment Board (TRB)" },
  { key: "tn_education_service_corp",   label: "TN Education Service Corporation" },
  { key: "samagra_shiksha",             label: "Samagra Shiksha" },
];
export const SCHOOL_DEPT_LABEL: Record<string, string> =
  Object.fromEntries(SCHOOL_DEPARTMENTS.map((d) => [d.key, d.label]));

// ── Tamil display maps ───────────────────────────────────────────────────────
// The API labels ministries, districts and departments in English only. These
// let any surface re-label from the key so dashboards switch fully with the
// language. Keys must stay in sync with the English maps above.
export const MINISTRY_DISPLAY_TA: Record<string, string> = {
  rural_development_water_resources:         "ஊரக வளர்ச்சி மற்றும் நீர்வளத் துறை",
  public_works_sports_development:           "பொதுப்பணி மற்றும் விளையாட்டு வளர்ச்சித் துறை",
  health_medical_education_family_welfare:   "சுகாதாரம், மருத்துவக் கல்வி மற்றும் குடும்ப நலத் துறை",
  revenue_disaster_management:               "வருவாய் மற்றும் பேரிடர் மேலாண்மைத் துறை",
  food_civil_supplies_consumer_protection:   "உணவு, குடிமைப் பொருள் வழங்கல் மற்றும் நுகர்வோர் பாதுகாப்புத் துறை",
  energy_law_courts_prevention_corruption:   "மின்சாரம், சட்டம், நீதிமன்றங்கள் மற்றும் ஊழல் தடுப்புத் துறை",
  school_education_tamil_dev_info_publicity: "பள்ளிக் கல்வி, தமிழ் வளர்ச்சி, தகவல் மற்றும் விளம்பரத் துறை",
  natural_resources_minerals_mines:          "இயற்கை வளங்கள் (கனிமங்கள் மற்றும் சுரங்கங்கள்)",
  industries_investment_promotion:           "தொழில் மற்றும் முதலீட்டு ஊக்குவிப்புத் துறை",
  fisheries_fishermen_welfare:               "மீன்வளம் மற்றும் மீனவர் நலத் துறை",
  animal_husbandry:                          "கால்நடை பராமரிப்புத் துறை",
  milk_dairy_development:                    "பால் மற்றும் பால்வளத் துறை",
  forests:                                   "வனத் துறை",
  agriculture_farmers_welfare:               "வேளாண்மை மற்றும் விவசாயிகள் நலத் துறை",
  environment_climate_change:                "சுற்றுச்சூழல் மற்றும் காலநிலை மாற்றத் துறை",
  housing_urban_development:                 "வீட்டுவசதி மற்றும் நகர்ப்புற வளர்ச்சித் துறை",
  cooperation:                               "கூட்டுறவுத் துறை",
  msme:                                      "நுண், சிறு மற்றும் நடுத்தர தொழில் துறை",
  social_welfare_women_welfare:              "சமூக நலன் மற்றும் மகளிர் நலத் துறை",
  handlooms_textiles_khadi:                  "கைத்தறி, ஜவுளி மற்றும் கதர் துறை",
  commercial_taxes_registration:             "வணிக வரி மற்றும் பதிவுத் துறை",
  transport:                                 "போக்குவரத்துத் துறை",
  hindu_religious_charitable_endowments:     "இந்து சமய அறநிலையத் துறை",
  ai_information_technology:                 "செயற்கை நுண்ணறிவு மற்றும் தகவல் தொழில்நுட்பத் துறை",
  welfare_non_resident_tamils:               "வெளிநாடு வாழ் தமிழர் நலத் துறை",
  backward_classes_welfare:                  "பிற்படுத்தப்பட்டோர் நலத் துறை",
  labour_welfare_skill_development:          "தொழிலாளர் நலன் மற்றும் திறன் மேம்பாட்டுத் துறை",
  human_resources_management:                "மனிதவள மேலாண்மைத் துறை",
  finance_planning_development:              "நிதி, திட்டமிடல் மற்றும் வளர்ச்சித் துறை",
  prohibition_excise:                        "மதுவிலக்கு மற்றும் ஆயத்தீர்வைத் துறை",
  tourism:                                   "சுற்றுலாத் துறை",
  higher_education_technical_education:      "உயர்கல்வி மற்றும் தொழில்நுட்பக் கல்வித் துறை",
  minorities_welfare_wakf_board:             "சிறுபான்மையினர் நலன் மற்றும் வக்பு வாரியத் துறை",
  social_justice_adi_dravidar_welfare:       "சமூக நீதி மற்றும் ஆதிதிராவிடர் நலத் துறை",
  other:                                     "பிற",
};

export const DISTRICT_DISPLAY_TA: Record<string, string> = {
  ariyalur: "அரியலூர்", chengalpattu: "செங்கல்பட்டு", chennai: "சென்னை",
  coimbatore: "கோயம்புத்தூர்", cuddalore: "கடலூர்", dharmapuri: "தர்மபுரி",
  dindigul: "திண்டுக்கல்", erode: "ஈரோடு", kallakurichi: "கள்ளக்குறிச்சி",
  kanchipuram: "காஞ்சிபுரம்", kanyakumari: "கன்னியாகுமரி", karur: "கரூர்",
  krishnagiri: "கிருஷ்ணகிரி", madurai: "மதுரை", mayiladuthurai: "மயிலாடுதுறை",
  nagapattinam: "நாகப்பட்டினம்", namakkal: "நாமக்கல்", nilgiris: "நீலகிரி",
  perambalur: "பெரம்பலூர்", pudukkottai: "புதுக்கோட்டை", ramanathapuram: "ராமநாதபுரம்",
  ranipet: "ராணிப்பேட்டை", salem: "சேலம்", sivaganga: "சிவகங்கை",
  tenkasi: "தென்காசி", thanjavur: "தஞ்சாவூர்", theni: "தேனி",
  thoothukudi: "தூத்துக்குடி", tiruchirappalli: "திருச்சிராப்பள்ளி",
  tirunelveli: "திருநெல்வேலி", tirupattur: "திருப்பத்தூர்", tiruppur: "திருப்பூர்",
  tiruvallur: "திருவள்ளூர்", tiruvannamalai: "திருவண்ணாமலை", tiruvarur: "திருவாரூர்",
  vellore: "வேலூர்", viluppuram: "விழுப்புரம்", virudhunagar: "விருதுநகர்",
};

export const SCHOOL_DEPT_LABEL_TA: Record<string, string> = {
  director_school_education:  "பள்ளிக் கல்வி இயக்குநரகம்",
  private_schools:            "தனியார் பள்ளிகள் இயக்குநரகம்",
  elementary_education:       "தொடக்கக் கல்வி",
  govt_examination:           "அரசுத் தேர்வுகள்",
  non_formal_adult_education: "முறைசாரா மற்றும் வயதுவந்தோர் கல்வி",
  public_libraries:           "பொது நூலகங்கள்",
  scert:                      "மாநிலக் கல்வியியல் ஆராய்ச்சி மற்றும் பயிற்சி நிறுவனம் (SCERT)",
  teacher_recruitment_board:  "ஆசிரியர் தேர்வு வாரியம் (TRB)",
  tn_education_service_corp:  "தமிழ்நாடு கல்விப் பணிக் கழகம்",
  samagra_shiksha:            "சமக்ர சிக்ஷா",
};

/** Localised label for a ministry / district / school department key. */
export function ministryText(key?: string | null, lang?: string, fallback?: string | null): string {
  if (!key) return fallback ?? "—";
  return (lang === "ta" ? MINISTRY_DISPLAY_TA[key] : MINISTRY_DISPLAY[key]) ?? fallback ?? key;
}
export function districtText(key?: string | null, lang?: string, fallback?: string | null): string {
  if (!key) return fallback ?? "—";
  return (lang === "ta" ? DISTRICT_DISPLAY_TA[key] : DISTRICT_DISPLAY[key]) ?? fallback ?? key;
}
export function schoolDeptText(key?: string | null, lang?: string, fallback?: string | null): string {
  if (!key) return fallback ?? "—";
  return (lang === "ta" ? SCHOOL_DEPT_LABEL_TA[key] : SCHOOL_DEPT_LABEL[key]) ?? fallback ?? key;
}
export const schoolDepartmentOptions =
  SCHOOL_DEPARTMENTS.map((d) => ({ value: d.key, label: d.label }));

/** Intake channel a petition came in through — shown as a Source pill on rows
 *  and used as a Source filter in the tickets and petition-review pages. */
export const SOURCE_DISPLAY: Record<string, string> = {
  qr_citizen:   "Citizen QR",
  ai_scan:      "Scanned petition",
  postal:       "Postal",
  manual_staff: "Staff entry",
  cm_office:    "CM Office",
};
export const sourceOptions = Object.entries(SOURCE_DISPLAY).map(([value, label]) => ({ value, label }));
