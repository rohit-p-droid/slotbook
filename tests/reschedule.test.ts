import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { BookingEngine } from '@/lib/booking-engine';
import { pool } from '@/db';

describe('Reschedule Atomicity & Collision Detection', () => {
  beforeAll(async () => {
    await pool.query('DELETE FROM bookings');
    await pool.query('DELETE FROM notifications');
  });

  afterAll(async () => {
    await pool.query('DELETE FROM bookings');
    await pool.query('DELETE FROM notifications');
  });

  it('atomically reschedules booking to a free slot and releases previous slot', async () => {
    const originalStart = '2026-12-02T14:00:00.000Z';
    const originalEnd = '2026-12-02T14:30:00.000Z';
    const newStart = '2026-12-02T15:00:00.000Z';
    const newEnd = '2026-12-02T15:30:00.000Z';

    // 1. Create and confirm original booking
    const hold = await BookingEngine.holdSlot({
      hostSlug: 'alex',
      eventSlug: 'quick-chat',
      slotStart: originalStart,
      slotEnd: originalEnd,
    });

    const confirmed = await BookingEngine.confirmHold({
      holdIdentifier: hold.data.id,
      guestName: 'Reschedule Guest',
      guestEmail: 'guest.reschedule@example.com',
    });

    // 2. Reschedule to new slot
    const rescheduleRes = await BookingEngine.rescheduleBooking({
      bookingToken: confirmed.booking_token!,
      newSlotStart: newStart,
      newSlotEnd: newEnd,
    });

    expect(new Date(rescheduleRes.slot_start).toISOString()).toBe(newStart);
    expect(new Date(rescheduleRes.slot_end).toISOString()).toBe(newEnd);

    // 3. Verify original slot is now free by successfully holding it with another guest
    const reuseOriginalHold = await BookingEngine.holdSlot({
      hostSlug: 'alex',
      eventSlug: 'quick-chat',
      slotStart: originalStart,
      slotEnd: originalEnd,
    });

    expect(reuseOriginalHold.status).toBe(201);

    // 4. Verify notification outbox has BOOKING_RESCHEDULED
    const notifRes = await pool.query(
      `SELECT * FROM notifications WHERE booking_id = $1 AND event_type = 'BOOKING_RESCHEDULED'`,
      [confirmed.id]
    );
    expect(notifRes.rowCount).toBe(1);
  });

  it('rejects reschedule when target slot conflicts with an existing booking', async () => {
    const slotAStart = '2026-12-03T14:00:00.000Z';
    const slotAEnd = '2026-12-03T14:30:00.000Z';
    const slotBStart = '2026-12-03T15:00:00.000Z';
    const slotBEnd = '2026-12-03T15:30:00.000Z';

    // Booking A
    const holdA = await BookingEngine.holdSlot({
      hostSlug: 'alex',
      eventSlug: 'quick-chat',
      slotStart: slotAStart,
      slotEnd: slotAEnd,
    });
    const bookingA = await BookingEngine.confirmHold({
      holdIdentifier: holdA.data.id,
      guestName: 'User A',
      guestEmail: 'a.reschedule@example.com',
    });

    // Booking B
    const holdB = await BookingEngine.holdSlot({
      hostSlug: 'alex',
      eventSlug: 'quick-chat',
      slotStart: slotBStart,
      slotEnd: slotBEnd,
    });
    const bookingB = await BookingEngine.confirmHold({
      holdIdentifier: holdB.data.id,
      guestName: 'User B',
      guestEmail: 'b.reschedule@example.com',
    });

    // Attempt to reschedule Booking B into Slot A (already occupied by User A)
    await expect(
      BookingEngine.rescheduleBooking({
        bookingToken: bookingB.booking_token!,
        newSlotStart: slotAStart,
        newSlotEnd: slotAEnd,
      })
    ).rejects.toThrow();
  });
});
