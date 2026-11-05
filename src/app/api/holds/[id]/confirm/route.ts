import { NextRequest, NextResponse } from 'next/server';
import { BookingEngine, BookingError } from '@/lib/booking-engine';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const start = Date.now();
  const requestId = req.headers.get('x-request-id') || crypto.randomUUID();
  const holdIdentifier = params.id;

  try {
    const body = await req.json();
    const { guest_name, guest_email, guest_notes } = body;

    if (!guest_name || !guest_email) {
      return NextResponse.json(
        { error: 'guest_name and guest_email are required' },
        { status: 400 }
      );
    }

    const booking = await BookingEngine.confirmHold({
      holdIdentifier,
      guestName: guest_name,
      guestEmail: guest_email,
      guestNotes: guest_notes,
    });

    const durationMs = Date.now() - start;
    logger.info('Hold confirmed successfully', {
      requestId,
      method: 'POST',
      path: req.nextUrl.pathname,
      statusCode: 200,
      durationMs,
      bookingId: booking.id,
      guestEmail: booking.guest_email,
    });

    return NextResponse.json(booking, {
      status: 200,
      headers: { 'x-request-id': requestId },
    });
  } catch (error: any) {
    const statusCode = error instanceof BookingError ? error.statusCode : 500;
    logger.error('Hold confirmation failed', error, { requestId, statusCode });

    return NextResponse.json(
      {
        error: error.message || 'Failed to confirm hold',
        code: error.code || 'INTERNAL_ERROR',
      },
      { status: statusCode, headers: { 'x-request-id': requestId } }
    );
  }
}
