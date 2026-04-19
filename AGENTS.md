# Project: l-meet-booking-pro

## Overview
This is a production-ready booking system with Google Calendar integration.

The system supports:
- Booking creation
- Rescheduling
- Cancellation
- Calendar synchronization
- Retry mechanism (sync_jobs)
- Admin monitoring dashboard

---

## Core Architecture

### Booking Flow

1. User selects:
   - Service
   - Lessons
   - Date
   - Time

2. System calculates:
   - Required slots
   - Occupied slots
   - Available time

3. Booking is created in Firestore

4. System attempts to create Google Calendar event

5. If Calendar fails:
   - A sync_job is created
   - Can be retried later

---

## Google Calendar Integration

### Credential Strategy (IMPORTANT)

The system uses:

1. Firestore (PRIMARY)
   - Collection: system_config
   - Document: google_oauth

2. Environment variables (FALLBACK)

Priority:
Firestore → Env → Error

---

### OAuth Flow

- Route: /api/auth/google
- Callback: /api/auth/callback

Behavior:
- On success:
  - Extract refresh_token
  - Store in Firestore (system_config/google_oauth)
- If no refresh_token:
  - Return error (do not silently succeed)

---

## Calendar API Layer

All routes use unified credential logic via:

createGoogleCalendarClient()

Routes:

- /api/calendar/busy
- /api/calendar/create-booking-event
- /api/calendar/update-event
- /api/calendar/delete-event
- /api/calendar/test

---

## Sync Jobs (Recovery System)

Collection: sync_jobs

States:
- pending
- resolved
- dismissed

Used when:
- Calendar operations fail

Admin can:
- Retry
- Dismiss

---

## Admin System

### Route
/admin

### Features

- Booking management
- Sync job management
- Google OAuth status panel

---

## OAuth Status Panel

Displays:

- Connection status
- Credential source (Firestore / Env)
- Refresh token existence
- Last updated time
- Reauth required
- Pending sync jobs

---

## Development Rules

### Commit Flow

Use Skill:

$commit-check

Rules:
- Never use git add .
- Always run build before commit
- Separate new errors from existing ones
- Require confirmation before commit and push

---

### Testing Flow (CRITICAL)

Always verify:

1. /api/calendar/busy
2. Create booking
3. Reschedule booking
4. Cancel booking

---

## Environment

### Required ENV (fallback only)

- GOOGLE_CLIENT_ID
- GOOGLE_CLIENT_SECRET
- GOOGLE_REDIRECT_URI
- GOOGLE_REFRESH_TOKEN
- GOOGLE_CALENDAR_ID

---

## Deployment

Platform: Vercel

Main project:
l-meet-booking-pro-92f7

---

## Key Principle

This system prioritizes:

- Stability over speed
- Recoverability over perfection
- Clear state visibility (admin panel)
- Minimal risk changes

---

## Skill Routing

Use these skills by default when the task matches:

- $commit-check
  - Use for commit preparation, staged file review, build/lint verification, and push confirmation.

- $booking-check
  - Use for booking-related regression verification:
    /api/calendar/busy, create booking, reschedule booking, cancel booking.

- $admin-check
  - Use for admin-related regression verification:
    /admin, OAuth status panel, sync jobs, retry/dismiss, reauthorization entry.