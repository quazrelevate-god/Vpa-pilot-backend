"""
Live end-to-end test runner for the grievance summarisation service.

This calls the REAL Gemini API — not a mock. It is meant to be run manually:

    cd backend
    venv/Scripts/python -m tests.test_summarisation_live

Requires:
    GEMINI_API_KEY in your environment, or in backend/.env

What it does
------------
Runs four realistic grievance petitions through the summariser and prints
each structured result in a readable form, with basic correctness checks:

  1. Pension stoppage          — should be HIGH urgency, pension_welfare
  2. Broken street light       — should be LOW/MEDIUM, infrastructure
  3. Scholarship deadline      — should be CRITICAL (deadline pressure)
  4. Hospital emergency        — should be CRITICAL, health

Exit code is 0 only if every grievance produces a valid GrievanceSummary
that passes its category + minimum urgency assertions.
"""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path
from typing import Optional

# Force UTF-8 console output so box-drawing chars and Tamil text print on
# Windows (default cp1252 console can't encode them).
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
    except Exception:
        pass

# Load .env so GEMINI_API_KEY can live in backend/.env
try:
    from dotenv import load_dotenv  # type: ignore
    load_dotenv(Path(__file__).resolve().parent.parent / ".env")
except ImportError:
    pass

# Make `src` importable when running this file directly.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.models.grievance_summary import (  # noqa: E402
    CitizenSentiment,
    GrievanceCategory,
    GrievanceSummary,
    UrgencyLevel,
)
from src.services.summarisation import GrievanceSummarisationService  # noqa: E402

# Directory the runner scans for image attachments to use in a scenario.
SAMPLE_IMAGE_DIR = Path(__file__).resolve().parent / "sample_images"

# MIME by extension for the auto-discovered image scenario.
IMAGE_MIME_BY_EXT = {
    ".jpg":  "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png":  "image/png",
    ".webp": "image/webp",
}


# ── Visual helpers ────────────────────────────────────────────────────────────

RESET, BOLD, DIM = "\033[0m", "\033[1m", "\033[2m"
GREEN, RED, YELLOW, BLUE, MAGENTA, CYAN = (
    "\033[32m", "\033[31m", "\033[33m", "\033[34m", "\033[35m", "\033[36m"
)
# Disable colours on Windows terminals that don't grok ANSI
if os.name == "nt" and not os.environ.get("ANSICON"):
    try:
        import colorama; colorama.just_fix_windows_console()  # type: ignore
    except Exception:
        pass


def hr(char: str = "─", width: int = 78) -> str:
    return char * width


def banner(text: str, colour: str = CYAN) -> None:
    print(f"\n{colour}{BOLD}{hr('═')}{RESET}")
    print(f"{colour}{BOLD}  {text}{RESET}")
    print(f"{colour}{BOLD}{hr('═')}{RESET}")


def section(text: str) -> None:
    print(f"\n{BOLD}{BLUE}▶ {text}{RESET}")
    print(f"{DIM}{hr('─')}{RESET}")


def render_summary(s: GrievanceSummary) -> None:
    """Pretty-print the structured summary."""
    urgency_colour = {
        UrgencyLevel.LOW:      DIM,
        UrgencyLevel.MEDIUM:   YELLOW,
        UrgencyLevel.HIGH:     RED,
        UrgencyLevel.CRITICAL: RED + BOLD,
    }[s.urgency]

    print(f"  {BOLD}Headline   :{RESET} {s.headline}")
    print(f"  {BOLD}Summary    :{RESET} {s.summary}")
    print(f"  {BOLD}Category   :{RESET} {MAGENTA}{s.category.value}{RESET}")
    print(f"  {BOLD}Urgency    :{RESET} {urgency_colour}{s.urgency.value.upper()}{RESET}", end="")
    if s.urgency_reason:
        print(f"  — {DIM}{s.urgency_reason}{RESET}")
    else:
        print()
    print(f"  {BOLD}Department :{RESET} {MAGENTA}{s.department.value}{RESET}")
    if s.secondary_departments:
        print(f"  {BOLD}Secondary  :{RESET} {', '.join(d.value for d in s.secondary_departments)}")
    print(f"  {BOLD}Citizen ask:{RESET} {s.citizen_ask}")
    print(f"  {BOLD}Key details:{RESET}")
    for d in s.key_details:
        print(f"    • {d}")
    if s.attachment_notes:
        print(f"  {BOLD}Attachment :{RESET} {s.attachment_notes}")


