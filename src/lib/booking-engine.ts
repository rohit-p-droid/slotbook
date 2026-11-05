import crypto from 'crypto';
import { addMinutes, addDays, isBefore, isAfter } from 'date-fns';
import { fromZonedTime, toZonedTime } from 'date-fns-tz';
import { pool, withTransaction } from '@/db';
import { emitNotification } from './notifications';
import { generateICS } from './ics';
import { Host, EventType, Booking } from './types';

export class BookingError extends Error {
  constructor(
    message: string,
    public statusCode: number = 400,
    public code: string = 'BOOKING_ERROR'
  ) {
    super(message);
    this.name = 'BookingError';
  }
}

export interface HoldSlotParams {
  hostSlug: string;
  eventSlug: string;
  slotStart: string; // ISO 8601 UTC
  slotEnd: string;   // ISO 8601 UTC
  idempotencyKey?: string | null;
}

export interface ConfirmHoldParams {
  holdIdentifier: string; // hold UUID or hold_token
  guestName: string;
  guestEmail: string;
  guestNotes?: string;
}

export interface RescheduleParams {
  bookingToken: string;
  newSlotStart: string; // ISO 8601 UTC
  newSlotEnd: string;   // ISO 8601 UTC
}

export interface CancelParams {
  bookingTokenOrId: string;
  reason: string;
  cancelledBy?: 'guest' | 'host';
}

