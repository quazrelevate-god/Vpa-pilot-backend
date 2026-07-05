"""
Seed realistic demo data across all v2 tables so the PA portal has content.

Wipes transactional data (appointments, tickets, GSR, activity, referrals,
ai_uploads, citizens) and reseeds — admin/login/mla/department_accounts are
left alone. Run from backend/:

    ./env/Scripts/python.exe scripts/seed_demo_data.py

Everything goes through the app's own crypto + admin lookup, so names decrypt
and status/priority/category FKs resolve exactly like production rows.
"""
from __future__ import annotations

import asyncio
import os
import random
import sys
from datetime import date, datetime, time, timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

from sqlalchemy import text, select  # noqa: E402

# Register every model on the shared Base before any query.
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

random.seed(42)

# ── Demo citizens (name_en, name_ta, mobile) ─────────────────────────────────
CITIZENS = [
    ("Murugan Selvam",      "முருகன் செல்வம்",       "9840011001"),
    ("Lakshmi Narayanan",   "லட்சுமி நாராயணன்",      "9840011002"),
    ("Kavitha Rajendran",   "கவிதா ராஜேந்திரன்",     "9840011003"),
    ("Arun Prakash",        "அருண் பிரகாஷ்",         "9840011004"),
    ("Devi Priya",          "தேவி பிரியா",           "9840011005"),
    ("Senthil Kumar",       "செந்தில் குமார்",        "9840011006"),
    ("Meena Kumari",        "மீனா குமாரி",           "9840011007"),
    ("Ramesh Babu",         "ரமேஷ் பாபு",            "9840011008"),
    ("Anitha Vel",          "அனிதா வேல்",            "9840011009"),
    ("Karthik Subramani",   "கார்த்திக் சுப்ரமணி",    "9840011010"),
    ("Vijaya Lakshmi",      "விஜயா லட்சுமி",         "9840011011"),
    ("Ganesan Pillai",      "கணேசன் பிள்ளை",         "9840011012"),
    ("Saraswathi Ammal",    "சரஸ்வதி அம்மாள்",       "9840011013"),
    ("Manikandan Raj",      "மணிகண்டன் ராஜ்",        "9840011014"),
    ("Punitha Selvi",       "புனிதா செல்வி",          "9840011015"),
    ("Balamurugan K",       "பாலமுருகன் கே",         "9840011016"),
    ("Chitra Devi",         "சித்ரா தேவி",           "9840011017"),
    ("Rajesh Kannan",       "ராஜேஷ் கண்ணன்",         "9840011018"),
]

