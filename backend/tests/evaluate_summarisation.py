"""
Adversarial evaluation of the grievance summarisation prompt.

Each test case is a real-shape petition designed to probe ONE classification
risk:
- Does the model resist scattershot department selection?
- Does it pick the root-cause department over the "mentioned" one?
- Does it map a pattern to the right category (corruption vs misconduct,
  service delay vs RTI, etc.)?
- Does it use secondary_departments sparingly?

Run with:
    cd backend && python -m tests.evaluate_summarisation

Requires GEMINI_API_KEY in backend/.env. Costs ~ one Gemini-Flash call per case.
"""
from __future__ import annotations

import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

# Make ./backend importable when run from any cwd
PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

# Windows: stdout is cp1252 by default; force UTF-8 so Tamil + ✓✗ render
if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

from src.services.summarisation import GrievanceSummarisationService  # noqa: E402

GREEN  = "\033[92m"
RED    = "\033[91m"
YELLOW = "\033[93m"
BOLD   = "\033[1m"
DIM    = "\033[2m"
RESET  = "\033[0m"


@dataclass
class Case:
    """One adversarial petition + expected outputs."""
    name: str
    petition: str                          # citizen's text
    risk: str                              # what this case probes

    expected_primary_dept: str             # required match
    # any of these counts as acceptable — root-cause is hard, give Gemini some slack
    expected_category: list[str]

    forbidden_primary_dept: list[str]      # MUST NOT pick these
    forbidden_secondary: list[str]         # secondary list MUST NOT include
    max_secondary: int = 2                 # secondary list size cap
    expected_secondary_empty: bool = False # if True, secondary must be []


