# AI Collaboration & Engineering Log

## Tooling & Models
- **AI Assistant**: Antigravity (Powered by Google Gemini 3.8 Flash & Pro)
- **Primary Roles**: System architecture co-pilot, SQL isolation & concurrency design, automated test generation, and frontend component authoring.

---

## Key Prompts & Engineering Dialogues

1. **Postgres Concurrency & No-Redis Lock Architecture**:
   - *Prompt*: "We need to build a booking engine that prevents double-booking even under extreme concurrency, without Redis or external distributed lock managers. Postgres 15+ must be the single source of truth. How should transaction locks, capacity counts, and hold expiries be orchestrated?"
   - *Exploration*: Examined PostgreSQL exclusion constraints with `tstzrange` and `btree_gist`, row-level locking (`SELECT ... FOR UPDATE`), and transactional advisory locks (`pg_advisory_xact_lock`).

2. **Timezone & Daylight Saving Transitions**:
   - *Prompt*: "Hosts define weekly availability in their home IANA timezone (e.g. America/New_York) and guests browse in their own browser timezone (e.g. Asia/Kolkata or Europe/London). Walk through the exact algorithm to generate slots across calendar dates, accounting for US Fall DST transitions (25-hour day) and Spring DST transitions (23-hour day)."

3. **Transactional Outbox & Idempotency**:
   - *Prompt*: "Design the idempotency mechanism for `POST /api/holds` and the transactional outbox pattern for notification emission upon booking confirmations, reschedules, and cancellations."

---

## Where the AI Got Things Wrong & What Was Changed By Hand

### 1. PostgreSQL Exclusion Constraint on Dynamic Predicates
- **The Issue**: Initially, the AI suggested adding a partial PostgreSQL exclusion constraint:
  ```sql
  EXCLUDE USING gist (host_id WITH =, tstzrange(buffered_start, buffered_end) WITH &&)
  WHERE (status IN ('held', 'confirmed') AND (status != 'held' OR hold_expires_at > NOW()));
  ```
- **The Correction**: PostgreSQL strictly forbids volatile functions like `NOW()` or `clock_timestamp()` inside partial index/exclusion constraint predicates because index predicates must be strictly immutable.
- **Manual Architecture Choice**: We decoupled static exclusion constraints (which apply to `status = 'confirmed'`) from dynamic hold validation. In `BookingEngine.holdSlot()`, we use `SELECT pg_advisory_xact_lock(hashtext('host_lock_' || host.id))` within the transaction. This serializes concurrent booking operations per host cleanly and guarantees zero double-booking while allowing dynamic hold expiries (`hold_expires_at > NOW()`).

### 2. Node-PG SQL `DATE` Type Parsing Bug
- **The Issue**: In `tests/timezone.test.ts`, the date override test failed because the query `SELECT * FROM host_overrides` returned `override_date` as a JavaScript Date object parsed in the system's local timezone (+05:30). When `.toISOString().slice(0, 10)` was called on `2026-11-12T00:00:00+05:30`, it evaluated to `"2026-11-11"`, causing the day-off override to miss its target date.
- **The Correction**: We updated SQL queries to explicitly cast date columns:
  ```sql
  SELECT override_date::text as override_date, start_time::text as start_time, end_time::text as end_time
  FROM host_overrides WHERE host_id = $1
  ```
  This guarantees that calendar dates remain pure ISO `YYYY-MM-DD` strings without arbitrary timezone shifting.

### 3. Test Teardown & Active Holds Accumulation
- **The Issue**: When running test suites repeatedly, `tests/concurrency.test.ts` and `tests/hold-lifecycle.test.ts` cleaned up bookings using `WHERE guest_email LIKE '%...'`. But newly created holds do not yet have a `guest_email`. As a result, active holds from earlier test runs remained active for their 5-minute lifespan, causing subsequent runs of tests on the same date/time to fail with "Slot is no longer available".
- **The Correction**: We updated test setup to clean up all test tables (`DELETE FROM bookings`, `DELETE FROM idempotency_keys`, `DELETE FROM notifications`) in `beforeAll` hooks and re-seed clean demo data afterwards.

---

## Reflections & Value Added
AI dramatically accelerated boilerplate scaffolding (Docker compose, Next.js page layouts, TypeScript interfaces, and SQL schema syntax). However, deep architectural decisions—specifically transaction isolation semantics, Postgres advisory lock scoping, and timezone normalization across database driver layers—required rigorous systems reasoning and hands-on verification.