# (category, ministry, priority, summary bullets EN, citizen_ask EN, summary TA, ask TA)
GRIEVANCES = [
    ("school_admission", "school_education_tamil_dev_info_publicity", "high",
     "• Daughter denied admission to Govt Girls HSS Chromepet under 7.5% quota\n• School claims seats are full but quota register was not shown\n• Academic year starts in two weeks",
     "Direct the school to admit the student under the reserved quota",
     "• சுரோம்பேட் அரசு மகளிர் மேல்நிலைப் பள்ளியில் 7.5% ஒதுக்கீட்டில் சேர்க்கை மறுப்பு\n• இடங்கள் நிரம்பியதாக பள்ளி கூறுகிறது\n• கல்வியாண்டு இரண்டு வாரத்தில் தொடங்குகிறது",
     "ஒதுக்கீட்டின் கீழ் மாணவியை சேர்க்க பள்ளிக்கு உத்தரவிடவும்"),
    ("transfer_requests", "school_education_tamil_dev_info_publicity", "medium",
     "• BT Assistant at PUMS Tambaram for 11 years, requesting transfer to Madurai\n• Spouse works in Madurai Government Hospital\n• Applied thrice through proper channel with no response",
     "Approve inter-district transfer in the upcoming counselling",
     "• தாம்பரம் அரசு நடுநிலைப் பள்ளியில் 11 ஆண்டுகள் பணி, மதுரைக்கு மாறுதல் கோரிக்கை\n• கணவர் மதுரை அரசு மருத்துவமனையில் பணி\n• மூன்று முறை விண்ணப்பித்தும் பதில் இல்லை",
     "வரும் கலந்தாய்வில் மாவட்டம் விட்டு மாவட்டம் மாறுதல் வழங்கவும்"),
    ("pension_requests", "finance_planning", "high",
     "• Retired headmistress, pension stopped for 4 months after bank merger\n• AG office says records moved but new PPO not issued\n• Sole earner for family, medical expenses pending",
     "Restore the monthly pension and clear the arrears",
     "• ஓய்வுபெற்ற தலைமையாசிரியை, வங்கி இணைப்புக்குப் பின் 4 மாதமாக ஓய்வூதியம் நிறுத்தம்\n• புதிய PPO வழங்கப்படவில்லை\n• மருத்துவச் செலவுகள் நிலுவையில்",
     "மாத ஓய்வூதியத்தை மீட்டமைத்து நிலுவைத் தொகையை வழங்கவும்"),
    ("action_required", "school_education_tamil_dev_info_publicity", "critical",
     "• Govt HS Sholinganallur classroom roof collapsed after rains\n• 42 students shifted to corridor, monsoon continuing\n• PWD inspection done 3 weeks ago but no work order",
     "Sanction emergency repair before the monsoon peak",
     "• சோழிங்கநல்லூர் அரசு உயர்நிலைப் பள்ளி வகுப்பறை கூரை மழையில் இடிந்தது\n• 42 மாணவர்கள் நடைபாதையில் அமர்ந்து படிக்கின்றனர்\n• PWD ஆய்வு முடிந்தும் பணி ஆணை இல்லை",
     "மழைக்காலம் முடியும் முன் அவசர பழுதுபார்ப்புக்கு நிதி ஒதுக்கவும்"),
    ("job_requests", "labour_welfare_skill_development", "medium",
     "• Completed ITI welding trade in 2023, registered with employment exchange\n• Seeking placement under Naan Mudhalvan scheme\n• Family below poverty line, father disabled",
     "Consider for the next skill-placement drive",
     "• 2023-ல் ITI வெல்டிங் முடித்து வேலைவாய்ப்பு அலுவலகத்தில் பதிவு\n• நான் முதல்வன் திட்டத்தில் வேலை வேண்டும்\n• குடும்பம் வறுமைக் கோட்டுக்கு கீழ்",
     "அடுத்த திறன் வேலைவாய்ப்பு முகாமில் பரிசீலிக்கவும்"),
    ("rti", "school_education_tamil_dev_info_publicity", "low",
     "• RTI filed on teacher vacancy list for Kanchipuram district in March\n• PIO reply overdue by 60 days\n• First appeal also unanswered",
     "Direct the PIO to furnish the vacancy information",
     "• காஞ்சிபுரம் மாவட்ட ஆசிரியர் காலிப்பணியிட விவரம் கோரி மார்ச்சில் RTI\n• 60 நாட்களாக பதில் இல்லை\n• முதல் மேல்முறையீடும் பதிலளிக்கப்படவில்லை",
     "தகவல் வழங்க PIO-வுக்கு உத்தரவிடவும்"),
    ("proposals", "school_education_tamil_dev_info_publicity", "low",
     "• Proposal to start evening tuition centre in Pallavaram corporation school\n• 60 parents signed support letter, two retired teachers volunteer\n• Needs only lighting and one cleaner post",
     "Approve the evening study centre proposal",
     "• பல்லாவரம் மாநகராட்சி பள்ளியில் மாலை படிப்பு மையம் தொடங்க முன்மொழிவு\n• 60 பெற்றோர் ஆதரவு கடிதம்\n• மின்சாரம் மற்றும் ஒரு துப்புரவு பணியிடம் மட்டும் தேவை",
     "மாலை படிப்பு மைய முன்மொழிவுக்கு ஒப்புதல் வழங்கவும்"),
    ("action_required", "health_family_welfare", "high",
     "• PHC Medavakkam has no evening doctor for 2 months\n• Nearest GH is 12 km, auto fare unaffordable for daily dialysis patient\n• Ward councillor letter attached",
     "Post a medical officer for the evening shift",
     "• மேடவாக்கம் ஆரம்ப சுகாதார நிலையத்தில் 2 மாதமாக மாலை மருத்துவர் இல்லை\n• அருகிலுள்ள அரசு மருத்துவமனை 12 கி.மீ தொலைவில்\n• வட்டார உறுப்பினர் கடிதம் இணைப்பு",
     "மாலை நேர மருத்துவ அலுவலரை நியமிக்கவும்"),
    ("general", "revenue_disaster_management", "medium",
     "• Patta transfer pending 8 months after father's death\n• Taluk office demands repeated document resubmission\n• Legal heir certificate already issued",
     "Expedite the patta name transfer",
     "• தந்தை இறந்து 8 மாதமாகியும் பட்டா மாறுதல் நிலுவையில்\n• வட்டாட்சியர் அலுவலகம் மீண்டும் மீண்டும் ஆவணம் கேட்கிறது\n• வாரிசு சான்று ஏற்கனவே வழங்கப்பட்டது",
     "பட்டா பெயர் மாற்றத்தை விரைவுபடுத்தவும்"),
    ("school_admission", "school_education_tamil_dev_info_publicity", "medium",
     "• TC not issued by private school over disputed fee balance\n• Child unable to join new school in Tambaram\n• Fee receipts for full year available",
     "Instruct the school to release the transfer certificate",
     "• கட்டண பாக்கி காரணம் கூறி தனியார் பள்ளி TC வழங்க மறுப்பு\n• குழந்தை புதிய பள்ளியில் சேர முடியவில்லை\n• முழு ஆண்டு கட்டண ரசீதுகள் உள்ளன",
     "மாற்றுச் சான்றிதழ் வழங்க பள்ளிக்கு அறிவுறுத்தவும்"),
]

