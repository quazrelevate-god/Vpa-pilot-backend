"""
Seed a LARGE, varied demo dataset across all v2 tables so every PA-portal tab
has 100+ rows spanning all categories, priorities, ministries and departments.

Wipes transactional data (appointments, tickets, GSR, activity, referrals,
ai_uploads, citizens, slots) and reseeds — admin/login/mla/department_accounts
are left alone. Run from backend/:

    ./env/Scripts/python.exe scripts/seed_demo_data.py [--count 120]

Everything goes through the app's own crypto + admin lookup, so names decrypt
and status/priority/category FKs resolve exactly like production rows.
"""
from __future__ import annotations

import argparse
import asyncio
import os
import random
import sys
from datetime import date, datetime, time, timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

import logging  # noqa: E402
logging.disable(logging.INFO)   # silence SQLAlchemy echo during the bulk insert

from sqlalchemy import text  # noqa: E402

import src.models.appointment_models as am  # noqa: E402
import src.models.scheduling_models as sm  # noqa: E402
import src.models.ticket_models as tm  # noqa: E402
import src.models.activity_models as act  # noqa: E402
import src.models.grievance_summary_record as gsrm  # noqa: E402
import src.models.referral_models as rm  # noqa: E402
import src.models.ai_upload_models as aim  # noqa: E402
import src.models.login_models  # noqa: E402
import src.models.qr_models  # noqa: E402
import src.models.department_account  # noqa: E402

from src.core import crypto  # noqa: E402
from src.core.database import AsyncSessionLocal  # noqa: E402
from src.services.v2_helpers import v2  # noqa: E402

random.seed(2026)

# ── Name pools (Tamil + Latin transliteration) ───────────────────────────────
FIRST = [
    ("Murugan", "முருகன்"), ("Lakshmi", "லட்சுமி"), ("Kavitha", "கவிதா"),
    ("Arun", "அருண்"), ("Devi", "தேவி"), ("Senthil", "செந்தில்"),
    ("Meena", "மீனா"), ("Ramesh", "ரமேஷ்"), ("Anitha", "அனிதா"),
    ("Karthik", "கார்த்திக்"), ("Vijaya", "விஜயா"), ("Ganesan", "கணேசன்"),
    ("Saraswathi", "சரஸ்வதி"), ("Manikandan", "மணிகண்டன்"), ("Punitha", "புனிதா"),
    ("Balamurugan", "பாலமுருகன்"), ("Chitra", "சித்ரா"), ("Rajesh", "ராஜேஷ்"),
    ("Selvi", "செல்வி"), ("Prakash", "பிரகாஷ்"), ("Revathi", "ரேவதி"),
    ("Dinesh", "தினேஷ்"), ("Bhuvana", "புவனா"), ("Suresh", "சுரேஷ்"),
    ("Kalaiselvi", "கலைச்செல்வி"), ("Vignesh", "விக்னேஷ்"), ("Priya", "பிரியா"),
    ("Mohan", "மோகன்"), ("Nithya", "நித்யா"), ("Saravanan", "சரவணன்"),
]
LAST = [
    ("Selvam", "செல்வம்"), ("Narayanan", "நாராயணன்"), ("Rajendran", "ராஜேந்திரன்"),
    ("Kumar", "குமார்"), ("Krishnan", "கிருஷ்ணன்"), ("Subramani", "சுப்ரமணி"),
    ("Pillai", "பிள்ளை"), ("Raj", "ராஜ்"), ("Vel", "வேல்"),
    ("Murthy", "மூர்த்தி"), ("Babu", "பாபு"), ("Devar", "தேவர்"),
    ("Nadar", "நாடார்"), ("Gounder", "கவுண்டர்"), ("Iyer", "ஐயர்"),
    ("Chettiar", "செட்டியார்"), ("Mudaliar", "முதலியார்"), ("Thevar", "தேவர்"),
]

