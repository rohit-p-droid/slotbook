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
  const bookingId = params.id;

  try {
    const body = await req.json();
    const reason = body.reason;

    if (!reason || !reason.trim()) {
      return NextResponse.json({ error: 'Cancellation reason is required' }, { status: 400 });
    }

    const result = await BookingEngine.cancelBooking({
      bookingTokenOrId: bookingId,
      reason: reason.trim(),
      cancelledBy: 'host',
    });

    logger.info('Host cancelled booking', {
      requestId,
      method: 'POST',
      path: req.nextUrl.pathname,
      statusCode: 200,
      bookingId,
      reason,
    });

    return NextResponse.json(result, {
      status: 200,
      headers: { 'x-request-id': requestId },
    });
  } catch (error: any) {
    const statusCode = error instanceof BookingError ? error.statusCode : 500;
    logger.error('Host cancellation failed', error, { requestId, statusCode });

    return NextResponse.json(
      { error: error.message || 'Failed to cancel booking', code: error.code || 'INTERNAL_ERROR' },
      { status: statusCode, headers: { 'x-request-id': requestId } }
    );
  }
}
