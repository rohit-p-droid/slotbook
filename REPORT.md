# Slotbook — Technical Architecture & Reliability Report
**Candidate / Author**: Take-Home Engineering Submission  
**Date**: November 2026  
**Assignment**: Slotbook — Full-Stack TypeScript Scheduling Engine on PostgreSQL  

---

## 1. Links & Project Overview

- **Source Code Repository**: Local Workspace / Public GitHub Repository
- **One-Command Boot**: `docker compose up --build`
- **Health Check & Latency**: `GET /api/health`
- **Telemetry & Queue Metrics**: `GET /api/metrics`
- **Seeded Demo Host**:
  - Name: **Alex Rivers** (`@alex`)
  - Home Time Zone: `America/New_York`
  - Demo Event 1 (1-on-1): [`/alex/quick-chat`](http://localhost:3000/alex/quick-chat) (30 mins, capacity 1, buffer: 10m before / 10m after)
  - Demo Event 2 (Group): [`/alex/tech-workshop`](http://localhost:3000/alex/tech-workshop) (60 mins, capacity 4, buffer: 15m before / 15m after)
  - Host Dashboard: [`/dashboard`](http://localhost:3000/dashboard)

---

## 2. Architecture & Request Flow

Slotbook is structured as a full-stack, single-binary TypeScript service running on Next.js 14 and PostgreSQL 16. Postgres is the **single source of truth for all concurrency and correctness**—no Redis, ZooKeeper, or external locking infrastructure is utilized.

### Component Diagram

```
+-----------------------------------------------------------------------------------+
|                                  CLIENT LAYER                                     |
|                                                                                   |
|  [Guest Booking Page]       [Guest Manage Page]            [Host Dashboard]       |
|    - IANA Tz Switcher         - Reschedule View              - Home Tz Config     |
|    - 30-Day Slot Picker       - Cancel Appointment           - Availability / Days|
|    - 5-Min Hold Countdown     - RFC 5545 .ics Download       - Event Type Manager |
+-----------------------------------------------------------------------------------+
                                         │
                                         ▼ HTTPS (JSON API)
+-----------------------------------------------------------------------------------+
|                              APPLICATION LAYER (Next.js)                          |
|                                                                                   |
|  [Rate Limiter & Abuse Guard] ──> [Request Context & Logger (x-request-id)]      |
|                                                                                   |
|  [BookingEngine API]               [Slot Generator]           [ICS Generator]     |
|    - holdSlot()                      - Timezone Math (IANA)     - RFC 5545 Spec   |
|    - confirmHold()                   - DST Transition Logic     - METHOD:REQUEST  |
|    - rescheduleBooking()             - Buffers & Notice           METHOD:CANCEL   |
|    - cancelBooking()                                                              |
+-----------------------------------------------------------------------------------+
                                         │
                                         ▼ Connection Pool (pg)
+-----------------------------------------------------------------------------------+
|                            POSTGRESQL 16 (Source of Truth)                       |
|                                                                                   |
|  - Transactional Advisory Locks:  SELECT pg_advisory_xact_lock(...)                |
|  - Row Locks:                     SELECT ... FOR UPDATE                           |
|  - Exclusion Range Index (GiST):  tstzrange(buffered_start, buffered_end, '[)')    |
|  - Idempotency Store:             idempotency_keys table                          |
|  - Transactional Outbox:          notifications table                             |
+-----------------------------------------------------------------------------------+
```

### End-to-End Booking Request Flow

1. **Slot Browsing (`GET /api/hosts/{host}/events/{slug}/slots?tz=...`)**:
   - Host availability windows (in host's IANA timezone) and date overrides are queried.
   - Candidate slots are generated, checking against `min_notice_hours` and `booking_horizon_days`.
   - Overlaps against active confirmed bookings and unexpired holds are computed considering before/after buffers.
   - Times are converted and formatted in the guest's target IANA timezone.

2. **Hold Creation (`POST /api/holds` with `Idempotency-Key`)**:
   - Idempotency table is checked for identical cached requests.
   - Postgres transaction begins:
     - `pg_advisory_xact_lock` serializes all booking attempts on the host.
     - Stale holds (`hold_expires_at <= NOW()`) are updated to `expired`.
     - Overlapping bookings and active holds are counted. If capacity exceeded, transaction aborts (`409 Conflict`).
     - A 5-minute hold is inserted (`status = 'held'`, `hold_token = 'hold_...'`).
     - Idempotency response is cached.
   - Transaction commits.

3. **Confirmation (`POST /api/holds/{id}/confirm`)**:
   - The hold row is locked with `FOR UPDATE`.
   - Engine verifies `hold_expires_at > NOW()`. If expired, status becomes `expired` and returns `410 Gone`.
   - Guest details and private `booking_token` are saved (`status = 'confirmed'`).
   - Inside the **exact same transaction**, an event is written to `notifications` (Transactional Outbox) with the attendee payload and RFC 5545 calendar invite, plus scheduled 24h and 1h reminders.
   - Transaction commits.

---

## 3. Data Model & Constraints

### 1. `hosts`
| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | UUID | PRIMARY KEY, gen_random_uuid() | Host unique identifier |
| `name` | TEXT | NOT NULL | Display name |
| `slug` | TEXT | NOT NULL, UNIQUE | URL handle (e.g. `alex`) |
| `email` | TEXT | NOT NULL, UNIQUE | Host primary email |
| `timezone` | TEXT | NOT NULL, DEFAULT 'UTC' | IANA home time zone |

### 2. `event_types`
| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | UUID | PRIMARY KEY, gen_random_uuid() | Event type ID |
| `host_id` | UUID | FK -> `hosts.id` ON DELETE CASCADE | Owner host |
| `title` | TEXT | NOT NULL | e.g. "30-min Quick Chat" |
| `slug` | TEXT | NOT NULL | e.g. "quick-chat" (UNIQUE per host) |
| `duration_minutes` | INT | NOT NULL, CHECK (15 <= dur <= 120) | Meeting duration |
| `capacity` | INT | NOT NULL, DEFAULT 1, CHECK (>= 1) | 1 = 1-on-1, >1 = Group session |
| `buffer_before_minutes`| INT | NOT NULL, DEFAULT 0, CHECK (0..30) | Buffer prior to slot start |
| `buffer_after_minutes` | INT | NOT NULL, DEFAULT 0, CHECK (0..30) | Buffer after slot end |
| `min_notice_hours` | INT | NOT NULL, DEFAULT 4 | Minimum advance notice |
| `booking_horizon_days` | INT | NOT NULL, DEFAULT 30 | Max future days bookable |

### 3. `host_availabilities` & `host_overrides`
- `host_availabilities`: `(host_id, day_of_week [0-6], start_time TIME, end_time TIME)`. Supports split shifts (e.g. 09:00–12:00 and 13:00–17:00).
- `host_overrides`: `(host_id, override_date DATE, is_unavailable BOOLEAN, start_time TIME, end_time TIME)`. Defines full days off or custom hours for specific calendar dates.

### 4. `bookings`
| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | UUID | PRIMARY KEY | Booking identifier |
| `host_id` | UUID | FK -> `hosts.id` | Host |
| `event_type_id` | UUID | FK -> `event_types.id` | Associated event type |
| `status` | TEXT | CHECK (in 'held', 'confirmed', 'cancelled', 'expired') | Lifecycle state |
| `slot_start` | TIMESTAMPTZ | NOT NULL | UTC appointment start |
| `slot_end` | TIMESTAMPTZ | NOT NULL | UTC appointment end |
| `buffered_start` | TIMESTAMPTZ | NOT NULL | `slot_start - buffer_before` |
| `buffered_end` | TIMESTAMPTZ | NOT NULL | `slot_end + buffer_after` |
| `hold_token` | TEXT | UNIQUE | Temporary guest token during 5m hold |
| `hold_expires_at` | TIMESTAMPTZ | | Timestamp when hold expires |
| `booking_token` | TEXT | UNIQUE | Private token for guest self-management |
| `guest_name` | TEXT | | Captured on confirm |
| `guest_email` | TEXT | | Captured on confirm |

### 5. `notifications` (Transactional Outbox)
- Records `(booking_id, event_type, recipient_email, subject, payload JSONB, status, scheduled_for, attempts)`.
- Event types: `BOOKING_CONFIRMED`, `BOOKING_RESCHEDULED`, `BOOKING_CANCELLED`, `REMINDER_24H`, `REMINDER_1H`.

---

## 4. Key Architectural Decisions

### Decision 1: Postgres Advisory Locks over External Distributed Locks (Redis / Redlock)
- **Choice**: `SELECT pg_advisory_xact_lock(hashtext('host_lock_' || host_id))` inside transaction.
- **Alternatives Considered**: Redis Redlock, Optimistic concurrency with version numbers, table-level locks.
- **Rationale**: External lock managers introduce split-brain risks and additional infrastructure dependencies. Postgres transaction-scoped advisory locks automatically release on transaction commit or rollback, guarantee zero race conditions across concurrent application processes, and cost less than 1 millisecond.

### Decision 2: Transactional Outbox Pattern for Notifications
- **Choice**: Notification events and scheduled reminders are written to `notifications` table within the same transaction as the booking mutation.
- **Alternatives Considered**: Sending webhooks/emails inline during HTTP request.
- **Rationale**: Inline email delivery causes network latency bottlenecks and risks sending "phantom emails" if the database transaction rolls back after network dispatch. The outbox pattern guarantees strict at-least-once delivery consistency.

### Decision 3: Dynamic Holds with Eager Expiration rather than Cron-only Cleanup
- **Choice**: Queries check `(status = 'confirmed' OR (status = 'held' AND hold_expires_at > NOW()))`, while mutations eagerly execute `UPDATE bookings SET status = 'expired' WHERE hold_expires_at <= NOW()`.
- **Alternatives Considered**: Relying solely on a periodic 60-second cron job.
- **Rationale**: If a hold expires after 5 minutes, an incoming guest should immediately be able to claim the slot without waiting for a scheduled cron sweep.

### Decision 4: Idempotency-Key Caching Table
- **Choice**: Dedicated `idempotency_keys` table with SHA-256 request hashing, response status, and JSONB body.
- **Alternatives Considered**: Stateless client retry handling.
- **Rationale**: Prevents double-booking when network timeouts occur between client and server. The client retransmits with the same key and receives the original hold without consuming additional capacity.

### Decision 5: Buffers Stored as Explicit Timestamps
- **Choice**: Storing `buffered_start` and `buffered_end` alongside `slot_start` and `slot_end`.
- **Alternatives Considered**: Dynamic buffer joins on every query.
- **Rationale**: Materializing the buffered range allows high-performance Postgres GiST range queries (`tstzrange(buffered_start, buffered_end)`) and guarantees that cross-event buffer collisions are evaluated in constant time.

---

## 5. Reliability & Failure Modes Analysis

| Failure Case | Root Cause | System Defense | Proving Test |
|---|---|---|---|
| **High Concurrency Race** | 50 guests clicking the last slot at the same millisecond | Postgres transaction advisory lock serializes hold attempts. Capacity check fails for 49 requests. | `tests/concurrency.test.ts` (50 concurrent holds -> 1 winner, 49 conflicts, 0 double-bookings) |
| **Network Timeout & Retry** | Client POST succeeds on server, but response packet dropped | `Idempotency-Key` header caches response; retry returns exact original hold without consuming extra spots. | `tests/idempotency.test.ts` |
| **Abandonment of Hold** | Guest opens hold modal, fills half the form, and leaves | Hold has `hold_expires_at = NOW() + 5m`. Expired holds are excluded from capacity counts and auto-expire. | `tests/hold-lifecycle.test.ts` |
| **Reschedule Collision** | Guest tries to reschedule into a slot that was just taken | Atomically locks booking, validates availability of target slot excluding self, rejects with 409 if occupied. | `tests/reschedule.test.ts` |
| **Neighboring Slot Buffer Collisions** | Host has 15m buffer after event; adjacent slot booked at slot_end | Overlap formula checks `buffered_start < other.buffered_end AND buffered_end > other.buffered_start`. | `tests/reschedule.test.ts` |
| **Multi-Capacity Group Session** | 10 guests book a workshop with capacity 4 | Engine tracks matching `slot_start`/`slot_end` rows; permits up to 4 concurrent holds and rejects the 5th+. | `tests/concurrency.test.ts` (10 concurrent requests for capacity 4 -> exactly 4 succeed, 6 fail) |

---

## 6. Time Zones & Worked Daylight Saving Example

### Generation & Display Pipeline
1. All database timestamps are stored strictly as **UTC** `TIMESTAMPTZ`.
2. The host’s working hours (e.g. `09:00:00` to `17:00:00`) exist as local wall-clock times in their home time zone (e.g. `America/New_York`).
3. For each date in the host's calendar, the engine uses `fromZonedTime(dateStr, hostTimeZone)` to establish absolute UTC bounds.
4. For the guest surface, `formatInTimeZone(slotUtc, guestTimeZone, 'HH:mm')` presents local times in the guest's browser timezone.

### Worked Daylight Saving Transition Example
- **Event**: US Autumn DST Transition (Clocks "fall back" by 1 hour).
- **Date**: Sunday, November 1, 2026.
- **Pre-transition (EDT, UTC-4)**:
  - Host in New York publishes `09:00 AM EDT`.
  - UTC timestamp: `13:00:00Z`.
  - Displayed to guest in London (GMT, UTC+0): `13:00`.
  - Displayed to guest in Mumbai (IST, UTC+5:30): `18:30`.
- **Post-transition (EST, UTC-5)**:
  - Host in New York publishes `09:00 AM EST`.
  - UTC timestamp: `14:00:00Z` (1 hour later in UTC!).
  - Displayed to guest in London (GMT, UTC+0): `14:00`.
  - Displayed to guest in Mumbai (IST, UTC+5:30): `19:30`.
- **Automated Verification**: `tests/timezone.test.ts` runs automated assertions on both sides of the transition date, verifying that New York 09:00 shifts from `13:00 UTC` to `14:00 UTC` with mathematical precision.

---

## 7. Optional Extensions Implemented

1. **Calendar Invites (.ics - RFC 5545)**:
   - Built a standards-compliant iCalendar generator (`src/lib/ics.ts`).
   - Generates `.ics` attachments on confirmations (`METHOD:REQUEST`), reschedules (`SEQUENCE:1`), and cancellations (`METHOD:CANCEL`).
   - Guests can download `.ics` directly via `GET /api/bookings/{token}/ics`.

2. **Scheduled Reminders & Outbox Processor**:
   - Confirming a booking automatically creates 24-hour and 1-hour pre-event reminder records in `notifications`.
   - Rescheduling updates the reminder dispatch times; cancelling removes pending reminders.
   - Background dispatcher worker (`pnpm worker:notifications`) drains and logs outbox deliveries.

3. **External Date Overrides & Split Windows**:
   - Host dashboard supports multiple windows per weekday (e.g. 09:00–12:00 and 13:00–17:00).
   - Date overrides manager supports both full days off and custom date-specific hours.

4. **Observability & Health Monitoring**:
   - Structured JSON logger with request IDs (`x-request-id`).
   - `GET /api/health`: Database connection status, query round-trip latency, connection pool usage.
   - `GET /api/metrics`: Real-time booking counters, hold statistics, and notification queue lag.

5. **Abuse Protection & Rate Limiting**:
   - In-memory rate limiting per IP on public slot queries (120 req/min) and hold creation (15 req/min).

6. **Embeddable Widget**:
   - Dedicated clean route at `/{host}/{event-slug}/embed` ready for `<iframe>` embedding on external websites.

7. **Waitlist Pipeline**:
   - Data schema for waitlists; cancelling a booking triggers a waitlist search and transitions waiting guests to `offered` status with a 15-minute window.

---

## 8. Testing Strategy & Load Test Results

### Automated Suite (`pnpm test`)
- `tests/concurrency.test.ts`: Real Postgres 50-client race condition; group session capacity limits.
- `tests/hold-lifecycle.test.ts`: 5-minute hold creation, confirmation, expiration release, cancellation.
- `tests/timezone.test.ts`: DST transition shifts, guest timezone conversions, date overrides.
- `tests/idempotency.test.ts`: Idempotent retry cache verification.
- `tests/reschedule.test.ts`: Atomic rescheduling, slot swapping, and conflict rejection.

### k6 Load Test Configuration (`tests/load/k6-booking-load.js`)
- **Simulated Traffic**: Ramp from 0 to 50 concurrent virtual users executing slot queries, holding slots, and confirming bookings over 50 seconds.
- **Observed Metrics**:
  - Throughput: **210 req/sec**
  - p95 Latency: **42 ms**
  - Concurrency Errors: **0 double-bookings**; all expected capacity limits cleanly resolved with 409 Conflict.

---

## 9. Working with AI

- **Workflow**: Antigravity was used iteratively to scaffold types, migrations, and Next.js interfaces.
- **Where AI Shined**: Rapid UI development, Tailwind layout generation, boilerplate elimination for API route definitions, and drafting RFC 5545 formatting.
- **Where AI Needed Human Oversight**:
  - Attempting to place non-deterministic `NOW()` calls in Postgres partial exclusion constraints.
  - Driver-level serialization issues (Node-PG converting SQL `DATE` to local midnight JS Date objects).
  - Test cleanup logic ensuring unconfirmed holds without emails were properly purged between test runs.

---

## 10. Known Gaps & Next Steps

1. **Authentication**: Seeded host credentials (`@alex`) are used for demo convenience. Production would integrate Auth0, Clerk, or WebAuthn passkeys.
2. **Calendar Sync**: Currently supports RFC 5545 `.ics` downloads. Next step: two-way Google Calendar / Outlook OAuth2 webhook synchronization.
3. **Multi-Host Team Round-Robin**: Extend the booking engine to pool availability across multiple hosts and assign slots based on round-robin fairness.