VENUES = ["Chromepet Camp Office", "Tambaram Constituency Office"]


def _tok(d: date, seq: int) -> int:
    return int(d.strftime("%Y%m%d")) * 100000 + seq


async def main() -> None:
    async with AsyncSessionLocal() as db:
        await v2.init(db)

        # ── Wipe transactional data (admin/mla/login/department_accounts kept) ──
        print("[wipe] clearing transactional tables…")
        for tbl in ("activity", "ticket_attachments", "ticket", "grievance_summary_records",
                    "attachments", "ai_uploads", "appointment", "citizens",
                    "referral_bookings", "referral_slots", "referral_availability",
                    "slots", "availability", "otp_verification", "gatekeeper", "qr_logs"):
            await db.execute(text(f"DELETE FROM {tbl}"))
        await db.commit()

        today = date.today()
        now = datetime.utcnow()

        # ── Availability + slots: today, tomorrow, day after ────────────────────
        print("[seed] availability + slots…")
        slots_by_day: dict[date, list] = {}
        for offset in (0, 1, 2):
            d = today + timedelta(days=offset)
            avail = sm.MLADailyAvailability(mla_id=1, date=d, is_open=True)
            db.add(avail)
            await db.flush()
            day_slots = []
            cur = datetime.combine(d, time(8, 0))
            end = datetime.combine(d, time(18, 0))
            n = 1
            while cur < end:
                slot_end = cur + timedelta(minutes=30)
                # Open a generous 10:00–17:00 window so the picker looks alive.
                in_window = time(10, 0) <= cur.time() < time(17, 0)
                s = sm.AppointmentSlot(
                    availability_id=avail.id, slot_number=n,
                    start_time=cur.time(), end_time=slot_end.time(),
                    status="AVAILABLE" if in_window else "BLOCKED",
                    max_capacity=12, booked_count=0,
                )
                db.add(s)
                day_slots.append(s)
                cur = slot_end
                n += 1
            await db.flush()
            slots_by_day[d] = day_slots

        def bookable(d: date):
            return [s for s in slots_by_day[d] if s.status == "AVAILABLE"]

        # ── Citizens ─────────────────────────────────────────────────────────────
        print("[seed] citizens…")
        citizens = []
        for name_en, _name_ta, mobile in CITIZENS:
            c = am.Citizen(
                encrypted_name=crypto.encrypt(name_en),
                encrypted_mobile=crypto.encrypt(mobile),
                mobile_index=crypto.blind_index(mobile),
                created_at=now - timedelta(days=random.randint(0, 12)),
            )
            db.add(c)
            citizens.append(c)
        await db.flush()

        # ── Appointments ─────────────────────────────────────────────────────────
        # (idx, status, schedule_meeting, day_offset or None, grievance idx or None)
        plan = [
            # Today's floor board: 4 scheduled, 1 arrived, 1 no-show, 1 courtesy done
            (0,  "SCHEDULED",       True,  0, 0),
            (1,  "SCHEDULED",       True,  0, 1),
            (2,  "SCHEDULED",       True,  0, 2),
            (3,  "SCHEDULED",       True,  0, 3),
            (4,  "AWAITING_REVIEW", True,  0, 4),    # came → moved off floor into review
            (5,  "NOT_CAME",        True,  0, 5),
            (6,  "COURTESY_DONE",   True,  0, None), # invitation — no AI summary
            # Upcoming meetings
            (7,  "SCHEDULED",       True,  1, 6),
            (8,  "SCHEDULED",       True,  2, 7),
            # Waiting queue (meeting intent, no slot)
            (9,  "WAITING",         True,  None, 8),
            (10, "WAITING",         True,  None, 0),
            (11, "RESCHEDULED",     True,  None, 1),
            # Direct petitions
            (12, "AWAITING_REVIEW", False, None, 2),
            (13, "AWAITING_REVIEW", False, None, 3),
            (14, "AWAITING_REVIEW", False, None, 4),
            (15, "REVIEWED",        False, None, 5),
            (16, "REVIEWED",        False, None, 6),
            (17, "REVIEWED",        False, None, 7),
        ]

        print("[seed] appointments + summaries…")
        seq = 0
        appts: list = []
        queue_pos = 0
        for idx, status, meeting, day_off, g_idx in plan:
            seq += 1
            name_en, name_ta, _mobile = CITIZENS[idx]
            is_courtesy = g_idx is None
            g = GRIEVANCES[g_idx] if g_idx is not None else None
            category = "invitation" if is_courtesy else g[0]
            created = now - timedelta(days=random.randint(0, 6), hours=random.randint(1, 9))

            ids = v2.new_appointment_ids(status=status, category=category)
            a = am.Appointment(
                citizen_id=citizens[idx].id,
                slot_id=None,
                schedule_meeting=meeting,
                token_assigned=_tok(today, seq),
                encrypted_grievance=None if is_courtesy else crypto.encrypt(
                    g[3].replace("• ", "").replace("\n", " ")),
                encrypted_name_ta=crypto.encrypt(name_ta),
                grievance_category=category,
                status=status,
                status_id=ids["status_id"],
                priority_id=ids["priority_id"],
                category_id=ids.get("category_id"),
                venue_id=random.choice(VENUES),
                num_persons=random.randint(1, 3),
                summary_status="DONE",
                created_at=created,
            )
            # Courtesy voice note transcript
            if is_courtesy:
                a.encrypted_transcript = crypto.encrypt(
                    "எங்கள் திருமண விழாவிற்கு அமைச்சர் அவர்களை அழைக்க வந்தேன். "
                    "ஜூலை 20 அன்று மண்டபத்தில் நடைபெறுகிறது.")
                a.transcript_status = "DONE"
            db.add(a)
            await db.flush()

            # Book a slot for dated meetings (SCHEDULED / today's arrivals & no-shows)
            if day_off is not None:
                d = today + timedelta(days=day_off)
                slot = random.choice([s for s in bookable(d) if s.booked_count < s.max_capacity])
                slot.booked_count += 1
                a.slot_id = slot.id
            if status == "WAITING":
                queue_pos += 1
                a.queue_position = queue_pos
                a.waiting_since = now - timedelta(hours=random.randint(2, 30))

            # AI summary (skip courtesy)
            if g is not None:
                db.add(gsrm.GrievanceSummaryRecord(
                    appointment_id=a.id, is_latest=True,
                    priority=g[2], category=g[0], ministry=g[1],
                    name_en=name_en, name_ta=name_ta,
                    summary=g[3], citizen_ask=g[4],
                    key_details=[b.lstrip("• ") for b in g[3].split("\n")],
                    summary_ta=g[5], citizen_ask_ta=g[6],
                    key_details_ta=[b.lstrip("• ") for b in g[5].split("\n")],
                    gemini_model_used="gemini-2.5-flash",
                    gemini_latency_ms=random.randint(2400, 6800),
                    created_at=created + timedelta(seconds=40),
                ))
                db.add(act.Activity(
                    appointment_id=a.id, user="system", action_type="ai_summarised",
                    message=f"AI summarised — urgency={g[2]}, category={g[0]}",
                    payload={"urgency": g[2], "category": g[0], "ministry": g[1]},
                    created_at=created + timedelta(seconds=45),
                ))
            appts.append(a)
        await db.flush()

        # ── Tickets for the REVIEWED petitions (through the dept workflow) ──────
        print("[seed] tickets + department workflow…")
        reviewed = [a for a in appts if a.status == "REVIEWED"]
        year = today.year
        # (school_dept or None→external forward, status, progress)
        ticket_plan = [
            ("elementary_education", "in_progress", 40),
            ("govt_examination",     "resolved",    100),
            (None,                   "forwarded_to_dept", 0),   # non-school ministry
        ]
        for i, (a, (dept, tstatus, progress)) in enumerate(zip(reviewed, ticket_plan), start=1):
            g = GRIEVANCES[plan[appts.index(a)][4]]
            t_ids = v2.new_ticket_ids(status="open")
            suggested = {"critical": "P0", "high": "P1", "medium": "P2", "low": "P3"}[g[2]]
            t = tm.Ticket(
                appointment_id=a.id,
                ticket_number=f"TKT-{year}-{i:05d}",
                status=tstatus,
                status_id=v2.ticket_status_id_or_none(tstatus) or t_ids["status_id"],
                priority=suggested,
                priority_id=v2.priority_id_or_none(suggested),
                department=dept,
                accepted_at=(now - timedelta(hours=20)) if dept and tstatus != "assigned" else None,
                accepted_by=dept if dept and tstatus != "assigned" else None,
                progress_pct=progress,
                forwarded_to_dept=None if dept else g[1],
                forwarded_at=None if dept else now - timedelta(hours=30),
                forwarded_by=None if dept else "pa_admin",
                forwarded_notes=None if dept else "Non-school ministry — forwarded from petition review.",
                resolution_notes="Hall ticket re-issued and exam centre corrected." if tstatus == "resolved" else None,
                resolved_at=(now - timedelta(hours=4)) if tstatus == "resolved" else None,
                created_at=now - timedelta(days=2),
                updated_at=now - timedelta(hours=4),
            )
            db.add(t)
            await db.flush()
            db.add(act.Activity(ticket_id=t.id, user="pa_admin", action_type="created",
                                message=f"Ticket created after PA review (token {a.token_assigned})",
                                payload={"token": a.token_assigned},
                                created_at=now - timedelta(days=2)))
            if dept:
                db.add(act.Activity(ticket_id=t.id, user="pa_admin", action_type="routed_to_department",
                                    message=None, payload={"from": None, "to": dept},
                                    created_at=now - timedelta(days=1, hours=8)))
                db.add(act.Activity(ticket_id=t.id, user=dept, action_type="department_accepted",
                                    created_at=now - timedelta(hours=20)))
                if progress:
                    db.add(act.Activity(ticket_id=t.id, user=dept, action_type="progress_update",
                                        message="Field verification completed; report drafted.",
                                        payload={"progress_pct": progress},
                                        created_at=now - timedelta(hours=8)))
                if tstatus == "resolved":
                    db.add(act.Activity(ticket_id=t.id, user=dept, action_type="resolved",
                                        message="Hall ticket re-issued and exam centre corrected.",
                                        created_at=now - timedelta(hours=4)))
            else:
                db.add(act.Activity(ticket_id=t.id, user="pa_admin", action_type="forwarded_to_dept",
                                    message="Non-school ministry — forwarded from petition review.",
                                    payload={"ministry": g[1]},
                                    created_at=now - timedelta(hours=30)))

        # Status-change breadcrumbs for a few appointments
        for a in appts[:4]:
            db.add(act.Activity(appointment_id=a.id, user="pa_admin", action_type="status_changed",
                                payload={"from": "AWAITING_REVIEW", "to": a.status},
                                created_at=now - timedelta(hours=random.randint(1, 40))))

        # ── Referral flow (today, 11:00–13:00, 4 half-hour slots) ────────────────
        print("[seed] referrals…")
        ravail = rm.ReferralAvailability(date=today, start_time=time(11, 0), end_time=time(13, 0),
                                         status="ACTIVE", created_by="pa_admin")
        db.add(ravail)
        await db.flush()
        rslots = []
        cur = datetime.combine(today, time(11, 0))
        for n in range(1, 5):
            s = rm.ReferralSlot(availability_id=ravail.id, slot_number=n,
                                start_time=cur.time(), end_time=(cur + timedelta(minutes=30)).time(),
                                status="AVAILABLE", max_capacity=6, booked_count=0)
            db.add(s)
            rslots.append(s)
            cur += timedelta(minutes=30)
        await db.flush()
        referrers = ["MLA Pallavaram", "District Secretary", "Union Chairman", "Councillor Ward 12", "MP Office"]
        rstatus = ["PENDING", "PENDING", "CAME", "PENDING", "NOT_CAME"]
        for i in range(5):
            slot = rslots[i % len(rslots)]
            slot.booked_count += 1
            name_en, _t, mobile = CITIZENS[10 + i]
            db.add(rm.ReferralBooking(
                slot_id=slot.id, token_number=_tok(today, 500 + i),
                name=crypto.encrypt(name_en), mobile=crypto.encrypt(mobile),
                num_persons=random.randint(1, 3), referred_by=referrers[i],
                reason="Requesting personal meeting regarding local school infrastructure works.",
                status=rstatus[i], scheduled_date=today,
                scheduled_start_time=slot.start_time, scheduled_end_time=slot.end_time,
            ))

        # ── AI uploads (bulk scan inbox) ─────────────────────────────────────────
        print("[seed] ai_uploads…")
        batch = "demo1234deadbeef"
        up_rows = [
            ("petition_scan_001.jpg", "AWAITING_REVIEW", "Ravi Chandran", "ரவி சந்திரன்", "9840022001", "pension_requests", "high"),
            ("petition_scan_002.jpg", "AWAITING_REVIEW", "Selvi Mari",    "செல்வி மாரி",   "9840022002", "school_admission", "medium"),
            ("petition_scan_003.pdf", "FAILED",          None, None, None, None, None),
        ]
        for fname, status_u, nm, nm_ta, mob, cat, prio in up_rows:
            db.add(aim.AiUpload(
                batch_id=batch, original_filename=fname,
                storage_url=f"ai_uploads/{batch}/{fname}",
                mime_type="application/pdf" if fname.endswith(".pdf") else "image/jpeg",
                status=status_u,
                extracted_name=nm, extracted_name_ta=nm_ta, extracted_mobile=mob,
                grievance_category=cat, priority=prio,
                summary_json={"summary": "Scanned petition (demo row)"} if nm else None,
                error_message=None if nm else "Gemini extraction timed out (demo).",
                created_at=now - timedelta(hours=5),
                processed_at=now - timedelta(hours=4),
            ))

        await db.commit()
        print("[done] demo data seeded.")

        # ── Report ───────────────────────────────────────────────────────────────
        for tbl in ("citizens", "appointment", "grievance_summary_records", "ticket",
                    "activity", "availability", "slots", "referral_bookings", "ai_uploads"):
            n = (await db.execute(text(f"SELECT count(*) FROM {tbl}"))).scalar()
            print(f"        {tbl:28s} {n}")


if __name__ == "__main__":
    asyncio.run(main())