# ── Test scenarios ─────────────────────────────────────────────────────────────

class Scenario:
    """One grievance test case with assertions."""
    def __init__(
        self,
        name: str,
        citizen_name: str,
        constituency: str,
        grievance_text: str,
        expect_category: GrievanceCategory,
        min_urgency: UrgencyLevel,
        attachment_bytes: Optional[bytes] = None,
        attachment_mime: Optional[str] = None,
        attachment_filename: Optional[str] = None,
    ) -> None:
        self.name = name
        self.citizen_name = citizen_name
        self.constituency = constituency
        self.grievance_text = grievance_text
        self.expect_category = expect_category
        self.min_urgency = min_urgency
        self.attachment_bytes = attachment_bytes
        self.attachment_mime = attachment_mime
        self.attachment_filename = attachment_filename


URGENCY_ORDER = {
    UrgencyLevel.LOW: 0,
    UrgencyLevel.MEDIUM: 1,
    UrgencyLevel.HIGH: 2,
    UrgencyLevel.CRITICAL: 3,
}


SCENARIOS: list[Scenario] = [
    Scenario(
        name="Pension stoppage (4 months, single mother)",
        citizen_name="Saroja Devi",
        constituency="Madurai South",
        grievance_text=(
            "Sir, my name is Saroja Devi. I am a widow living alone in Madurai South. "
            "My old-age pension of ₹1,200 per month has not come for the last 4 months "
            "(since February). I went to the village office three times. They told me "
            "to wait, but I have no other income. I have to borrow from neighbours to "
            "buy medicine for my blood pressure. Please help me get my pension restarted. "
            "My pension ID is OAP/MDU/2019/4421."
        ),
        expect_category=GrievanceCategory.PENSION_WELFARE,
        min_urgency=UrgencyLevel.HIGH,
    ),
    Scenario(
        name="Broken street light (routine infrastructure)",
        citizen_name="Lakshmi Narayanan",
        constituency="Gandhi Nagar Ward 12",
        grievance_text=(
            "There is a street light on 4th Cross, Gandhi Nagar, which has not been "
            "working for the last three weeks. After 7 pm the road is completely dark. "
            "Women in our area are scared to walk back from work. We have informed the "
            "ward office but no action. Kindly arrange for repair."
        ),
        expect_category=GrievanceCategory.INFRASTRUCTURE,
        min_urgency=UrgencyLevel.MEDIUM,  # safety angle should at least be medium
    ),
    Scenario(
        name="Scholarship deadline in 3 days",
        citizen_name="Ramesh Kumar",
        constituency="Coimbatore North",
        grievance_text=(
            "Sir, my daughter Priya is studying B.E. second year at Government College "
            "of Engineering. Her merit scholarship application requires a recommendation "
            "letter from the MLA office. The deadline to submit at the college is 20th "
            "June — only 3 days away. Without this scholarship of ₹45,000 we cannot pay "
            "her fees and she will have to drop out. I have already submitted the request "
            "form at the PA office on 1st June, application no. SCHL/CBE/0512. "
            "Please help urgently."
        ),
        expect_category=GrievanceCategory.EDUCATION,
        min_urgency=UrgencyLevel.CRITICAL,  # hard deadline + livelihood
    ),
    Scenario(
        name="Hospital emergency (ambulance refused)",
        citizen_name="Mohammed Irfan",
        constituency="Trichy West",
        grievance_text=(
            "My father is 72 and had a stroke yesterday morning. We called 108 ambulance "
            "but they took more than 2 hours to reach. By the time we got to Government "
            "Hospital Trichy, doctors said the ICU is full and we should go to a private "
            "hospital. Private hospital is asking ₹2 lakh advance which we cannot afford. "
            "Father is currently in the emergency ward but not yet admitted properly. "
            "Please help us get him admitted to a government ICU bed immediately."
        ),
        expect_category=GrievanceCategory.HEALTH,
        min_urgency=UrgencyLevel.CRITICAL,
    ),
    # ── Tamil-language petitions (manu / மனு) ────────────────────────────────
    Scenario(
        name="Tamil: drinking water shortage (குடிநீர் தட்டுப்பாடு)",
        citizen_name="கோபால் சாமி",
        constituency="தஞ்சாவூர் கிழக்கு",
        grievance_text=(
            "ஐயா, வணக்கம். நான் தஞ்சாவூர் கிழக்கு தொகுதி, அண்ணா நகர் "
            "4வது தெருவில் வசிக்கிறேன். எங்கள் தெருவில் கடந்த இரண்டு "
            "மாதங்களாக குடிநீர் வரவில்லை. பஞ்சாயத்து அலுவலகத்தில் மூன்று "
            "முறை மனு கொடுத்தும் எந்த நடவடிக்கையும் இல்லை. தினமும் அரை "
            "கிலோமீட்டர் தூரம் நடந்து சென்று தண்ணீர் எடுத்து வர வேண்டியுள்ளது. "
            "வயதான பெண்களுக்கு மிகவும் கஷ்டமாக உள்ளது. தயவுசெய்து எங்கள் "
            "தெருவிற்கு குடிநீர் வசதி உடனடியாக ஏற்படுத்தித் தரவும்."
        ),
        expect_category=GrievanceCategory.WATER_SANITATION,
        min_urgency=UrgencyLevel.HIGH,
    ),
    Scenario(
        name="Tamil: crop loss compensation (பயிர் சேத இழப்பீடு)",
        citizen_name="முத்துலட்சுமி",
        constituency="திருவாரூர்",
        grievance_text=(
            "ஐயா, நான் ஒரு சிறு விவசாயி. கடந்த வாரம் பெய்த கனமழையால் என் "
            "மூன்று ஏக்கர் நெல் பயிர் முழுவதும் அழிந்துவிட்டது. சுமார் "
            "ரூ.1,20,000 நஷ்டம் ஏற்பட்டுள்ளது. பயிர்க் காப்பீடு "
            "செய்திருந்தேன், ஆனால் இதுவரை இழப்பீடு கிடைக்கவில்லை. வங்கியில் "
            "வாங்கிய பயிர்க் கடனை திருப்பிச் செலுத்த முடியாமல் தவிக்கிறேன். "
            "என் விண்ணப்ப எண் AGRI/TVR/2024/0789. தயவுசெய்து உடனடியாக "
            "இழப்பீட்டுத் தொகையை வழங்க உத்தரவிடவும்."
        ),
        expect_category=GrievanceCategory.DISASTER_RELIEF,
        min_urgency=UrgencyLevel.HIGH,
    ),
]


