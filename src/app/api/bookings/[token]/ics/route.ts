import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/db';
import { generateICS } from '@/lib/ics';

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
              h.name as host_name,
              h.email as host_email
       FROM bookings b
       JOIN event_types e ON b.event_type_id = e.id
       JOIN hosts h ON b.host_id = h.id
       WHERE b.booking_token = $1`,
      [bookingToken]
    );

    if (res.rowCount === 0) {
      return new NextResponse('Booking not found', { status: 404 });
    }

    const booking = res.rows[0];

    const icsContent = generateICS({
      title: `${booking.event_title} with ${booking.host_name}`,
      description: `Slotbook Appointment: ${booking.event_title}.\nGuest: ${booking.guest_name} (${booking.guest_email})`,
      start: new Date(booking.slot_start),
      end: new Date(booking.slot_end),
      organizerName: booking.host_name,
      organizerEmail: booking.host_email,
      attendeeName: booking.guest_name || 'Guest',
      attendeeEmail: booking.guest_email || '',
      status: booking.status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED',
      method: booking.status === 'cancelled' ? 'CANCEL' : 'REQUEST',
    });

    return new NextResponse(icsContent, {
      status: 200,
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': `attachment; filename="invite-${bookingToken}.ics"`,
      },
    });
  } catch (error: any) {
    return new NextResponse(error.message || 'Error generating calendar file', { status: 500 });
  }
}