# ── Grievance templates: (category, ministry, priority, EN summary, EN ask, TA summary, TA ask)
TEMPLATES = [
    ("school_admission", "school_education_tamil_dev_info_publicity", "high",
     "Daughter denied admission under the 7.5% government-school quota despite eligibility. Academic year begins shortly.",
     "Direct the school to admit the student under the reserved quota.",
     "தகுதி இருந்தும் 7.5% அரசுப் பள்ளி ஒதுக்கீட்டில் மகளுக்கு சேர்க்கை மறுப்பு.",
     "ஒதுக்கீட்டின் கீழ் மாணவியை சேர்க்க பள்ளிக்கு உத்தரவிடவும்."),
    ("transfer_requests", "human_resources_management", "medium",
     "Assistant seeking inter-district transfer to reunite with spouse posted elsewhere. Applied thrice with no response.",
     "Approve the inter-district transfer in the upcoming counselling.",
     "வேறு மாவட்டத்தில் பணிபுரியும் துணையுடன் சேர மாவட்ட மாறுதல் கோரிக்கை.",
     "வரும் கலந்தாய்வில் மாவட்ட மாறுதல் வழங்கவும்."),
    ("pension_requests", "finance_planning_development", "high",
     "Retired employee's monthly pension stopped for months after a bank merger; new PPO not issued.",
     "Restore the monthly pension and clear the arrears.",
     "வங்கி இணைப்புக்குப் பின் ஓய்வூதியம் நிறுத்தம்; புதிய PPO இல்லை.",
     "மாத ஓய்வூதியத்தை மீட்டமைத்து நிலுவைத் தொகையை வழங்கவும்."),
    ("action_required", "school_education_tamil_dev_info_publicity", "critical",
     "Government school classroom roof collapsed after heavy rain; students shifted to the corridor mid-monsoon.",
     "Sanction emergency repair before the monsoon peak.",
     "கனமழையில் அரசுப் பள்ளி வகுப்பறை கூரை இடிந்தது; மாணவர்கள் நடைபாதையில்.",
     "மழைக்காலம் முடியும் முன் அவசர பழுதுபார்ப்புக்கு நிதி ஒதுக்கவும்."),
    ("job_requests", "labour_welfare_skill_development", "medium",
     "ITI graduate registered with the employment exchange seeking placement under the skill-development scheme.",
     "Consider for the next skill-placement drive.",
     "ITI முடித்து வேலைவாய்ப்பு அலுவலகத்தில் பதிவு; திறன் திட்டத்தில் வேலை வேண்டும்.",
     "அடுத்த திறன் வேலைவாய்ப்பு முகாமில் பரிசீலிக்கவும்."),
    ("rti", "school_education_tamil_dev_info_publicity", "low",
     "RTI on the district teacher-vacancy list is overdue by 60 days; first appeal also unanswered.",
     "Direct the PIO to furnish the vacancy information.",
     "மாவட்ட ஆசிரியர் காலியிட RTI 60 நாட்களாக பதிலின்றி; மேல்முறையீடும் இல்லை.",
     "தகவல் வழங்க PIO-வுக்கு உத்தரவிடவும்."),
    ("proposals", "school_education_tamil_dev_info_publicity", "low",
     "Parents propose an evening study centre in the corporation school; two retired teachers volunteer.",
     "Approve the evening study-centre proposal.",
     "மாநகராட்சி பள்ளியில் மாலை படிப்பு மைய முன்மொழிவு; இரு ஆசிரியர்கள் தன்னார்வம்.",
     "மாலை படிப்பு மைய முன்மொழிவுக்கு ஒப்புதல் வழங்கவும்."),
    ("action_required", "health_medical_education_family_welfare", "high",
     "Primary health centre has no evening doctor for two months; nearest hospital is far for a dialysis patient.",
     "Post a medical officer for the evening shift.",
     "ஆரம்ப சுகாதார நிலையத்தில் இரு மாதமாக மாலை மருத்துவர் இல்லை.",
     "மாலை நேர மருத்துவ அலுவலரை நியமிக்கவும்."),
    ("general", "revenue_disaster_management", "medium",
     "Patta name transfer pending eight months after a death; taluk office keeps demanding resubmission.",
     "Expedite the patta name transfer.",
     "இறப்புக்குப் பின் 8 மாதமாக பட்டா மாறுதல் நிலுவையில்.",
     "பட்டா பெயர் மாற்றத்தை விரைவுபடுத்தவும்."),
    ("school_upgradation", "school_education_tamil_dev_info_publicity", "medium",
     "Village middle school needs upgrading to high school; nearest HS is 9 km and girls drop out.",
     "Sanction the upgrade to a high school.",
     "கிராம நடுநிலைப் பள்ளியை உயர்நிலைப் பள்ளியாக தரம் உயர்த்த வேண்டும்.",
     "உயர்நிலைப் பள்ளியாக தரம் உயர்த்த ஒப்புதல் வழங்கவும்."),
    ("associations_unions", "labour_welfare_skill_development", "low",
     "Sanitary workers' association requests overdue welfare-board ID cards for 40 members.",
     "Issue the pending welfare-board identity cards.",
     "துப்புரவு தொழிலாளர் சங்கம் 40 உறுப்பினர்களுக்கு நல வாரிய அட்டை கோருகிறது.",
     "நிலுவையில் உள்ள நல வாரிய அடையாள அட்டைகளை வழங்கவும்."),
    ("action_required", "transport", "high",
     "Only morning town bus to the taluk; students and patients stranded in the afternoon.",
     "Add an afternoon town-bus service on the route.",
     "வட்டத்திற்கு காலை பேருந்து மட்டுமே; மதியம் மாணவர்கள் சிக்கல்.",
     "பிற்பகல் நகரப் பேருந்து சேவையை இயக்கவும்."),
    ("general", "housing_urban_development", "medium",
     "Approved housing-scheme instalment not released for eight months though construction is complete.",
     "Release the pending housing-scheme instalment.",
     "வீட்டுத் திட்ட தவணை 8 மாதமாக வழங்கப்படவில்லை; கட்டுமானம் முடிந்தது.",
     "நிலுவையில் உள்ள வீட்டுத் திட்ட தவணையை வழங்கவும்."),
    ("job_requests", "social_welfare_women_welfare", "medium",
     "Widow seeks inclusion in the differently-abled/widow employment quota; certificate enclosed.",
     "Include the applicant in the welfare employment quota.",
     "விதவை வேலைவாய்ப்பு ஒதுக்கீட்டில் சேர்க்க கோரிக்கை; சான்று இணைப்பு.",
     "நல வேலைவாய்ப்பு ஒதுக்கீட்டில் விண்ணப்பதாரரை சேர்க்கவும்."),
    ("action_required", "agriculture_farmers_welfare", "high",
     "Crop-insurance claim rejected on a technicality after verified flood loss; farmer in debt.",
     "Reopen and settle the crop-insurance claim.",
     "வெள்ள சேதம் உறுதியானாலும் பயிர் காப்பீடு நிராகரிப்பு; விவசாயி கடனில்.",
     "பயிர் காப்பீட்டு கோரிக்கையை மீள்பரிசீலித்து தீர்க்கவும்."),
    ("proposals", "higher_education_technical_education", "low",
     "Alumni propose a free evening coaching centre for competitive exams in the government college.",
     "Permit the free competitive-exam coaching centre.",
     "அரசு கல்லூரியில் இலவச மாலை போட்டித் தேர்வு பயிற்சி மைய முன்மொழிவு.",
     "இலவச போட்டித் தேர்வு பயிற்சி மையத்திற்கு அனுமதி வழங்கவும்."),
]