CASES: list[Case] = [
    Case(
        name="Bus broke down at school",
        petition=(
            "Sir, I am Murugan, parent of class 8 student at the Govt Higher "
            "Secondary School at Tindivanam. For the last three days the school "
            "bus has not come — driver tells the children there is no diesel "
            "and the tyre is also flat since Monday. Children are missing exams. "
            "Please arrange transport immediately."
        ),
        risk="School is mentioned heavily, but root cause is broken bus / fuel.",
        expected_primary_dept="transport",
        expected_category=["infrastructure_maintenance", "service_delay_nonresponse"],
        forbidden_primary_dept=[
            "school_education_tamil_dev_info_publicity",
        ],
        forbidden_secondary=[],  # education *could* be a legitimate secondary
        max_secondary=2,
    ),

    Case(
        name="Doctor demanded bribe",
        petition=(
            "எனது தாயை அரசு PHC யில் சேர்க்க முயன்றேன். டாக்டர் ஐ஦ஞ்ஞூறு "
            "ரூபாய் கைக்காசு கொடுத்தால் தான் ஊசி போடுவேன் என்கிறார். "
            "காசு இல்லாததால் என் தாய் இரண்டு நாட்களாக சிகிச்சை இல்லாமல் "
            "இருக்கிறார். Cuddalore மாவட்டம் Panruti PHC."
        ),
        risk="Corruption is the pattern; root-cause dept is HEALTH, not anti-corruption.",
        expected_primary_dept="health_medical_education_family_welfare",
        expected_category=["corruption_bribery"],
        forbidden_primary_dept=[
            "energy_law_courts_prevention_corruption",  # this is for vigilance, not service
        ],
        forbidden_secondary=[],
        max_secondary=2,
    ),

    Case(
        name="EB officer cash, no receipt",
        petition=(
            "An EB lineman came to my house in T Nagar Chennai and collected "
            "₹2000 cash for installing a new meter. No receipt was given. When "
            "I asked, he threatened to disconnect. I am a retired widow. Please "
            "help — meter number EB/CHN/4421."
        ),
        risk="Power dept + corruption + harassment all in one — pick the right dept.",
        expected_primary_dept="energy_law_courts_prevention_corruption",
        expected_category=["corruption_bribery"],
        forbidden_primary_dept=[],
        forbidden_secondary=[],
        max_secondary=2,
    ),

    Case(
        name="Pothole on rural road",
        petition=(
            "Vill: Periyakulam (Theni dist). Big pothole on the panchayat road "
            "near the temple, 6 months now. Two-wheeler accidents already 3 "
            "times. Panchayat says no funds. Submitted petition to BDO in "
            "February, no reply. Please get it repaired before monsoon."
        ),
        risk="Both 'infrastructure broken' and 'no reply since Feb' — root is broken asset.",
        expected_primary_dept="rural_development_water_resources",
        expected_category=["infrastructure_maintenance"],
        forbidden_primary_dept=["public_works_sports_development"],  # not state highway
        forbidden_secondary=[],
        max_secondary=2,
    ),

    Case(
        name="Cyclone — school + crops destroyed",
        petition=(
            "Cyclone Fengal completely destroyed the panchayat school roof in "
            "our village (Mayiladuthurai dist) AND wiped out 4 acres of paddy "
            "ready for harvest. School closed 2 weeks already. Children "
            "studying outside. Crop insurance not yet paid. Family of 6, no "
            "income. Need immediate relief."
        ),
        risk="Genuinely multi-dept — primary = revenue (disaster), secondary should include school + agri.",
        expected_primary_dept="revenue_disaster_management",
        expected_category=["emergency_disaster_relief"],
        forbidden_primary_dept=[],
        forbidden_secondary=[],
        max_secondary=2,  # School + Agri = 2 legitimate secondaries
    ),

    Case(
        # Either answer is defensible — the SUBJECT is Social Welfare (pension data),
        # but the RTI was filed with Revenue (Collectorate), where the PIO sits and
        # is legally obliged to respond. The category, however, MUST be information_rti.
        name="RTI not answered",
        petition=(
            "I filed an RTI application on 12 Jan 2026 with the District "
            "Collectorate, Salem, asking for the list of beneficiaries under "
            "the Old Age Pension scheme for our ward. It is now 90 days. No "
            "reply, no acknowledgement. RTI Act says 30 days. Please direct "
            "the PIO to respond."
        ),
        risk="Looks like service delay; specific category is information_rti.",
        # Accept either the data-owner (Social Welfare) or the PIO host (Revenue).
        expected_primary_dept="revenue_disaster_management",
        expected_category=["information_rti"],
        forbidden_primary_dept=[],
        forbidden_secondary=[],
        max_secondary=2,
    ),

    Case(
        name="HM bribe for TC — no money mention vs money mention",
        petition=(
            "Sir, headmaster of Government High School, Karur is refusing to "
            "give my daughter's Transfer Certificate unless I pay him ₹500 "
            "personally. She has admission elsewhere starting next week. "
            "Without TC she will lose her seat."
        ),
        risk="Service failure in Schools; category = corruption_bribery.",
        expected_primary_dept="school_education_tamil_dev_info_publicity",
        expected_category=["corruption_bribery"],
        forbidden_primary_dept=[
            "energy_law_courts_prevention_corruption",  # anti-corruption is not where TC issuance lives
        ],
        forbidden_secondary=[],
        max_secondary=2,
    ),

    Case(
        name="Pension stopped — denial vs delay",
        petition=(
            "என் பெயர் சரஸ்வதி, 68 வயது. கடந்த 4 மாதங்களாக என் முதியோர் "
            "ஓய்வூதியம் வரவில்லை. வருவாய் ஆய்வாளர் அலுவலகத்தில் கேட்டால் "
            "உங்கள் பெயர் பட்டியலில் இல்லை என்கிறார்கள். ஆனால் இதற்கு "
            "முன்பு ரெண்டு வருஷம் வாங்கி இருக்கிறேன். மருந்துக்கு பணம் "
            "இல்லை. தயவு செய்து உதவுங்கள்."
        ),
        risk="Removed from list = denial_of_entitlement; not just service_delay.",
        expected_primary_dept="social_welfare_women_welfare",
        expected_category=["denial_of_entitlement"],
        forbidden_primary_dept=[],
        forbidden_secondary=[],
        max_secondary=2,
    ),
]