export class BookingEngine {
  /**
   * Holds a slot for 5 minutes.
   * Uses Postgres advisory lock on host to prevent race conditions.
   * Supports Idempotency-Key.
   */
  static async holdSlot({
    hostSlug,
    eventSlug,
    slotStart: slotStartStr,
    slotEnd: slotEndStr,
    idempotencyKey,
  }: HoldSlotParams) {
    // 1. Check idempotency cache if key provided
    if (idempotencyKey) {
      const existing = await pool.query(
        'SELECT response_status, response_body FROM idempotency_keys WHERE key = $1 AND expires_at > NOW()',
        [idempotencyKey]
      );
      if (existing.rowCount && existing.rowCount > 0) {
        return {
          fromCache: true,
          status: existing.rows[0].response_status,
          data: existing.rows[0].response_body,
        };
      }
    }

    const slotStart = new Date(slotStartStr);
    const slotEnd = new Date(slotEndStr);

    if (isNaN(slotStart.getTime()) || isNaN(slotEnd.getTime())) {
      throw new BookingError('Invalid slot_start or slot_end timestamp', 400, 'INVALID_TIMESTAMP');
    }

    if (!isBefore(slotStart, slotEnd)) {
      throw new BookingError('slot_start must be strictly before slot_end', 400, 'INVALID_TIME_RANGE');
    }

    const result = await withTransaction(async (client) => {
      // 2. Fetch host and event type
      const hostRes = await client.query<Host>(
        'SELECT * FROM hosts WHERE slug = $1',
        [hostSlug]
      );
      if (hostRes.rowCount === 0) {
        throw new BookingError(`Host '@${hostSlug}' not found`, 404, 'HOST_NOT_FOUND');
      }
      const host = hostRes.rows[0];

      // 3. Acquire Postgres transaction advisory lock on host ID.
      // This serializes concurrent booking operations for this host for the duration of this transaction.
      // Postgres automatically releases the lock at transaction COMMIT or ROLLBACK.
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`host_lock_${host.id}`]);

      const eventRes = await client.query<EventType>(
        'SELECT * FROM event_types WHERE host_id = $1 AND slug = $2 AND is_active = TRUE',
        [host.id, eventSlug]
      );
      if (eventRes.rowCount === 0) {
        throw new BookingError(`Event type '${eventSlug}' not found for host`, 404, 'EVENT_NOT_FOUND');
      }
      const eventType = eventRes.rows[0];

      // 4. Validate slot duration
      const durationMs = slotEnd.getTime() - slotStart.getTime();
      const expectedDurationMs = eventType.duration_minutes * 60 * 1000;
      if (durationMs !== expectedDurationMs) {
        throw new BookingError(
          `Slot duration (${durationMs / 60000}m) does not match event duration (${eventType.duration_minutes}m)`,
          400,
          'INVALID_DURATION'
        );
      }

      const now = new Date();

      // 5. Check minimum notice
      const minNoticeDate = addMinutes(now, eventType.min_notice_hours * 60);
      if (isBefore(slotStart, minNoticeDate)) {
        throw new BookingError(
          `Slot must be booked at least ${eventType.min_notice_hours} hours in advance`,
          400,
          'MINIMUM_NOTICE_VIOLATION'
        );
      }

      // 6. Check booking horizon
      const maxHorizonDate = addDays(now, eventType.booking_horizon_days);
      if (isAfter(slotEnd, maxHorizonDate)) {
        throw new BookingError(
          `Slot is outside the allowed ${eventType.booking_horizon_days}-day booking horizon`,
          400,
          'HORIZON_VIOLATION'
        );
      }

      // 7. Expire past holds to free up capacity
      await client.query(
        `UPDATE bookings
         SET status = 'expired'
         WHERE host_id = $1 AND status = 'held' AND hold_expires_at <= NOW()`,
        [host.id]
      );

      // 8. Calculate buffered range
      const bufferedStart = addMinutes(slotStart, -eventType.buffer_before_minutes);
      const bufferedEnd = addMinutes(slotEnd, eventType.buffer_after_minutes);

      // 9. Query conflicting active bookings and holds for the host
      const conflictsRes = await client.query<{
        id: string;
        event_type_id: string;
        slot_start: Date;
        slot_end: Date;
        buffered_start: Date;
        buffered_end: Date;
        status: string;
      }>(
        `SELECT id, event_type_id, slot_start, slot_end, buffered_start, buffered_end, status
         FROM bookings
         WHERE host_id = $1
           AND (status = 'confirmed' OR (status = 'held' AND hold_expires_at > NOW()))
           AND buffered_start < $2
           AND buffered_end > $3`,
        [host.id, bufferedEnd.toISOString(), bufferedStart.toISOString()]
      );

      const conflicts = conflictsRes.rows;

      if (eventType.capacity === 1) {
        // For 1-on-1: any overlapping active booking or hold means slot is taken
        if (conflicts.length > 0) {
          throw new BookingError('The requested slot is no longer available', 409, 'SLOT_UNAVAILABLE');
        }
      } else {
        // For group session:
        // Must be on the exact same slot start & end on this event type, and within capacity
        let sameSlotCount = 0;
        for (const conf of conflicts) {
          const isSameSlot =
            conf.event_type_id === eventType.id &&
            new Date(conf.slot_start).getTime() === slotStart.getTime() &&
            new Date(conf.slot_end).getTime() === slotEnd.getTime();

          if (isSameSlot) {
            sameSlotCount++;
          } else {
            // Overlapping with a different event or buffer collision
            throw new BookingError('The requested slot conflicts with existing commitments', 409, 'SLOT_UNAVAILABLE');
          }
        }

        if (sameSlotCount >= eventType.capacity) {
          throw new BookingError('The requested group session slot is full', 409, 'SLOT_CAPACITY_REACHED');
        }
      }

      // 10. Generate hold record
      const holdToken = `hold_${crypto.randomUUID().replace(/-/g, '')}`;
      const holdExpiresAt = addMinutes(now, 5); // 5-minute hold

      const insertRes = await client.query<Booking>(
        `INSERT INTO bookings (
          host_id, event_type_id, status, slot_start, slot_end,
          buffered_start, buffered_end, hold_token, hold_expires_at
        ) VALUES ($1, $2, 'held', $3, $4, $5, $6, $7, $8)
        RETURNING *`,
        [
          host.id,
          eventType.id,
          slotStart.toISOString(),
          slotEnd.toISOString(),
          bufferedStart.toISOString(),
          bufferedEnd.toISOString(),
          holdToken,
          holdExpiresAt.toISOString(),
        ]
      );

      const holdBooking = insertRes.rows[0];

      const responsePayload = {
        id: holdBooking.id,
        hold_token: holdBooking.hold_token,
        status: holdBooking.status,
        slot_start: holdBooking.slot_start,
        slot_end: holdBooking.slot_end,
        hold_expires_at: holdBooking.hold_expires_at,
        event: {
          id: eventType.id,
          title: eventType.title,
          slug: eventType.slug,
          duration_minutes: eventType.duration_minutes,
        },
        host: {
          name: host.name,
          slug: host.slug,
          timezone: host.timezone,
        },
      };

      // 11. Record idempotency key if provided
      if (idempotencyKey) {
        await client.query(
          `INSERT INTO idempotency_keys (key, request_path, request_hash, response_status, response_body, expires_at)
           VALUES ($1, $2, $3, $4, $5, NOW() + INTERVAL '24 hours')
           ON CONFLICT (key) DO NOTHING`,
          [
            idempotencyKey,
            '/api/holds',
            crypto.createHash('sha256').update(`${hostSlug}:${eventSlug}:${slotStartStr}:${slotEndStr}`).digest('hex'),
            201,
            JSON.stringify(responsePayload),
          ]
        );
      }

      return {
        fromCache: false,
        status: 201,
        data: responsePayload,
      };
    });

    return result;
  }

  /**
   * Confirms a held slot with guest details.
   * Atomically transitions booking from 'held' to 'confirmed'.
   * Generates private booking management token.
   * Emits notification into transactional outbox.
   */
  static async confirmHold({
    holdIdentifier,
    guestName,
    guestEmail,
    guestNotes = '',
  }: ConfirmHoldParams) {
    if (!guestName || !guestName.trim()) {
      throw new BookingError('Guest name is required', 400, 'MISSING_NAME');
    }
    if (!guestEmail || !guestEmail.includes('@')) {
      throw new BookingError('Valid guest email is required', 400, 'INVALID_EMAIL');
    }

    return await withTransaction(async (client) => {
      // 1. Fetch and row-lock the booking
      const res = await client.query<
        Booking & {
          event_title: string;
          duration_minutes: number;
          host_name: string;
          host_email: string;
          host_slug: string;
          host_timezone: string;
        }
      >(
        `SELECT b.*, e.title as event_title, e.duration_minutes,
                h.name as host_name, h.email as host_email, h.slug as host_slug, h.timezone as host_timezone
         FROM bookings b
         JOIN event_types e ON b.event_type_id = e.id
         JOIN hosts h ON b.host_id = h.id
         WHERE (b.id::text = $1 OR b.hold_token = $1)
         FOR UPDATE`,
        [holdIdentifier]
      );

      if (res.rowCount === 0) {
        throw new BookingError('Hold not found', 404, 'HOLD_NOT_FOUND');
      }

      const booking = res.rows[0];

      // 2. Validate booking status
      if (booking.status === 'confirmed') {
        throw new BookingError('This booking is already confirmed', 409, 'ALREADY_CONFIRMED');
      }
      if (booking.status === 'cancelled') {
        throw new BookingError('This hold was cancelled', 409, 'HOLD_CANCELLED');
      }
      if (booking.status === 'expired') {
        throw new BookingError('This hold has expired', 410, 'HOLD_EXPIRED');
      }

      // 3. Verify hold has not expired
      const now = new Date();
      if (!booking.hold_expires_at || isBefore(new Date(booking.hold_expires_at), now)) {
        await client.query('UPDATE bookings SET status = \'expired\' WHERE id = $1', [booking.id]);
        throw new BookingError('The 5-minute hold on this slot has expired. Please select a slot again.', 410, 'HOLD_EXPIRED');
      }

      // 4. Generate secret booking token for guest management link
      const bookingToken = `bk_${crypto.randomUUID().replace(/-/g, '')}`;

      // 5. Update booking to confirmed
      const updateRes = await client.query<Booking>(
        `UPDATE bookings
         SET status = 'confirmed',
             guest_name = $1,
             guest_email = $2,
             guest_notes = $3,
             booking_token = $4,
             confirmed_at = NOW(),
             hold_token = NULL,
             updated_at = NOW()
         WHERE id = $5
         RETURNING *`,
        [guestName.trim(), guestEmail.trim().toLowerCase(), guestNotes?.trim() || null, bookingToken, booking.id]
      );

      const confirmedBooking = updateRes.rows[0];

      // 6. Generate RFC 5545 iCalendar payload
      const icsData = generateICS({
        title: `${booking.event_title} with ${booking.host_name}`,
        description: `Booking confirmation for ${booking.event_title}.\nManage link: /manage/${bookingToken}`,
        start: new Date(confirmedBooking.slot_start),
        end: new Date(confirmedBooking.slot_end),
        organizerName: booking.host_name,
        organizerEmail: booking.host_email,
        attendeeName: guestName.trim(),
        attendeeEmail: guestEmail.trim(),
        status: 'CONFIRMED',
        method: 'REQUEST',
      });

      // 7. Emit BOOKING_CONFIRMED notification inside transactional outbox
      await emitNotification({
        bookingId: confirmedBooking.id,
        eventType: 'BOOKING_CONFIRMED',
        recipientEmail: guestEmail.trim().toLowerCase(),
        subject: `Confirmed: ${booking.event_title} with ${booking.host_name}`,
        payload: {
          bookingId: confirmedBooking.id,
          bookingToken,
          guestName: guestName.trim(),
          guestEmail: guestEmail.trim().toLowerCase(),
          hostName: booking.host_name,
          hostEmail: booking.host_email,
          eventTitle: booking.event_title,
          slotStart: confirmedBooking.slot_start,
          slotEnd: confirmedBooking.slot_end,
          ics: icsData,
        },
        client,
      });

      // 8. Schedule 24-hour and 1-hour reminders
      const slotStartTime = new Date(confirmedBooking.slot_start).getTime();
      const reminder24h = new Date(slotStartTime - 24 * 60 * 60 * 1000);
      const reminder1h = new Date(slotStartTime - 60 * 60 * 1000);

      if (isAfter(reminder24h, now)) {
        await emitNotification({
          bookingId: confirmedBooking.id,
          eventType: 'REMINDER_24H',
          recipientEmail: guestEmail.trim().toLowerCase(),
          subject: `Reminder: ${booking.event_title} tomorrow at ${confirmedBooking.slot_start}`,
          payload: { bookingId: confirmedBooking.id, slotStart: confirmedBooking.slot_start },
          scheduledFor: reminder24h,
          client,
        });
      }

      if (isAfter(reminder1h, now)) {
        await emitNotification({
          bookingId: confirmedBooking.id,
          eventType: 'REMINDER_1H',
          recipientEmail: guestEmail.trim().toLowerCase(),
          subject: `Reminder: ${booking.event_title} in 1 hour`,
          payload: { bookingId: confirmedBooking.id, slotStart: confirmedBooking.slot_start },
          scheduledFor: reminder1h,
          client,
        });
      }

      return {
        id: confirmedBooking.id,
        status: confirmedBooking.status,
        booking_token: confirmedBooking.booking_token,
        slot_start: confirmedBooking.slot_start,
        slot_end: confirmedBooking.slot_end,
        guest_name: confirmedBooking.guest_name,
        guest_email: confirmedBooking.guest_email,
        confirmed_at: confirmedBooking.confirmed_at,
        manage_url: `/manage/${bookingToken}`,
        event: {
          title: booking.event_title,
          duration_minutes: booking.duration_minutes,
        },
        host: {
          name: booking.host_name,
          email: booking.host_email,
          timezone: booking.host_timezone,
        },
      };
    });
  }

  /**
   * Reschedules an existing confirmed booking to a new slot.
   * Atomically verifies availability of new slot and moves booking.
   */
  static async rescheduleBooking({
    bookingToken,
    newSlotStart: newSlotStartStr,
    newSlotEnd: newSlotEndStr,
  }: RescheduleParams) {
    const newSlotStart = new Date(newSlotStartStr);
    const newSlotEnd = new Date(newSlotEndStr);

    if (isNaN(newSlotStart.getTime()) || isNaN(newSlotEnd.getTime()) || !isBefore(newSlotStart, newSlotEnd)) {
      throw new BookingError('Invalid new slot time range', 400, 'INVALID_TIME_RANGE');
    }

    return await withTransaction(async (client) => {
      // 1. Fetch and lock existing booking
      const res = await client.query<
        Booking & {
          event_title: string;
          duration_minutes: number;
          capacity: number;
          buffer_before_minutes: number;
          buffer_after_minutes: number;
          min_notice_hours: number;
          booking_horizon_days: number;
          host_name: string;
          host_email: string;
          host_timezone: string;
        }
      >(
        `SELECT b.*, e.title as event_title, e.duration_minutes, e.capacity,
                e.buffer_before_minutes, e.buffer_after_minutes, e.min_notice_hours, e.booking_horizon_days,
                h.name as host_name, h.email as host_email, h.timezone as host_timezone
         FROM bookings b
         JOIN event_types e ON b.event_type_id = e.id
         JOIN hosts h ON b.host_id = h.id
         WHERE b.booking_token = $1
         FOR UPDATE`,
        [bookingToken]
      );

      if (res.rowCount === 0) {
        throw new BookingError('Booking not found', 404, 'BOOKING_NOT_FOUND');
      }

      const booking = res.rows[0];

      if (booking.status !== 'confirmed') {
        throw new BookingError('Only confirmed bookings can be rescheduled', 400, 'INVALID_STATUS');
      }

      // 2. Lock host
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`host_lock_${booking.host_id}`]);

      // 3. Validate new duration
      const durationMs = newSlotEnd.getTime() - newSlotStart.getTime();
      if (durationMs !== booking.duration_minutes * 60 * 1000) {
        throw new BookingError(
          `New slot duration must be ${booking.duration_minutes} minutes`,
          400,
          'INVALID_DURATION'
        );
      }

      // 4. Validate notice and horizon
      const now = new Date();
      if (isBefore(newSlotStart, addMinutes(now, booking.min_notice_hours * 60))) {
        throw new BookingError(
          `New slot must be at least ${booking.min_notice_hours} hours in advance`,
          400,
          'MINIMUM_NOTICE_VIOLATION'
        );
      }

      if (isAfter(newSlotEnd, addDays(now, booking.booking_horizon_days))) {
        throw new BookingError(
          `New slot cannot exceed ${booking.booking_horizon_days}-day horizon`,
          400,
          'HORIZON_VIOLATION'
        );
      }

      // 5. Calculate new buffered window
      const newBufferedStart = addMinutes(newSlotStart, -booking.buffer_before_minutes);
      const newBufferedEnd = addMinutes(newSlotEnd, booking.buffer_after_minutes);

      // 6. Check conflicts excluding this booking's own ID
      const conflictsRes = await client.query<{
        id: string;
        event_type_id: string;
        slot_start: Date;
        slot_end: Date;
      }>(
        `SELECT id, event_type_id, slot_start, slot_end
         FROM bookings
         WHERE host_id = $1
           AND id != $2
           AND (status = 'confirmed' OR (status = 'held' AND hold_expires_at > NOW()))
           AND buffered_start < $3
           AND buffered_end > $4`,
        [booking.host_id, booking.id, newBufferedEnd.toISOString(), newBufferedStart.toISOString()]
      );

      const conflicts = conflictsRes.rows;

      if (booking.capacity === 1) {
        if (conflicts.length > 0) {
          throw new BookingError('The requested new slot is not available', 409, 'SLOT_UNAVAILABLE');
        }
      } else {
        let sameSlotCount = 0;
        for (const conf of conflicts) {
          const isSameSlot =
            conf.event_type_id === booking.event_type_id &&
            new Date(conf.slot_start).getTime() === newSlotStart.getTime() &&
            new Date(conf.slot_end).getTime() === newSlotEnd.getTime();

          if (isSameSlot) {
            sameSlotCount++;
          } else {
            throw new BookingError('The requested new slot conflicts with another event', 409, 'SLOT_UNAVAILABLE');
          }
        }
        if (sameSlotCount >= booking.capacity) {
          throw new BookingError('The requested new slot is fully booked', 409, 'SLOT_CAPACITY_REACHED');
        }
      }

      const previousStart = booking.slot_start;
      const previousEnd = booking.slot_end;

      // 7. Update booking
      const updateRes = await client.query<Booking>(
        `UPDATE bookings
         SET slot_start = $1,
             slot_end = $2,
             buffered_start = $3,
             buffered_end = $4,
             updated_at = NOW()
         WHERE id = $5
         RETURNING *`,
        [
          newSlotStart.toISOString(),
          newSlotEnd.toISOString(),
          newBufferedStart.toISOString(),
          newBufferedEnd.toISOString(),
          booking.id,
        ]
      );

      const updatedBooking = updateRes.rows[0];

      // 8. Generate updated iCalendar RFC 5545
      const icsData = generateICS({
        title: `${booking.event_title} with ${booking.host_name}`,
        description: `Rescheduled booking.\nManage link: /manage/${bookingToken}`,
        start: newSlotStart,
        end: newSlotEnd,
        organizerName: booking.host_name,
        organizerEmail: booking.host_email,
        attendeeName: booking.guest_name || 'Guest',
        attendeeEmail: booking.guest_email || '',
        sequence: 1,
        status: 'CONFIRMED',
        method: 'REQUEST',
      });

      // 9. Emit notification
      await emitNotification({
        bookingId: booking.id,
        eventType: 'BOOKING_RESCHEDULED',
        recipientEmail: booking.guest_email!,
        subject: `Rescheduled: ${booking.event_title} with ${booking.host_name}`,
        payload: {
          bookingId: booking.id,
          bookingToken,
          previousStart,
          previousEnd,
          newSlotStart: updatedBooking.slot_start,
          newSlotEnd: updatedBooking.slot_end,
          ics: icsData,
        },
        client,
      });

      // 10. Update scheduled reminders for new time
      await client.query(
        `DELETE FROM notifications
         WHERE booking_id = $1 AND status = 'pending' AND event_type IN ('REMINDER_24H', 'REMINDER_1H')`,
        [booking.id]
      );

      const slotStartTime = newSlotStart.getTime();
      const reminder24h = new Date(slotStartTime - 24 * 60 * 60 * 1000);
      const reminder1h = new Date(slotStartTime - 60 * 60 * 1000);

      if (isAfter(reminder24h, now)) {
        await emitNotification({
          bookingId: booking.id,
          eventType: 'REMINDER_24H',
          recipientEmail: booking.guest_email!,
          subject: `Reminder: ${booking.event_title} tomorrow`,
          payload: { bookingId: booking.id, slotStart: updatedBooking.slot_start },
          scheduledFor: reminder24h,
          client,
        });
      }

      if (isAfter(reminder1h, now)) {
        await emitNotification({
          bookingId: booking.id,
          eventType: 'REMINDER_1H',
          recipientEmail: booking.guest_email!,
          subject: `Reminder: ${booking.event_title} in 1 hour`,
          payload: { bookingId: booking.id, slotStart: updatedBooking.slot_start },
          scheduledFor: reminder1h,
          client,
        });
      }

      return {
        id: updatedBooking.id,
        status: updatedBooking.status,
        slot_start: updatedBooking.slot_start,
        slot_end: updatedBooking.slot_end,
        booking_token: updatedBooking.booking_token,
        guest_name: updatedBooking.guest_name,
        guest_email: updatedBooking.guest_email,
        updated_at: updatedBooking.updated_at,
      };
    });
  }

  /**
   * Cancels a booking with reason.
   */
  static async cancelBooking({
    bookingTokenOrId,
    reason,
    cancelledBy = 'guest',
  }: CancelParams) {
    if (!reason || !reason.trim()) {
      throw new BookingError('Cancellation reason is required', 400, 'MISSING_REASON');
    }

    return await withTransaction(async (client) => {
      // 1. Fetch and lock booking
      const res = await client.query<
        Booking & {
          event_title: string;
          host_name: string;
          host_email: string;
        }
      >(
        `SELECT b.*, e.title as event_title, h.name as host_name, h.email as host_email
         FROM bookings b
         JOIN event_types e ON b.event_type_id = e.id
         JOIN hosts h ON b.host_id = h.id
         WHERE (b.booking_token = $1 OR b.id::text = $1)
         FOR UPDATE`,
        [bookingTokenOrId]
      );

      if (res.rowCount === 0) {
        throw new BookingError('Booking not found', 404, 'BOOKING_NOT_FOUND');
      }

      const booking = res.rows[0];

      if (booking.status === 'cancelled') {
        return {
          id: booking.id,
          status: 'cancelled',
          cancellation_reason: booking.cancellation_reason,
          cancelled_at: booking.cancelled_at,
          alreadyCancelled: true,
        };
      }

      if (booking.status === 'expired') {
        throw new BookingError('Expired holds cannot be cancelled', 400, 'CANNOT_CANCEL_EXPIRED');
      }

      // 2. Mark as cancelled
      const updateRes = await client.query<Booking>(
        `UPDATE bookings
         SET status = 'cancelled',
             cancellation_reason = $1,
             cancelled_at = NOW(),
             updated_at = NOW()
         WHERE id = $2
         RETURNING *`,
        [reason.trim(), booking.id]
      );

      const cancelledBooking = updateRes.rows[0];

      // 3. Cancel pending reminders
      await client.query(
        `DELETE FROM notifications
         WHERE booking_id = $1 AND status = 'pending'`,
        [booking.id]
      );

      // 4. Generate cancellation .ics
      const icsData = generateICS({
        title: `${booking.event_title} with ${booking.host_name}`,
        description: `Booking cancelled: ${reason.trim()}`,
        start: new Date(booking.slot_start),
        end: new Date(booking.slot_end),
        organizerName: booking.host_name,
        organizerEmail: booking.host_email,
        attendeeName: booking.guest_name || 'Guest',
        attendeeEmail: booking.guest_email || '',
        status: 'CANCELLED',
        method: 'CANCEL',
        sequence: 2,
      });

      // 5. Emit cancellation notification
      if (booking.guest_email) {
        await emitNotification({
          bookingId: booking.id,
          eventType: 'BOOKING_CANCELLED',
          recipientEmail: booking.guest_email,
          subject: `Cancelled: ${booking.event_title} with ${booking.host_name}`,
          payload: {
            bookingId: booking.id,
            cancelledBy,
            reason: reason.trim(),
            slotStart: booking.slot_start,
            slotEnd: booking.slot_end,
            ics: icsData,
          },
          client,
        });
      }

      // 6. Check waitlist for this slot (Waitlist Extension)
      const waitlistRes = await client.query<{
        id: string;
        guest_name: string;
        guest_email: string;
      }>(
        `SELECT id, guest_name, guest_email
         FROM waitlists
         WHERE event_type_id = $1
           AND slot_start = $2
           AND slot_end = $3
           AND status = 'waiting'
         ORDER BY created_at ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED`,
        [booking.event_type_id, booking.slot_start, booking.slot_end]
      );

      if (waitlistRes.rowCount && waitlistRes.rowCount > 0) {
        const waitlistEntry = waitlistRes.rows[0];
        // Offer slot for 15 minutes
        await client.query(
          `UPDATE waitlists
           SET status = 'offered', offer_expires_at = NOW() + INTERVAL '15 minutes'
           WHERE id = $1`,
          [waitlistEntry.id]
        );

        console.log(`🔔 [WAITLIST OFFER] Offered slot ${booking.slot_start} to waitlisted guest: ${waitlistEntry.guest_email}`);
      }

      return {
        id: cancelledBooking.id,
        status: cancelledBooking.status,
        cancellation_reason: cancelledBooking.cancellation_reason,
        cancelled_at: cancelledBooking.cancelled_at,
        alreadyCancelled: false,
      };
    });
  }
}
