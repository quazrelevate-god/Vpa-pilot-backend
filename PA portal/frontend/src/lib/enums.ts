// Mirror of the Python enums in backend/src/models/grievance_summary.py and
// ticket_models.py. Keep in sync when those enums change.

export const DEPT_DISPLAY: Record<string, string> = {
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
  other_departments:   "Other Departments",
  general:             "General",
  greetings:           "Greetings",
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
  other_departments:   "பிற துறைகள்",
  general:             "பொது மனுக்கள்",
  greetings:           "வாழ்த்து செய்திகள்",
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
};

export const PRIORITY_COLOR: Record<string, string> = {
  P0: "bg-red-600 text-white",
  P1: "bg-orange-500 text-white",
  P2: "bg-yellow-400 text-yellow-900",
  P3: "bg-slate-300 text-slate-700",
};

export const CLOSURE_REASON_DISPLAY: Record<string, string> = {
  action_taken:             "Action Taken",
  not_actionable:           "Not Actionable",
  duplicate:                "Duplicate",
  resolved_by_dept:         "Resolved by Department",
  no_response_from_citizen: "No Response from Citizen",
  out_of_scope:             "Out of Scope",
};

export const URGENCY_DISPLAY: Record<string, string> = {
  low: "Low", medium: "Medium", high: "High", critical: "Critical",
};

export const deptOptions = Object.entries(DEPT_DISPLAY).map(([value, label]) => ({ value, label }));
export const categoryOptions = Object.entries(CATEGORY_DISPLAY).map(([value, label]) => ({ value, label }));
export const ticketStatusOptions = Object.entries(TICKET_STATUS_DISPLAY).map(([value, label]) => ({ value, label }));
// In-drawer manual status picker. Triaged / Resolved / Closed / Reopened are
// excluded — those transitions happen via the dedicated bottom-bar action
// buttons (which require an explanation note for the audit trail).
export const ticketManualStatusOptions = ticketStatusOptions.filter(
  (o) => !["triaged", "resolved", "closed", "reopened"].includes(o.value)
);
export const priorityOptions = Object.keys(PRIORITY_COLOR).map(v => ({ value: v, label: v }));
export const urgencyOptions = Object.entries(URGENCY_DISPLAY).map(([value, label]) => ({ value, label }));
export const closureReasonOptions = Object.entries(CLOSURE_REASON_DISPLAY).map(([value, label]) => ({ value, label }));