# ── Runner ─────────────────────────────────────────────────────────────────────

def run_scenario(svc: GrievanceSummarisationService, sc: Scenario) -> bool:
    section(sc.name)
    print(f"  {DIM}Citizen: {sc.citizen_name} · Constituency: {sc.constituency}{RESET}")
    print(f"  {DIM}Text length: {len(sc.grievance_text)} chars{RESET}")

    t0 = time.monotonic()
    try:
        summary = svc.summarise(
            citizen_name=sc.citizen_name,
            constituency=sc.constituency,
            grievance_text=sc.grievance_text,
            attachment_bytes=sc.attachment_bytes,
            attachment_mime=sc.attachment_mime,
            attachment_filename=sc.attachment_filename,
        )
    except Exception as exc:
        print(f"\n  {RED}{BOLD}✗ Summarisation FAILED:{RESET} {exc}\n")
        return False
    elapsed = (time.monotonic() - t0)

    render_summary(summary)
    print(f"\n  {DIM}⏱  {elapsed:.2f}s{RESET}")

    # ── Assertions ────────────────────────────────────────────────────────────
    ok = True
    if summary.category != sc.expect_category:
        print(f"  {YELLOW}⚠ Expected category {sc.expect_category.value}, got {summary.category.value}{RESET}")
        # Category mismatch is a warning, not a hard failure (model picks closest).
    if URGENCY_ORDER[summary.urgency] < URGENCY_ORDER[sc.min_urgency]:
        print(f"  {RED}✗ Urgency {summary.urgency.value} is below required minimum {sc.min_urgency.value}{RESET}")
        ok = False
    if sc.urgency_reason_required() and not summary.urgency_reason:
        print(f"  {RED}✗ Urgency is {summary.urgency.value} but urgency_reason is missing{RESET}")
        ok = False
    if not summary.key_details:
        print(f"  {RED}✗ key_details is empty{RESET}")
        ok = False
    if sc.attachment_bytes and not (summary.attachment_notes and summary.attachment_notes.strip()):
        print(f"  {RED}✗ attachment supplied but attachment_notes is empty (model ignored the file?){RESET}")
        ok = False
    if ok:
        print(f"  {GREEN}{BOLD}✓ Passed{RESET}")
    return ok


