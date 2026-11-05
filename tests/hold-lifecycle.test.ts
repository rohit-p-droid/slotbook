import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { BookingEngine, BookingError } from '@/lib/booking-engine';
import { pool } from '@/db';

describe('Booking Lifecycle: Hold -> Confirm -> Expire -> Cancel', () => {
  const slotStart = '2026-11-27T14:00:00.000Z';
  const slotEnd = '2026-11-27T14:30:00.000Z';

  beforeAll(async () => {
    await pool.query('DELETE FROM bookings');
    await pool.query('DELETE FROM notifications');
  });

  afterAll(async () => {
    await pool.query('DELETE FROM bookings');
    await pool.query('DELETE FROM notifications');
  });

  it('creates a 5-minute hold and verifies expiration timestamp', async () => {
    const holdRes = await BookingEngine.holdSlot({
      hostSlug: 'alex',
      eventSlug: 'quick-chat',
      slotStart,
      slotEnd,
    });

    expect(holdRes.status).toBe(201);
    expect(holdRes.data.status).toBe('held');
    expect(holdRes.data.hold_token).toBeDefined();

    const expiresAt = new Date(holdRes.data.hold_expires_at).getTime();
    const expectedExpiry = Date.now() + 5 * 60 * 1000;
    // Expiration should be within 10 seconds of 5 minutes from now
    expect(Math.abs(expiresAt - expectedExpiry)).toBeLessThan(10000);
  });

  it('confirms hold within 5 minutes and emits notification', async () => {
    // 1. Create fresh hold
    const freshStart = '2026-11-28T15:00:00.000Z';
    const freshEnd = '2026-11-28T15:30:00.000Z';

    const hold = await BookingEngine.holdSlot({
      hostSlug: 'alex',
      eventSlug: 'quick-chat',
      slotStart: freshStart,
      slotEnd: freshEnd,
    });

    // 2. Confirm hold
    const confirmRes = await BookingEngine.confirmHold({
      holdIdentifier: hold.data.id,
      guestName: 'Jane Doe',
      guestEmail: 'jane.lifecycle@example.com',
      guestNotes: 'Looking forward to our chat!',
    });

    expect(confirmRes.status).toBe('confirmed');
    expect(confirmRes.booking_token).toBeDefined();
    expect(confirmRes.manage_url).toBe(`/manage/${confirmRes.booking_token}`);

    // 3. Verify notification outbox has BOOKING_CONFIRMED event
    const notifRes = await pool.query(
      `SELECT * FROM notifications WHERE booking_id = $1 AND event_type = 'BOOKING_CONFIRMED'`,
      [confirmRes.id]
    );
    expect(notifRes.rowCount).toBe(1);
    expect(notifRes.rows[0].recipient_email).toBe('jane.lifecycle@example.com');
  });

  it('rejects confirmation of an expired hold and releases slot capacity', async () => {
    const expireStart = '2026-11-29T16:00:00.000Z';
    const expireEnd = '2026-11-29T16:30:00.000Z';

    // 1. Create hold
    const hold = await BookingEngine.holdSlot({
      hostSlug: 'alex',
      eventSlug: 'quick-chat',
      slotStart: expireStart,
      slotEnd: expireEnd,
    });

    // 2. Artificially simulate hold expiration by setting hold_expires_at to 10 minutes ago
    await pool.query(
      "UPDATE bookings SET hold_expires_at = NOW() - INTERVAL '10 minutes' WHERE id = $1",
      [hold.data.id]
    );

    // 3. Confirming must fail with 410 or 409
    await expect(
      BookingEngine.confirmHold({
        holdIdentifier: hold.data.id,
        guestName: 'Late Guest',
        guestEmail: 'late@example.com',
      })
    ).rejects.toThrow();

    // 4. A new guest should now be able to hold the exact same slot!
    const newHold = await BookingEngine.holdSlot({
      hostSlug: 'alex',
      eventSlug: 'quick-chat',
      slotStart: expireStart,
      slotEnd: expireEnd,
    });

    expect(newHold.status).toBe(201);
    expect(newHold.data.id).not.toBe(hold.data.id);
  });

  it('cancels a booking with reason and creates cancellation notification', async () => {
    const cancelStart = '2026-11-30T17:00:00.000Z';
    const cancelEnd = '2026-11-30T17:30:00.000Z';

    const hold = await BookingEngine.holdSlot({
      hostSlug: 'alex',
      eventSlug: 'quick-chat',
      slotStart: cancelStart,
      slotEnd: cancelEnd,
    });

    const confirmed = await BookingEngine.confirmHold({
      holdIdentifier: hold.data.id,
      guestName: 'Cancel Test',
      guestEmail: 'cancel.lifecycle@example.com',
    });

    const cancelRes = await BookingEngine.cancelBooking({
      bookingTokenOrId: confirmed.booking_token!,
      reason: 'Schedule conflict',
      cancelledBy: 'guest',
    });

    expect(cancelRes.status).toBe('cancelled');
    expect(cancelRes.cancellation_reason).toBe('Schedule conflict');

    // Verify cancellation notification
    const notifRes = await pool.query(
      `SELECT * FROM notifications WHERE booking_id = $1 AND event_type = 'BOOKING_CANCELLED'`,
      [confirmed.id]
    );
    expect(notifRes.rowCount).toBe(1);
  });
});