# GSR priority buckets (urgency-style, drives the analytics chart + priority pills)
PRIORITIES = ["critical", "high", "medium", "low"]
MINISTRIES = [t[1] for t in TEMPLATES]  # weighted toward school education (deployment focus)
VENUES = ["Chromepet Camp Office", "Tambaram Constituency Office", "Pallavaram Ward Office"]
SCHOOL_DEPTS = [
    "director_school_education", "private_schools", "elementary_education",
    "govt_examination", "non_formal_adult_education", "public_libraries",
    "scert", "teacher_recruitment_board", "tn_education_service_corp", "samagra_shiksha",
]
SCHOOL_MINISTRY = "school_education_tamil_dev_info_publicity"
REFERRERS = ["MLA Pallavaram", "District Secretary", "Union Chairman", "Councillor Ward 12",
             "MP Office", "Party District Head", "Panchayat President"]


def _tok(d: date, seq: int) -> int:
    return int(d.strftime("%Y%m%d")) * 100000 + seq


def _name(i: int):
    f = FIRST[i % len(FIRST)]
    l = LAST[(i // len(FIRST) + i) % len(LAST)]
    return f"{f[0]} {l[0]}", f"{f[1]} {l[1]}", f"98{random.randint(10000000, 99999999)}"


async def main(count: int) -> None:
    async with AsyncSessionLocal() as db:
        await v2.init(db)

        print("[wipe] clearing transactional tables…")
        for tbl in ("activity", "ticket_attachments", "ticket", "grievance_summary_records",
                    "attachments", "ai_uploads", "appointment", "citizens",
                    "referral_bookings", "referral_slots", "referral_availability",
                    "slots", "availability", "otp_verification", "gatekeeper", "qr_logs"):
            await db.execute(text(f"DELETE FROM {tbl}"))
        await db.commit()

        today = date.today()
        now = datetime.utcnow()

        # ── Availability + slots across a week (past 2 → future 4) ──────────────
        print("[seed] availability + slots (7 days)…")
        slots_by_day: dict[date, list] = {}
        for offset in range(-2, 5):
            d = today + timedelta(days=offset)
            avail = sm.MLADailyAvailability(mla_id=1, date=d, is_open=True)
            db.add(avail); await db.flush()
            day_slots = []
            cur = datetime.combine(d, time(8, 0)); end = datetime.combine(d, time(18, 0)); n = 1
            while cur < end:
                se = cur + timedelta(minutes=30)
                in_window = time(10, 0) <= cur.time() < time(17, 0)
                s = sm.AppointmentSlot(availability_id=avail.id, slot_number=n,
                                       start_time=cur.time(), end_time=se.time(),
                                       status="AVAILABLE" if in_window else "BLOCKED",
                                       max_capacity=12, booked_count=0)
                db.add(s); day_slots.append(s); cur = se; n += 1
            await db.flush()
            slots_by_day[d] = [s for s in day_slots if s.status == "AVAILABLE"]

        def book(d: date):
            avail_slots = [s for s in slots_by_day[d] if s.booked_count < s.max_capacity]
            s = random.choice(avail_slots); s.booked_count += 1; return s

        # ── Explicit target-driven distribution so EVERY tab is 100+ ────────────
        # (kind, status): rows. REVIEWED drives ticket count 1:1, so keep it high.
        targets = {
            ("meeting",  "SCHEDULED"):       48,   # Scheduled tab + today's floor board
            ("meeting",  "WAITING"):         30,   # Waiting tab
            ("meeting",  "RESCHEDULED"):     24,   # Rescheduled tab
            ("meeting",  "AWAITING_REVIEW"): 16,   # "came" arrivals (still on floor board)
            ("meeting",  "NOT_CAME"):        12,   # no-shows on the board
            ("meeting",  "COURTESY_DONE"):   16,   # invitation/greetings visitors
            ("petition", "AWAITING_REVIEW"): 60,   # Awaiting Review tab (petitions)
            ("petition", "REVIEWED"):       104,   # Reviewed tab → 104 tickets
        }
        # Scale to the requested count (default 310 hits the targets exactly).
        base = sum(targets.values())
        scale = count / base
        plan_statuses = []
        for key, n in targets.items():
            plan_statuses += [key] * max(1, round(n * scale))
        random.shuffle(plan_statuses)

        print(f"[seed] {count} citizens + appointments + summaries…")
        seq = 0
        queue_pos = 0
        reviewed_appts: list = []
        for idx, (kind, status) in enumerate(plan_statuses):
            seq += 1
            name_en, name_ta, mobile = _name(idx)
            citizen = am.Citizen(
                encrypted_name=crypto.encrypt(name_en),
                encrypted_mobile=crypto.encrypt(mobile),
                mobile_index=crypto.blind_index(mobile + str(idx)),  # unique
                created_at=now - timedelta(days=random.randint(0, 20)),
            )
            db.add(citizen); await db.flush()

            meeting = kind == "meeting"
            is_courtesy = status == "COURTESY_DONE" or (meeting and random.random() < 0.05)
            tpl = random.choice(TEMPLATES)
            category = "invitation" if is_courtesy else tpl[0]
            priority = random.choice(PRIORITIES) if not is_courtesy else "low"
            ministry = tpl[1]
            created = now - timedelta(days=random.randint(0, 14),
                                      hours=random.randint(0, 23), minutes=random.randint(0, 59))

            ids = v2.new_appointment_ids(status=status, category=category)
            a = am.Appointment(
                citizen_id=citizen.id, slot_id=None, schedule_meeting=meeting,
                token_assigned=_tok(today, seq),
                encrypted_grievance=None if is_courtesy else crypto.encrypt(tpl[3]),
                encrypted_name_ta=crypto.encrypt(name_ta),
                grievance_category=category,
                status=status, status_id=ids["status_id"],
                priority_id=ids["priority_id"], category_id=ids.get("category_id"),
                venue_id=random.choice(VENUES), num_persons=random.randint(1, 4),
                summary_status="DONE", created_at=created,
            )
            if is_courtesy:
                a.encrypted_transcript = crypto.encrypt(
                    "அமைச்சர் அவர்களை எங்கள் விழாவிற்கு அழைக்க வந்தேன்.")
                a.transcript_status = "DONE"
            db.add(a); await db.flush()

            # Book a slot for meetings that have a concrete day
            if status in ("SCHEDULED", "NOT_CAME", "COURTESY_DONE"):
                # today-heavy so the floor board is full; some upcoming
                d = today + timedelta(days=random.choice([0, 0, 0, 1, 2, 3]))
                if status == "NOT_CAME":
                    d = today  # no-shows are for today
                s = book(d); a.slot_id = s.id
            elif status == "AWAITING_REVIEW" and meeting:
                a.slot_id = book(today).id   # "came" arrivals still show on today's board
            if status == "WAITING":
                queue_pos += 1
                a.queue_position = queue_pos
                a.waiting_since = now - timedelta(hours=random.randint(1, 40))

            # AI summary (skip courtesy)
            if not is_courtesy:
                db.add(gsrm.GrievanceSummaryRecord(
                    appointment_id=a.id, is_latest=True,
                    priority=priority, category=category, ministry=ministry,
                    name_en=name_en, name_ta=name_ta,
                    summary=tpl[3], citizen_ask=tpl[4],
                    key_details=[tpl[3][:60] + "…", "Documents attached", "Follow-up requested"],
                    summary_ta=tpl[5], citizen_ask_ta=tpl[6],
                    key_details_ta=[tpl[5][:40] + "…", "ஆவணங்கள் இணைப்பு"],
                    gemini_model_used="gemini-2.5-flash",
                    gemini_latency_ms=random.randint(2200, 7200),
                    created_at=created + timedelta(seconds=40),
                ))
                db.add(act.Activity(
                    appointment_id=a.id, user="system", action_type="ai_summarised",
                    message=f"AI summarised — priority={priority}, category={category}",
                    payload={"priority": priority, "category": category, "ministry": ministry},
                    created_at=created + timedelta(seconds=45)))
            if status == "REVIEWED":
                reviewed_appts.append((a, priority, ministry, name_en))

        await db.flush()

        # ── Tickets: one per REVIEWED petition, spread over EVERY ticket status ──
        print(f"[seed] {len(reviewed_appts)} tickets across all statuses/departments…")
        # status → (progress, has_department)
        ticket_status_cycle = [
            "open", "triaged", "assigned", "awaiting_department", "in_progress",
            "in_progress", "pending_citizen", "forwarded_to_dept", "resolved",
            "resolved", "closed", "reopened",
        ]
        year = today.year
        for i, (a, priority, ministry, name_en) in enumerate(reviewed_appts, start=1):
            tstatus = ticket_status_cycle[i % len(ticket_status_cycle)]
            is_school = ministry == SCHOOL_MINISTRY
            forwarded = tstatus == "forwarded_to_dept" or (not is_school and tstatus in ("assigned", "in_progress"))
            dept = None if forwarded else (random.choice(SCHOOL_DEPTS)
                                           if tstatus in ("assigned", "awaiting_department", "in_progress",
                                                          "pending_citizen", "resolved", "closed", "reopened")
                                           else None)
            prio = {"critical": "P0", "high": "P1", "medium": "P2", "low": "P3"}[priority]
            accepted = dept and tstatus in ("in_progress", "pending_citizen", "resolved", "closed", "reopened")
            progress = {"in_progress": random.choice([30, 50, 70]), "pending_citizen": 45,
                        "resolved": 100, "closed": 100, "reopened": 60}.get(tstatus, 0)
            resolved = tstatus in ("resolved", "closed")
            t = tm.Ticket(
                appointment_id=a.id, ticket_number=f"TKT-{year}-{i:05d}",
                status=tstatus, status_id=v2.ticket_status_id_or_none(tstatus),
                priority=prio, priority_id=v2.priority_id_or_none(prio),
                department=dept,
                accepted_at=(now - timedelta(hours=20)) if accepted else None,
                accepted_by=dept if accepted else None,
                progress_pct=progress,
                forwarded_to_dept=ministry if forwarded else None,
                forwarded_at=(now - timedelta(hours=30)) if forwarded else None,
                forwarded_by="pa_admin" if forwarded else None,
                forwarded_notes="Non-school ministry — forwarded from petition review." if forwarded else None,
                resolution_notes="Action completed and citizen informed." if resolved else None,
                resolved_at=(now - timedelta(hours=4)) if resolved else None,
                closed_at=(now - timedelta(hours=2)) if tstatus == "closed" else None,
                closure_reason="action_taken" if tstatus == "closed" else None,
                reopened_at=(now - timedelta(hours=6)) if tstatus == "reopened" else None,
                reopen_count=1 if tstatus == "reopened" else 0,
                due_date=(now + timedelta(days=random.randint(2, 10))) if tstatus in ("in_progress", "assigned") else None,
                assigned_to_pa=random.choice(["pa_ravi", "pa_meena", "pa_kumar"]) if tstatus != "open" else None,
                created_at=now - timedelta(days=random.randint(1, 6)),
                updated_at=now - timedelta(hours=random.randint(1, 40)),
            )
            db.add(t); await db.flush()
            db.add(act.Activity(ticket_id=t.id, user="pa_admin", action_type="created",
                                message=f"Ticket created after PA review (token {a.token_assigned})",
                                payload={"token": a.token_assigned},
                                created_at=t.created_at))
            if dept:
                db.add(act.Activity(ticket_id=t.id, user="pa_admin", action_type="routed_to_department",
                                    payload={"from": None, "to": dept},
                                    created_at=t.created_at + timedelta(hours=2)))
            if accepted:
                db.add(act.Activity(ticket_id=t.id, user=dept, action_type="department_accepted",
                                    created_at=now - timedelta(hours=20)))
            if progress:
                db.add(act.Activity(ticket_id=t.id, user=dept or "pa_admin", action_type="progress_update",
                                    message="Field verification completed; report drafted.",
                                    payload={"progress_pct": progress},
                                    created_at=now - timedelta(hours=8)))
            if resolved:
                db.add(act.Activity(ticket_id=t.id, user=dept or "pa_admin", action_type="resolved",
                                    message="Action completed and citizen informed.",
                                    created_at=now - timedelta(hours=4)))
            if forwarded:
                db.add(act.Activity(ticket_id=t.id, user="pa_admin", action_type="forwarded_to_dept",
                                    message="Non-school ministry — forwarded from petition review.",
                                    payload={"ministry": ministry},
                                    created_at=now - timedelta(hours=30)))

        # ── Referrals (30, today + tomorrow) ────────────────────────────────────
        print("[seed] referrals (30)…")
        for day_off in (0, 1):
            d = today + timedelta(days=day_off)
            ravail = rm.ReferralAvailability(date=d, start_time=time(11, 0), end_time=time(13, 0),
                                             status="ACTIVE", created_by="pa_admin")
            db.add(ravail); await db.flush()
            rslots = []
            cur = datetime.combine(d, time(11, 0))
            for n in range(1, 5):
                s = rm.ReferralSlot(availability_id=ravail.id, slot_number=n,
                                    start_time=cur.time(), end_time=(cur + timedelta(minutes=30)).time(),
                                    status="AVAILABLE", max_capacity=6, booked_count=0)
                db.add(s); rslots.append(s); cur += timedelta(minutes=30)
            await db.flush()
            for i in range(15):
                slot = rslots[i % len(rslots)]
                if slot.booked_count >= slot.max_capacity:
                    continue
                slot.booked_count += 1
                name_en, _t, mobile = _name(1000 + day_off * 100 + i)
                st = ("PENDING" if day_off else random.choice(["PENDING", "CAME", "CAME", "NOT_CAME"]))
                db.add(rm.ReferralBooking(
                    slot_id=slot.id, token_number=_tok(d, 500 + i),
                    name=crypto.encrypt(name_en), mobile=crypto.encrypt(mobile),
                    num_persons=random.randint(1, 3), referred_by=random.choice(REFERRERS),
                    reason="Requesting a personal meeting regarding local infrastructure works.",
                    status=st, scheduled_date=d,
                    scheduled_start_time=slot.start_time, scheduled_end_time=slot.end_time))

        # ── AI uploads (25, every status) ───────────────────────────────────────
        print("[seed] ai_uploads (25)…")
        up_statuses = (["AWAITING_REVIEW"] * 12 + ["REVIEWED"] * 6 +
                       ["QUEUED"] * 3 + ["PROCESSING"] * 2 + ["FAILED"] * 2)
        for i, st in enumerate(up_statuses):
            name_en, name_ta, mobile = _name(2000 + i)
            has_data = st in ("AWAITING_REVIEW", "REVIEWED")
            tpl = random.choice(TEMPLATES)
            db.add(aim.AiUpload(
                batch_id=f"batch{i // 8:02d}deadbeef",
                original_filename=f"petition_scan_{i+1:03d}.{'pdf' if i % 3 == 0 else 'jpg'}",
                storage_url=f"ai_uploads/scan/{i+1:03d}",
                mime_type="application/pdf" if i % 3 == 0 else "image/jpeg",
                status=st,
                extracted_name=name_en if has_data else None,
                extracted_name_ta=name_ta if has_data else None,
                extracted_mobile=mobile if has_data else None,
                grievance_category=tpl[0] if has_data else None,
                priority=random.choice(PRIORITIES) if has_data else None,
                summary_json={"summary": tpl[3]} if has_data else None,
                error_message=None if st != "FAILED" else "Gemini extraction timed out (demo).",
                created_at=now - timedelta(hours=random.randint(1, 12)),
                processed_at=(now - timedelta(hours=random.randint(1, 8))) if st not in ("QUEUED", "PROCESSING") else None,
                reviewed_at=(now - timedelta(hours=1)) if st == "REVIEWED" else None,
                reviewed_by="pa_admin" if st == "REVIEWED" else None,
            ))

        await db.commit()
        print("[done] demo data seeded.\n")

        # ── Report ───────────────────────────────────────────────────────────────
        async def c(sql):
            return (await db.execute(text(sql))).scalar()
        print("        appointments by status:")
        for row in (await db.execute(text(
                "SELECT status, count(*) FROM appointment GROUP BY status ORDER BY count(*) DESC"))).all():
            print(f"          {row[0]:16s} {row[1]}")
        print("        tickets by status:")
        for row in (await db.execute(text(
                "SELECT status, count(*) FROM ticket GROUP BY status ORDER BY count(*) DESC"))).all():
            print(f"          {row[0]:20s} {row[1]}")
        for tbl in ("citizens", "appointment", "grievance_summary_records", "ticket",
                    "activity", "referral_bookings", "ai_uploads"):
            print(f"        {tbl:28s} {await c(f'SELECT count(*) FROM {tbl}')}")
        print(f"        distinct ministries in GSR   "
              f"{await c('SELECT count(DISTINCT ministry) FROM grievance_summary_records')}")
        print(f"        distinct categories in appts "
              f"{await c('SELECT count(DISTINCT category) FROM appointment')}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--count", type=int, default=310, help="number of appointments (default 310 → ~104 tickets)")
    args = ap.parse_args()
    asyncio.run(main(args.count))