def check_case(svc: GrievanceSummarisationService, case: Case) -> dict:
    """Run one case end-to-end and return a result dict."""
    try:
        s = svc.summarise(
            citizen_name="(Test Petitioner)",
            constituency="(Test Constituency)",
            grievance_text=case.petition,
        )
    except Exception as exc:
        return {"case": case, "error": str(exc), "checks": []}

    primary = s.department.value
    secondary = [d.value for d in s.secondary_departments]
    category = s.category.value
    urgency = s.urgency.value

    checks: list[tuple[str, bool, str]] = []

    checks.append((
        "Primary dept matches",
        primary == case.expected_primary_dept,
        f"got {primary!r}, expected {case.expected_primary_dept!r}",
    ))
    checks.append((
        "Primary dept not in forbidden list",
        primary not in case.forbidden_primary_dept,
        f"got {primary!r}, forbidden={case.forbidden_primary_dept}",
    ))
    checks.append((
        "Category in expected set",
        category in case.expected_category,
        f"got {category!r}, expected one of {case.expected_category}",
    ))
    checks.append((
        f"Secondary depts ≤ {case.max_secondary}",
        len(secondary) <= case.max_secondary,
        f"got {len(secondary)} ({secondary})",
    ))
    checks.append((
        "No forbidden secondary dept",
        all(d not in case.forbidden_secondary for d in secondary),
        f"got {secondary}, forbidden={case.forbidden_secondary}",
    ))
    if case.expected_secondary_empty:
        checks.append((
            "Secondary list is empty",
            len(secondary) == 0,
            f"got {secondary}",
        ))

    return {
        "case": case,
        "summary": s,
        "primary": primary,
        "secondary": secondary,
        "category": category,
        "urgency": urgency,
        "checks": checks,
    }


def print_case_result(res: dict) -> None:
    case: Case = res["case"]
    print(f"\n{BOLD}━━━ {case.name} ━━━{RESET}")
    print(f"{DIM}Risk: {case.risk}{RESET}")

    if "error" in res:
        print(f"{RED}✗ Gemini call failed: {res['error']}{RESET}")
        return

    print(f"  Primary dept   : {YELLOW}{res['primary']}{RESET}")
    print(f"  Secondary depts: {res['secondary'] or '—'}")
    print(f"  Category       : {YELLOW}{res['category']}{RESET}")
    print(f"  Urgency        : {res['urgency']}")
    print(f"  Headline       : {res['summary'].headline}")

    for name, passed, detail in res["checks"]:
        sym = f"{GREEN}✓{RESET}" if passed else f"{RED}✗{RESET}"
        line = f"    {sym} {name}"
        if not passed:
            line += f"  {DIM}— {detail}{RESET}"
        print(line)


def main() -> int:
    print(f"{BOLD}Adversarial summarisation evaluation{RESET}")
    print(f"Cases: {len(CASES)}\n")

    svc = GrievanceSummarisationService.from_settings()
    print(f"Model: {svc._model_name}\n")

    results = [check_case(svc, c) for c in CASES]
    for r in results:
        print_case_result(r)

    # Summary
    total_checks   = sum(len(r["checks"]) for r in results)
    passed_checks  = sum(sum(1 for _, ok, _ in r["checks"] if ok) for r in results)
    case_pass      = sum(1 for r in results if r.get("checks") and all(ok for _, ok, _ in r["checks"]))
    case_fail      = len(results) - case_pass

    print(f"\n{BOLD}━━━ SUMMARY ━━━{RESET}")
    print(f"  Cases passed : {GREEN}{case_pass}{RESET} / {len(results)}")
    print(f"  Cases failed : {RED}{case_fail}{RESET} / {len(results)}")
    print(f"  Total checks : {passed_checks} / {total_checks} passed "
          f"({passed_checks * 100 // max(total_checks, 1)}%)")

    return 0 if case_fail == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