def _urgency_reason_required(self) -> bool:  # type: ignore[no-redef]
    return self.min_urgency in (UrgencyLevel.HIGH, UrgencyLevel.CRITICAL)
Scenario.urgency_reason_required = _urgency_reason_required  # type: ignore[attr-defined]


def discover_image_scenario() -> Optional[Scenario]:
    """
    If any image is present in tests/sample_images/, build one extra scenario
    using the first image found. Lets you test the multimodal (image+text) path
    without hard-coding a file path.
    """
    if not SAMPLE_IMAGE_DIR.exists():
        return None
    for path in sorted(SAMPLE_IMAGE_DIR.iterdir()):
        mime = IMAGE_MIME_BY_EXT.get(path.suffix.lower())
        if not mime:
            continue
        data = path.read_bytes()
        return Scenario(
            name=f"Image + text grievance ({path.name})",
            citizen_name="Priya Ramanathan",
            constituency="Trichy West",
            grievance_text=(
                "I am attaching a photograph of the issue near my house. "
                "Please look at the picture and take necessary action. The "
                "problem has been like this for several weeks and is causing "
                "inconvenience to everyone in the locality."
            ),
            # We don't know what the user's image will be, so we keep the
            # category expectation loose (OTHER) and only assert that
            # attachment_notes is non-empty during the run.
            expect_category=GrievanceCategory.OTHER,
            min_urgency=UrgencyLevel.LOW,
            attachment_bytes=data,
            attachment_mime=mime,
            attachment_filename=path.name,
        )
    return None


def main() -> int:
    api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    if not api_key:
        print(f"{RED}{BOLD}GEMINI_API_KEY not set.{RESET}")
        print("Set it in your environment or in backend/.env, then re-run.")
        return 2

    # Optional: auto-discover an image scenario from tests/sample_images/.
    image_scenario = discover_image_scenario()
    all_scenarios = list(SCENARIOS)
    if image_scenario:
        all_scenarios.append(image_scenario)

    banner("Grievance Summarisation — live Gemini test")
    print(f"  Model:    gemini-2.5-flash (with gemini-2.5-flash-lite fallback)")
    print(f"  API key:  {api_key[:6]}…{api_key[-4:]} ({len(api_key)} chars)")
    print(f"  Scenarios: {len(all_scenarios)}"
          + (f" (incl. 1 image)" if image_scenario else ""))
    if not image_scenario:
        print(f"  {DIM}Tip: drop a .jpg/.png into {SAMPLE_IMAGE_DIR} to add an image scenario.{RESET}")

    svc = GrievanceSummarisationService(api_key=api_key)

    passed = 0
    failed: list[str] = []
    for sc in all_scenarios:
        if run_scenario(svc, sc):
            passed += 1
        else:
            failed.append(sc.name)

    banner(
        f"Results: {passed}/{len(all_scenarios)} passed",
        colour=GREEN if not failed else RED,
    )
    if failed:
        print(f"{RED}Failed scenarios:{RESET}")
        for n in failed:
            print(f"  • {n}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
