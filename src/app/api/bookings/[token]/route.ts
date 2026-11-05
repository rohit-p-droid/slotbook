import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/db';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: { token: string } }
) {
  try {
    const bookingToken = params.token;

    const res = await pool.query(
      `SELECT b.*,
              e.title as event_title,
              e.slug as event_slug,
              e.duration_minutes,
              e.capacity,
              h.name as host_name,
              h.slug as host_slug,
              h.email as host_email,
              h.timezone as host_timezone
       FROM bookings b
       JOIN event_types e ON b.event_type_id = e.id
       JOIN hosts h ON b.host_id = h.id
       WHERE b.booking_token = $1`,
      [bookingToken]
    );

    if (res.rowCount === 0) {
      return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
    }

    const booking = res.rows[0];

    return NextResponse.json({
      id: booking.id,
      status: booking.status,
      booking_token: booking.booking_token,
      slot_start: booking.slot_start,
      slot_end: booking.slot_end,
      guest_name: booking.guest_name,
      guest_email: booking.guest_email,
      guest_notes: booking.guest_notes,
      cancellation_reason: booking.cancellation_reason,
      cancelled_at: booking.cancelled_at,
      confirmed_at: booking.confirmed_at,
      event: {
        title: booking.event_title,
        slug: booking.event_slug,
        duration_minutes: booking.duration_minutes,
        capacity: booking.capacity,
      },
      host: {
        name: booking.host_name,
        slug: booking.host_slug,
        email: booking.host_email,
        timezone: booking.host_timezone,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
