import { NextRequest, NextResponse } from 'next/server';
import { BookingEngine, BookingError } from '@/lib/booking-engine';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  { params }: { params: { token: string } }
) {
  const start = Date.now();
  const requestId = req.headers.get('x-request-id') || crypto.randomUUID();
  const bookingToken = params.token;

  try {
    const body = await req.json();
    const newSlotStart = body.new_slot_start || body.slot_start;
    const newSlotEnd = body.new_slot_end || body.slot_end;

    if (!newSlotStart || !newSlotEnd) {
      return NextResponse.json(
        { error: 'new_slot_start and new_slot_end are required' },
        { status: 400 }
      );
    }

    const updated = await BookingEngine.rescheduleBooking({
      bookingToken,
      newSlotStart,
      newSlotEnd,
    });

    const durationMs = Date.now() - start;
    logger.info('Booking rescheduled', {
      requestId,
      method: 'POST',
      path: req.nextUrl.pathname,
      statusCode: 200,
      durationMs,
      bookingId: updated.id,
      newSlotStart: updated.slot_start,
    });

    return NextResponse.json(updated, {
      status: 200,
      headers: { 'x-request-id': requestId },
    });
  } catch (error: any) {
    const statusCode = error instanceof BookingError ? error.statusCode : 500;
    logger.error('Reschedule failed', error, { requestId, statusCode });

    return NextResponse.json(
      {
        error: error.message || 'Failed to reschedule booking',
        code: error.code || 'INTERNAL_ERROR',
      },
      { status: statusCode, headers: { 'x-request-id': requestId } }
    );
  }
}
