import { pool, withTransaction } from '@/db';
import { generateICS } from './ics';
import pg from 'pg';

export interface EmitNotificationParams {
  bookingId: string;
  eventType: 'BOOKING_CONFIRMED' | 'BOOKING_RESCHEDULED' | 'BOOKING_CANCELLED' | 'REMINDER_24H' | 'REMINDER_1H';
  recipientEmail: string;
  subject: string;
  payload: Record<string, any>;
  client?: pg.PoolClient;
  scheduledFor?: Date;
}

export async function emitNotification({
  bookingId,
  eventType,
  recipientEmail,
  subject,
  payload,
  client,
  scheduledFor = new Date(),
}: EmitNotificationParams): Promise<string> {
  const queryExecutor = client || pool;

  const res = await queryExecutor.query(
    `INSERT INTO notifications (booking_id, event_type, recipient_email, subject, payload, scheduled_for, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'pending')
     RETURNING id`,
    [bookingId, eventType, recipientEmail, subject, JSON.stringify(payload), scheduledFor.toISOString()]
  );

  return res.rows[0].id;
}

/**
 * Dispatches pending notifications from outbox.
 * In production or demo, this runs either periodically or inline.
 */
export async function dispatchPendingNotifications(limit = 20): Promise<{ processed: number; failed: number }> {
  let processed = 0;
  let failed = 0;

  const now = new Date().toISOString();

  // Pick pending notifications that are due
  const pending = await pool.query(
    `SELECT * FROM notifications
     WHERE status = 'pending' AND scheduled_for <= $1
     ORDER BY scheduled_for ASC
     LIMIT $2
     FOR UPDATE SKIP LOCKED`,
    [now, limit]
  );

  for (const row of pending.rows) {
    try {
      // Simulate or deliver to sink / console log
      console.log(`📨 [NOTIFICATION SINK] Delivering ${row.event_type} to ${row.recipient_email}:`, {
        id: row.id,
        subject: row.subject,
        payloadSummary: {
          event: row.event_type,
          bookingId: row.booking_id,
          recipient: row.recipient_email,
        },
      });

      await pool.query(
        `UPDATE notifications
         SET status = 'delivered', delivered_at = NOW(), attempts = attempts + 1
         WHERE id = $1`,
        [row.id]
      );
      processed++;
    } catch (err: any) {
      console.error(`❌ [NOTIFICATION SINK] Delivery failed for ${row.id}:`, err);
      await pool.query(
        `UPDATE notifications
         SET attempts = attempts + 1, last_error = $1, status = CASE WHEN attempts >= 5 THEN 'failed' ELSE 'pending' END
         WHERE id = $2`,
        [err.message, row.id]
      );
      failed++;
    }
  }

  return { processed, failed };
}
