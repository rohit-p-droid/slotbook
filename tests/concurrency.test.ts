import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { BookingEngine, BookingError } from '@/lib/booking-engine';
import { pool } from '@/db';

describe('Real Postgres Concurrency & Double-Booking Protection', () => {
  beforeAll(async () => {
    // Clean up test bookings
    await pool.query('DELETE FROM bookings');
    await pool.query('DELETE FROM idempotency_keys');
  });

  afterAll(async () => {
    await pool.query('DELETE FROM bookings');
    await pool.query('DELETE FROM idempotency_keys');
  });

  it('50 concurrent hold requests for a 1-on-1 slot: exactly 1 wins, 49 fail with 409', async () => {
    const slotStart = '2026-11-25T14:00:00.000Z';
    const slotEnd = '2026-11-25T14:30:00.000Z';

    // 50 concurrent requests competing for the single available slot
    const concurrencyLevel = 50;
    const promises = Array.from({ length: concurrencyLevel }).map(async (_, idx) => {
      try {
        const res = await BookingEngine.holdSlot({
          hostSlug: 'alex',
          eventSlug: 'quick-chat', // capacity 1
          slotStart,
          slotEnd,
          idempotencyKey: `concurrency_test_${idx}_${Date.now()}`,
        });
        return { success: true, status: res.status, data: res.data };
      } catch (err: any) {
        return {
          success: false,
          statusCode: err instanceof BookingError ? err.statusCode : 500,
          message: err.message,
        };
      }
    });

    const results = await Promise.all(promises);

    const successfulHolds = results.filter((r) => r.success);
    const rejectedHolds = results.filter((r) => !r.success);

    // EXACTLY 1 request must win the hold
    expect(successfulHolds.length).toBe(1);
    expect(successfulHolds[0].status).toBe(201);

    // The remaining 49 must be rejected with 409 Conflict
    expect(rejectedHolds.length).toBe(concurrencyLevel - 1);
    for (const rejected of rejectedHolds) {
      expect(rejected.statusCode).toBe(409);
    }

    // Verify database state: exactly 1 active hold exists for this slot
    const dbRows = await pool.query(
      `SELECT * FROM bookings
       WHERE host_id = (SELECT id FROM hosts WHERE slug = 'alex')
         AND slot_start = $1
         AND status = 'held'`,
      [slotStart]
    );

    expect(dbRows.rowCount).toBe(1);
  });

  it('Group session (capacity 4): 10 concurrent requests; exactly 4 succeed, 6 fail with 409', async () => {
    const slotStart = '2026-11-26T15:00:00.000Z';
    const slotEnd = '2026-11-26T16:00:00.000Z';

    const concurrencyLevel = 10;
    const promises = Array.from({ length: concurrencyLevel }).map(async (_, idx) => {
      try {
        const res = await BookingEngine.holdSlot({
          hostSlug: 'alex',
          eventSlug: 'tech-workshop', // capacity 4
          slotStart,
          slotEnd,
          idempotencyKey: `group_concurrency_${idx}_${Date.now()}`,
        });
        return { success: true, status: res.status, data: res.data };
      } catch (err: any) {
        return {
          success: false,
          statusCode: err instanceof BookingError ? err.statusCode : 500,
          message: err.message,
        };
      }
    });

    const results = await Promise.all(promises);

    const successfulHolds = results.filter((r) => r.success);
    const rejectedHolds = results.filter((r) => !r.success);

    // EXACTLY 4 requests must win the holds
    expect(successfulHolds.length).toBe(4);
    expect(rejectedHolds.length).toBe(6);

    for (const rejected of rejectedHolds) {
      expect(rejected.statusCode).toBe(409);
    }

    // Verify DB count
    const dbCount = await pool.query(
      `SELECT COUNT(*)::int as count FROM bookings
       WHERE host_id = (SELECT id FROM hosts WHERE slug = 'alex')
         AND slot_start = $1
         AND status = 'held'`,
      [slotStart]
    );

    expect(dbCount.rows[0].count).toBe(4);
  });
});
