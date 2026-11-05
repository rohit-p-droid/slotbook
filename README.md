# Slotbook 🗓️

> **Production-grade appointment booking engine on PostgreSQL 15+ and TypeScript.**
> Hosts publish when they are free, guests book slots with 5-minute temporary holds, and **nobody is ever double-booked** — even under high concurrency, clock drift, or network timeouts.

---

## ⚡ Quickstart (One-Command Run)

### Option 1: Docker Compose (All-in-One)
```bash
docker compose up --build
```
This single command spins up PostgreSQL 16, runs database migrations, seeds the demo host (`Alex Rivers`) with two event types, and starts the Next.js web application at [http://localhost:3000](http://localhost:3000).

### Option 2: Local Development with Compose Postgres
1. Start PostgreSQL:
   ```bash
   docker compose up -d postgres
   ```
2. Install dependencies & initialize database:
   ```bash
   pnpm install
   pnpm run db:setup    # Runs migrations and seeds demo data
   ```
3. Start the dev server:
   ```bash
   pnpm dev
   ```
4. Access the web app at [http://localhost:3000](http://localhost:3000).

---

## 🧪 Running Automated Tests

All tests run against a real PostgreSQL database with one command:
```bash
pnpm test
```

### Specific Concurrency Test
```bash
pnpm test:concurrency
```
**What this proves**: 50 concurrent requests simultaneously fight for the exact same 1-on-1 slot. Exactly **1** succeeds with `201 Created`, the remaining **49** are cleanly rejected with `409 Conflict`, and database integrity proves zero double-booking.

---

## 🧭 60-Second Tour of the UI

1. **Root Landing & Switcher** ([`http://localhost:3000`](http://localhost:3000)):
   - Highlights seeded host **Alex Rivers** (`@alex`).
   - Quick jump to the two demo events (1-on-1 Quick Chat & Group Tech Workshop) and Host Dashboard.

2. **Public Guest Booking Flow** ([`http://localhost:3000/alex/quick-chat`](http://localhost:3000/alex/quick-chat)):
   - **Timezone Switcher**: Detects the browser's IANA timezone and converts all host windows seamlessly.
   - **30-Day Calendar & Slot Selector**: Displays available slots with real-time capacity and remaining spots.
   - **5-Minute Temporary Hold**: Selecting a slot acquires an exclusive hold with a live countdown timer.
   - **Confirmation**: Entering guest name & email confirms the booking, sends an event to the transactional outbox, and generates a private management link with an RFC 5545 `.ics` download button.

3. **Guest Management Surface** ([`http://localhost:3000/manage/{booking_token}`](http://localhost:3000)):
   - Guests can view booking status, download calendar `.ics` invites, reschedule to any newly available slot, or cancel with a reason.

4. **Host Dashboard** ([`http://localhost:3000/dashboard`](http://localhost:3000/dashboard)):
   - **Home Timezone**: Change host home IANA timezone with one click.
   - **Upcoming Bookings**: View active holds, confirmed reservations, and cancelled bookings. Cancel any booking with a recorded reason.
   - **Event Types Manager** ([`/dashboard/events`](http://localhost:3000/dashboard/events)): Create and edit event types (duration 15–120m, capacity, buffers before/after 0–30m, minimum notice, horizon).
   - **Availability & Date Overrides** ([`/dashboard/availability`](http://localhost:3000/dashboard/availability)): Configure weekly recurring windows (multiple windows per day supported, e.g. 09:00–12:00 and 13:00–17:00) and date overrides (days off or custom hours).

5. **Embeddable Widget Preview** ([`http://localhost:3000/alex/quick-chat/embed`](http://localhost:3000/alex/quick-chat/embed)):
   - Clean, borderless iframe-ready embed view for third-party websites.

---

## 📡 REST API Reference

All endpoints return JSON and include structured `x-request-id` headers.

### 1. Get Available Slots
```http
GET /api/hosts/{host}/events/{slug}/slots?from={from}&to={to}&tz={tz}
```
**Query Parameters**:
- `from` *(optional)*: ISO 8601 start timestamp.
- `to` *(optional)*: ISO 8601 end timestamp.
- `tz` *(optional, default: UTC)*: Guest's target IANA timezone (e.g. `America/New_York`, `Asia/Kolkata`).

**Response (`200 OK`)**:
```json
{
  "host": { "id": "...", "name": "Alex Rivers", "slug": "alex", "timezone": "America/New_York" },
  "event": { "title": "30-min Quick Chat", "slug": "quick-chat", "duration_minutes": 30, "capacity": 1 },
  "timezone": "Asia/Kolkata",
  "slots": [
    {
      "slot_start": "2026-11-18T14:00:00.000Z",
      "slot_end": "2026-11-18T14:30:00.000Z",
      "local_date": "2026-11-18",
      "local_start": "19:30",
      "local_end": "20:00",
      "capacity": 1,
      "spots_remaining": 1,
      "is_available": true
    }
  ]
}
```

---

### 2. Place a Temporary Hold (5 Minutes)
```http
POST /api/holds
Idempotency-Key: {unique-uuid}
Content-Type: application/json

{
  "host_slug": "alex",
  "event_slug": "quick-chat",
  "slot_start": "2026-11-18T14:00:00.000Z",
  "slot_end": "2026-11-18T14:30:00.000Z"
}
```
**Response (`201 Created`)**:
```json
{
  "id": "e2c36294-...",
  "hold_token": "hold_a91b4...",
  "status": "held",
  "slot_start": "2026-11-18T14:00:00.000Z",
  "slot_end": "2026-11-18T14:30:00.000Z",
  "hold_expires_at": "2026-11-18T14:05:00.000Z"
}
```

---

### 3. Confirm Hold with Guest Details
```http
POST /api/holds/{id}/confirm
Content-Type: application/json

{
  "guest_name": "Sarah Connor",
  "guest_email": "sarah@example.com",
  "guest_notes": "Project review"
}
```
**Response (`200 OK`)**:
```json
{
  "id": "e2c36294-...",
  "status": "confirmed",
  "booking_token": "bk_78f14...",
  "manage_url": "/manage/bk_78f14...",
  "slot_start": "2026-11-18T14:00:00.000Z",
  "slot_end": "2026-11-18T14:30:00.000Z",
  "confirmed_at": "2026-11-05T20:30:00.000Z"
}
```

---

### 4. Reschedule Booking
```http
POST /api/bookings/{token}/reschedule
Content-Type: application/json

{
  "new_slot_start": "2026-11-19T15:00:00.000Z",
  "new_slot_end": "2026-11-19T15:30:00.000Z"
}
```

---

### 5. Cancel Booking
```http
POST /api/bookings/{token}/cancel
Content-Type: application/json

{
  "reason": "Family emergency"
}
```

---

### 6. Download Calendar Invite (.ics)
```http
GET /api/bookings/{token}/ics
```
Returns an RFC 5545 formatted `.ics` calendar file attachment with `METHOD:REQUEST` (or `METHOD:CANCEL` when cancelled).

---

### 7. Observability & Health
- `GET /api/health`: Database connection status, query latency in ms, connection pool statistics.
- `GET /api/metrics`: Counts of bookings by status, active holds, stale uncleaned holds, and transactional outbox lag.

---

## 🎁 Optional Extensions Implemented

1. **Calendar Invites (.ics)**: Native RFC 5545 iCalendar generator for confirmations, reschedules, and cancellations.
2. **Scheduled Reminders**: Automatic 24-hour and 1-hour pre-event reminder records scheduled in the outbox.
3. **Date Overrides & Custom Hours**: Host-defined days off or custom operating hours on specific dates.
4. **Embeddable Widget**: Responsive widget view at `/{host}/{event-slug}/embed`.
5. **Observability & Request Tracing**: Structured JSON logging with `x-request-id` tracing, `/api/health`, and `/api/metrics`.
6. **Abuse Protection & Rate Limiting**: In-memory IP-based rate limiting on slot queries and hold creation.
7. **Load Testing**: Pre-configured k6 script in `tests/load/k6-booking-load.js`.
8. **Waitlist Pipeline**: Schema and atomic cancellation trigger for waiting guests.

---

## 🏗️ Architecture & Correctness Philosophy

- **Postgres as Single Source of Truth**: All concurrency coordination is enforced directly inside PostgreSQL transactions via `pg_advisory_xact_lock` and row locks.
- **Transactional Outbox**: Booking mutations and event notifications are written atomically in the exact same database transaction, eliminating phantom emails.
- **Idempotency Guarantees**: Network retries carrying the same `Idempotency-Key` return identical cached results without double-allocating slot capacity.
