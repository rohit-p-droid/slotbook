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
  const bookingTokenOrId = params.token;

  try {
    const body = await req.json();
    const reason = body.reason || 'Guest cancelled';

    const result = await BookingEngine.cancelBooking({
      bookingTokenOrId,
      reason,
      cancelledBy: 'guest',
    });

    const durationMs = Date.now() - start;
    logger.info('Booking cancelled', {
      requestId,
      method: 'POST',
      path: req.nextUrl.pathname,
      statusCode: 200,
      durationMs,
      bookingId: result.id,
      alreadyCancelled: result.alreadyCancelled,
    });

    return NextResponse.json(result, {
      status: 200,
      headers: { 'x-request-id': requestId },
    });
  } catch (error: any) {
    const statusCode = error instanceof BookingError ? error.statusCode : 500;
    logger.error('Cancellation failed', error, { requestId, statusCode });

    return NextResponse.json(
      {
        error: error.message || 'Failed to cancel booking',
        code: error.code || 'INTERNAL_ERROR',
      },
      { status: statusCode, headers: { 'x-request-id': requestId } }
    );
  }
}
