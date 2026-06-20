# MLA Scheduling System - Quick Start Guide

## 🚀 Get Started in 3 Steps

### Step 1: Install & Migrate (2 minutes)

```bash
cd backend

# Activate virtual environment (if not already)
./env/Scripts/Activate  # Windows
# source env/bin/activate  # Linux/Mac

# Install new dependency (Alembic)
pip install -r requirements.txt

# Run database migration
alembic upgrade head
```

**Expected Output:**
```
INFO  [alembic.runtime.migration] Running upgrade  -> 001, add_scheduling_tables
```

### Step 2: Seed MLA Data (1 minute)

Open PostgreSQL and run:

```sql
-- Add your MLA
INSERT INTO mlas (name, constituency, contact_mobile, is_active)
VALUES ('Your MLA Name', 'Your Constituency', '9876543210', true);

-- Verify
SELECT * FROM mlas;
```

### Step 3: Start Server & Test (2 minutes)

```bash
# Start server
python -m uvicorn src.main:app --reload --host 0.0.0.0 --port 8000
```

**Test the API:**

Visit http://localhost:8000/api/docs and try:

1. **Set MLA Availability** (POST `/api/v1/scheduling/admin/set-availability`)
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
   
   **Response:** Creates 24 slots (5-min each) and 4 windows (30-min each)

2. **Check Availability** (GET `/api/v1/scheduling/time-windows/available`)
   
   **Response:** Shows available time windows for citizens

3. **Test Citizen Form**
   - Visit: http://localhost:8000/qr/generate?venue_id=1
   - Fill form
   - Check "I need to visit MLA"
   - Select time window
   - Submit

## 📋 What Was Implemented?

### Database (5 New Tables)
- ✅ `mlas` - MLA profiles
- ✅ `mla_daily_availability` - Daily schedules
- ✅ `time_windows` - 30-min windows
- ✅ `appointment_slots` - 5-min slots
- ✅ `reschedule_logs` - Audit trail

### API (7 New Endpoints)
- ✅ Get available time windows (citizen)
- ✅ Set MLA availability (admin)
- ✅ View waiting queue (admin)
- ✅ List MLAs (admin)
- ✅ Today's schedule (admin)
- ✅ Statistics (admin)

### UI (Citizen Form)
- ✅ "I need to visit MLA" checkbox
- ✅ Time window selection
- ✅ Real-time availability checking
- ✅ Capacity status display

### Features
- ✅ Auto-scheduling from waiting queue
- ✅ Priority-based queue (FIFO)
- ✅ SMS notifications
- ✅ Capacity management (24 slots max)

## 🎯 How It Works

### Flow 1: Slots Available

```
1. Admin sets availability (4 PM - 6 PM)
   → System creates 24 slots

2. Citizen submits form
   → Checks "I need to visit MLA"
   → Sees 4 time windows
   → Selects "4:30 PM - 5:00 PM"
   → Submits

3. System auto-assigns
   → Next available slot: 4:00 PM - 4:05 PM
   → Status: SCHEDULED
   → SMS: "Meeting scheduled for [date] at 4:00 PM"
```

### Flow 2: Slots Full

```
1. All 24 slots are booked

2. Citizen submits form (25th person)
   → Checks "I need to visit MLA"
   → Sees "All slots full" message
   → Submits anyway

3. System moves to queue
   → Status: WAITING
   → Queue position: 1
   → SMS: "You are in queue (position 1)"

4. Next day, admin sets new availability
   → System auto-schedules from queue
   → SMS: "Meeting scheduled for [date] at [time]"
```

## 🔍 Verify Installation

### Check Database Tables

```sql
-- Should return 5 rows
SELECT tablename FROM pg_tables 
WHERE schemaname = 'public' 
AND tablename IN ('mlas', 'mla_daily_availability', 'time_windows', 'appointment_slots', 'reschedule_logs');

-- Check appointments table has new columns
SELECT column_name FROM information_schema.columns 
WHERE table_name = 'appointments' 
AND column_name IN ('scheduled_date', 'scheduled_start_time', 'queue_position', 'priority_score');
```

### Check API Endpoints

Visit http://localhost:8000/api/docs

Look for:
- `/api/v1/scheduling/time-windows/available`
- `/api/v1/scheduling/admin/set-availability`
- `/api/v1/scheduling/admin/waiting-queue`

### Check Citizen Form

1. Generate QR: http://localhost:8000/qr/generate?venue_id=1
2. Scan QR or click link
3. Look for "I need to visit MLA" checkbox
4. Check the checkbox
5. Should see "Checking availability..." message

## 📊 Admin Dashboard (Next Step)

The API is ready, but you may want to create dashboard pages:

1. **Scheduling Page** - UI to set MLA availability
2. **Waiting Queue Page** - View/manage waiting appointments
3. **Update Appointments Page** - Show scheduled time column

These are optional - you can use the API directly via Swagger docs for now.

## 🐛 Common Issues

### Issue: Migration fails with "relation already exists"

**Solution:**
```bash
# Check current version
alembic current

# If tables already exist, mark migration as done
alembic stamp head
```

### Issue: No time windows showing in form

**Solution:**
1. Check if MLA has set availability for today:
   ```sql
   SELECT * FROM mla_daily_availability WHERE date = CURRENT_DATE;
   ```
2. If not, use API to set availability (see Step 3 above)

### Issue: Form checkbox not showing

**Solution:**
1. Clear browser cache
2. Hard refresh (Ctrl+Shift+R)
3. Check browser console for errors

## 📚 Full Documentation

- **Implementation Summary:** `IMPLEMENTATION_SUMMARY.md`
- **Deployment Guide:** `SCHEDULING_DEPLOYMENT_GUIDE.md`
- **Alembic Usage:** `alembic/README`

## ✅ Success Checklist

- [ ] Migration completed (`alembic upgrade head`)
- [ ] MLA data seeded
- [ ] Server running
- [ ] API endpoints accessible
- [ ] Citizen form shows checkbox
- [ ] Time windows load when checkbox is checked
- [ ] Form submission works
- [ ] SMS notifications sent (if APM_SMS_API_KEY is set)

## 🎉 You're Ready!

The MLA scheduling system is now fully operational. Citizens can:
- Request MLA meetings
- Select preferred time windows
- Get auto-scheduled or queued

Admins can:
- Set MLA availability
- View waiting queue
- Monitor statistics

**Next:** Test with real data and optionally create dashboard UI pages.
