# MLA Scheduling System - Deployment Guide

## Overview

This guide covers the deployment of the MLA scheduling system with queue management, time window selection, and auto-scheduling features.

## Prerequisites

- PostgreSQL database configured
- Python 3.9+ with virtual environment activated
- All environment variables set in `.env`

## Step 1: Install Dependencies

```bash
cd backend
pip install -r requirements.txt
```

This will install:
- `alembic>=1.13.0` - Database migrations
- All existing dependencies

## Step 2: Run Database Migration

```bash
# Apply the scheduling tables migration
alembic upgrade head
```

This creates:
- `mlas` - MLA profiles
- `mla_daily_availability` - Daily availability records
- `time_windows` - 30-minute windows for citizen selection
- `appointment_slots` - Individual 5-minute slots
- `reschedule_logs` - Audit trail
- Adds 8 new columns to `appointments` table

## Step 3: Seed Initial MLA Data (Optional)

Create a seed script or manually insert MLA records:

```sql
INSERT INTO mlas (name, constituency, contact_mobile, contact_email, office_address, is_active)
VALUES 
('John Smith', 'North District', '9876543210', 'john@example.com', '123 Main St', true),
('Jane Doe', 'South District', '9876543211', 'jane@example.com', '456 Oak Ave', true);
```

## Step 4: Verify Installation

```bash
# Start the server
python -m uvicorn src.main:app --reload --host 0.0.0.0 --port 8000
```

Visit:
- API Docs: http://localhost:8000/api/docs
- Health Check: http://localhost:8000/health

## Step 5: Test the System

### A. Admin Sets MLA Availability

**Endpoint:** `POST /api/v1/scheduling/admin/set-availability`

**Request:**
```json
{
  "mla_id": 1,
  "date": "2026-06-21",
  "start_time": "16:00:00",
  "end_time": "18:00:00",
  "slot_duration_minutes": 5,
  "window_duration_minutes": 30
}
```

**Response:**
```json
{
  "availability_id": 1,
  "date": "21 Jun 2026",
  "time_range": "04:00 PM - 06:00 PM",
  "total_slots": 24,
  "scheduled_from_queue": 0,
  "remaining_in_queue": 0,
  "message": "Created 24 slots. Scheduled 0 waiting appointments. 0 still waiting."
}
```

### B. Citizen Checks Availability

**Endpoint:** `GET /api/v1/scheduling/time-windows/available`

**Response:**
```json
{
  "available": true,
  "total_slots": 24,
  "booked_slots": 0,
  "remaining_slots": 24,
  "windows": [
    {
      "id": 1,
      "label": "4:00 PM - 4:30 PM",
      "start": "16:00",
      "end": "16:30",
      "available_slots": 6,
      "total_slots": 6
    },
    ...
  ]
}
```

### C. Citizen Submits Form with Meeting Request

1. Scan QR code
2. Fill form
3. Check "I need to visit MLA"
4. Select time window
5. Submit

The system will:
- If slots available → Auto-assign next slot in selected window
- If slots full → Move to waiting queue
- If no availability → Move to waiting queue

### D. Check Waiting Queue

**Endpoint:** `GET /api/v1/scheduling/admin/waiting-queue`

**Response:**
```json
[
  {
    "id": 123,
    "token": 45,
    "name": "John Doe",
    "mobile": "9876543210",
    "category": "HEALTH",
    "queue_position": 1,
    "waiting_since": "2026-06-20 10:30",
    "priority_score": 10,
    "created_at": "2026-06-20 10:30"
  }
]
```

## Step 6: Dashboard Access

### Create Dashboard Scheduling Page

The dashboard will have a new "Scheduling" menu item with:

1. **Set MLA Availability** - Form to set daily availability
2. **Waiting Queue** - View and manage waiting appointments
3. **Today's Schedule** - View today's booked slots
4. **Statistics** - Waiting count, scheduled today, oldest waiting

Access: http://localhost:8000/dashboard/scheduling

## System Architecture

### Database Schema

