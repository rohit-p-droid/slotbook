import { describe, it, expect, beforeAll } from 'vitest';
import { generateAvailableSlots } from '@/lib/slots';
import { Host, EventType } from '@/lib/types';
import { pool } from '@/db';

describe('Timezone & DST Slot Generation', () => {
  let host: Host;
  let eventType: EventType;

  beforeAll(async () => {
    // Retrieve seeded host Alex (America/New_York)
    const hostRes = await pool.query<Host>("SELECT * FROM hosts WHERE slug = 'alex'");
    host = hostRes.rows[0];

    const eventRes = await pool.query<EventType>(
      "SELECT * FROM event_types WHERE host_id = $1 AND slug = 'quick-chat'",
      [host.id]
    );
    eventType = eventRes.rows[0];
  });

  it('translates host slots correctly into guest browser timezones', async () => {
    // 2026-11-18 is a Wednesday
    const slotsInGuestTz = await generateAvailableSlots({
      host,
      eventType,
      from: '2026-11-18T00:00:00Z',
      to: '2026-11-18T23:59:59Z',
      guestTimeZone: 'Asia/Kolkata', // UTC +5:30
      now: new Date('2026-11-01T00:00:00Z'),
    });

    expect(slotsInGuestTz.length).toBeGreaterThan(0);

    const firstSlot = slotsInGuestTz[0];
    // Host starts at 09:00 America/New_York (UTC-5 in November = 14:00 UTC)
    // 14:00 UTC in Asia/Kolkata (+5:30) is 19:30
    expect(firstSlot.local_start).toBe('19:30');
    expect(firstSlot.local_end).toBe('20:00');
  });

  it('correctly handles Daylight Saving Time (DST) transitions in America/New_York', async () => {
    // In the US, DST ended on Sunday, November 1, 2026 (clocks fell back 1 hour, EDT UTC-4 -> EST UTC-5).
    // During EST (November 4): 09:00 NY = 14:00 UTC
    // During EDT (October 21): 09:00 NY = 13:00 UTC

    const slotsNovEst = await generateAvailableSlots({
      host,
      eventType,
      from: '2026-11-04T00:00:00Z',
      to: '2026-11-04T23:59:59Z',
      guestTimeZone: 'UTC',
      now: new Date('2026-10-25T00:00:00Z'), // within 30-day horizon
    });

    expect(slotsNovEst.length).toBeGreaterThan(0);
    const firstSlotNov = slotsNovEst[0];
    // In EST (UTC-5), 09:00 NY is 14:00 UTC
    expect(firstSlotNov.local_start).toBe('14:00');

    // Also test EDT date (October 21, 2026):
    const slotsOctEdt = await generateAvailableSlots({
      host,
      eventType,
      from: '2026-10-21T00:00:00Z',
      to: '2026-10-21T23:59:59Z',
      guestTimeZone: 'UTC',
      now: new Date('2026-10-15T00:00:00Z'),
    });

    expect(slotsOctEdt.length).toBeGreaterThan(0);
    const firstSlotOct = slotsOctEdt[0];
    // In EDT (UTC-4), 09:00 NY is 13:00 UTC! (DST shift verified!)
    expect(firstSlotOct.local_start).toBe('13:00');
  });

  it('respects date overrides (day off removes all slots)', async () => {
    // Fetch day off override from database
    const overrideRes = await pool.query(
      "SELECT override_date::text as date FROM host_overrides WHERE host_id = $1 AND is_unavailable = TRUE LIMIT 1",
      [host.id]
    );
    const dayOffDate = overrideRes.rows[0].date;

    const slotsOnDayOff = await generateAvailableSlots({
      host,
      eventType,
      from: `${dayOffDate}T00:00:00Z`,
      to: `${dayOffDate}T23:59:59Z`,
      guestTimeZone: 'America/New_York',
      now: new Date('2026-11-01T00:00:00Z'),
    });

    expect(slotsOnDayOff.length).toBe(0);
  });

  it('respects custom hours override', async () => {
    // Fetch custom hours override from database
    const customRes = await pool.query(
      "SELECT override_date::text as date, start_time::text as start_time, end_time::text as end_time FROM host_overrides WHERE host_id = $1 AND is_unavailable = FALSE LIMIT 1",
      [host.id]
    );
    const customOverride = customRes.rows[0];

    const slotsCustom = await generateAvailableSlots({
      host,
      eventType,
      from: `${customOverride.date}T00:00:00Z`,
      to: `${customOverride.date}T23:59:59Z`,
      guestTimeZone: 'America/New_York',
      now: new Date('2026-11-01T00:00:00Z'),
    });

    expect(slotsCustom.length).toBeGreaterThan(0);
    expect(slotsCustom[0].local_start).toBe(customOverride.start_time.slice(0, 5));
    expect(slotsCustom[slotsCustom.length - 1].local_end).toBe(customOverride.end_time.slice(0, 5));
  });
});
