import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { BookingEngine } from '@/lib/booking-engine';
import { pool } from '@/db';

describe('Idempotency Key Protection', () => {
  const slotStart = '2026-12-01T14:00:00.000Z';
  const slotEnd = '2026-12-01T14:30:00.000Z';

  beforeAll(async () => {
    await pool.query('DELETE FROM bookings');
    await pool.query('DELETE FROM idempotency_keys');
  });

  afterAll(async () => {
    await pool.query('DELETE FROM bookings');
    await pool.query('DELETE FROM idempotency_keys');
  });

  it('replaying the same Idempotency-Key returns cached response without duplicate bookings', async () => {
    const idempotencyKey = `idem_key_${Date.now()}`;

    // Request 1
    const res1 = await BookingEngine.holdSlot({
      hostSlug: 'alex',
      eventSlug: 'quick-chat',
      slotStart,
      slotEnd,
      idempotencyKey,
    });

    expect(res1.status).toBe(201);
    expect(res1.fromCache).toBe(false);
    const originalHoldId = res1.data.id;

    // Request 2 with identical key (simulating network timeout retry)
    const res2 = await BookingEngine.holdSlot({
      hostSlug: 'alex',
      eventSlug: 'quick-chat',
      slotStart,
      slotEnd,
      idempotencyKey,
    });

    // Should return cached response with same hold ID
    expect(res2.status).toBe(201);
    expect(res2.fromCache).toBe(true);
    expect(res2.data.id).toBe(originalHoldId);

    // Verify DB count: only 1 booking was created
    const dbCount = await pool.query(
      `SELECT COUNT(*)::int as count FROM bookings WHERE id = $1`,
      [originalHoldId]
    );
    expect(dbCount.rows[0].count).toBe(1);
  });
});