```
mlas
├─ id (PK)
├─ name
├─ constituency
├─ contact_mobile
├─ contact_email
├─ office_address
├─ is_active
└─ created_at

mla_daily_availability
├─ id (PK)
├─ mla_id (FK → mlas)
├─ date
├─ start_time
├─ end_time
├─ slot_duration_minutes (default 5)
├─ total_slots
├─ booked_slots
├─ status
├─ created_at
└─ created_by

time_windows
├─ id (PK)
├─ availability_id (FK → mla_daily_availability)
├─ window_start
├─ window_end
├─ window_label
├─ total_slots_in_window
├─ available_slots
└─ is_available

appointment_slots
├─ id (PK)
├─ availability_id (FK → mla_daily_availability)
├─ appointment_id (FK → appointments)
├─ slot_number
├─ start_time
├─ end_time
├─ status
└─ created_at

appointments (new columns)
├─ scheduled_date
├─ scheduled_start_time
├─ scheduled_end_time
├─ appointment_slot_id (FK → appointment_slots)
├─ preferred_window_id (FK → time_windows)
├─ queue_position
├─ waiting_since
└─ priority_score
```

### Workflow

1. **MLA Sets Availability**
   - Admin enters: Date, Start Time, End Time
   - System generates: 24 slots (5 min each) + 4 windows (30 min each)
   - Auto-schedules waiting queue (priority: oldest first)

2. **Citizen Submits Form**
   - Checks "I need to visit MLA"
   - System checks availability:
     - **Available** → Shows time windows → Citizen selects → Auto-assigned to next slot
     - **Full** → Moved to waiting queue
     - **No availability** → Moved to waiting queue

3. **Queue Processing**
   - When MLA sets new availability → Auto-schedule waiting (FIFO)
   - Priority score increases daily for older appointments
   - SMS notifications sent automatically

## Capacity Management

- **Total Slots:** Calculated from time range and slot duration
  - Example: 2 hours (120 min) ÷ 5 min = 24 slots
- **Capacity Limit:** Appointments 1-24 scheduled, 25+ go to waiting
- **Time Windows:** 30-minute groups for citizen selection
  - Example: 4:00-4:30, 4:30-5:00, 5:00-5:30, 5:30-6:00

## SMS Notifications

The system sends SMS for:
1. **Scheduled** - "Your meeting is scheduled for [date] at [time]"
2. **Waiting** - "You are in queue (position X). Will notify when scheduled"
3. **Status Update** - When admin changes status

## Troubleshooting

### Migration Fails

```bash
# Check current version
alembic current

# Rollback one version
alembic downgrade -1

# Re-apply
alembic upgrade head
```

### No Time Windows Showing

Check:
1. MLA has set availability for today
2. Availability status is 'ACTIVE'
3. Not all slots are booked

```sql
SELECT * FROM mla_daily_availability WHERE date = CURRENT_DATE;
SELECT * FROM time_windows WHERE availability_id = X;
```

### Queue Not Auto-Scheduling

Check:
1. Appointments have `status = 'WAITING'`
2. `schedule_meeting = true`
3. Availability has slots available

```sql
SELECT * FROM appointments WHERE status = 'WAITING' AND schedule_meeting = true;
```

## Production Checklist

- [ ] Run `alembic upgrade head`
- [ ] Seed MLA data
- [ ] Test availability setting
- [ ] Test citizen form submission
- [ ] Test queue auto-scheduling
- [ ] Verify SMS notifications
- [ ] Set up daily cron job for priority score updates
- [ ] Monitor database performance (add indexes if needed)
- [ ] Set up backup for new tables

## Maintenance

### Daily Priority Score Update (Optional)

Create a cron job to update priority scores:

```python
# scripts/update_priority_scores.py
import asyncio
from datetime import datetime
from sqlalchemy import select
from src.core.database import get_db_session
from src.models.appointment_models import Appointment

async def update_priority_scores():
    async with get_db_session() as db:
        result = await db.execute(
            select(Appointment).where(Appointment.status == 'WAITING')
        )
        waiting = result.scalars().all()
        
        for appt in waiting:
            if appt.waiting_since:
                days = (datetime.utcnow() - appt.waiting_since).days
                appt.priority_score = days * 10
        
        await db.commit()
        print(f"Updated {len(waiting)} waiting appointments")

if __name__ == "__main__":
    asyncio.run(update_priority_scores())
```

Run daily:
```bash
0 0 * * * cd /path/to/backend && python scripts/update_priority_scores.py
```

## Support

For issues or questions, check:
- API Documentation: http://localhost:8000/api/docs
- Alembic README: `backend/alembic/README`
- Database logs: Check PostgreSQL logs for errors
