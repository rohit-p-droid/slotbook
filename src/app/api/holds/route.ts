import { NextRequest, NextResponse } from 'next/server';
import { BookingEngine, BookingError } from '@/lib/booking-engine';
import { checkHoldSpam } from '@/lib/rate-limiter';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const start = Date.now();
  const requestId = req.headers.get('x-request-id') || crypto.randomUUID();
  const idempotencyKey = req.headers.get('idempotency-key') || req.headers.get('x-idempotency-key') || null;
  const ip = req.headers.get('x-forwarded-for') || '127.0.0.1';

  // Anti-abuse check
  const allowed = await checkHoldSpam(ip);
  if (!allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded: Too many hold requests created from this IP.' },
      { status: 429 }
    );
  }

  try {
    const body = await req.json();
    const hostSlug = body.host_slug || body.host;
    const eventSlug = body.event_slug || body.slug || body.event;
    const slotStart = body.slot_start;
    const slotEnd = body.slot_end;

    if (!hostSlug || !eventSlug || !slotStart || !slotEnd) {
      return NextResponse.json(
        { error: 'Missing required fields: host_slug, event_slug, slot_start, slot_end' },
        { status: 400 }
      );
    }

    const result = await BookingEngine.holdSlot({
      hostSlug,
      eventSlug,
      slotStart,
      slotEnd,
      idempotencyKey,
    });

    const durationMs = Date.now() - start;
    logger.info('Slot hold processed', {
      requestId,
      method: 'POST',
      path: '/api/holds',
      statusCode: result.status,
      durationMs,
      cached: result.fromCache,
      hostSlug,
      eventSlug,
    });

    return NextResponse.json(result.data, {
      status: result.status,
      headers: {
        'x-request-id': requestId,
        ...(result.fromCache ? { 'x-cache': 'HIT' } : {}),
      },
    });
  } catch (error: any) {
    const statusCode = error instanceof BookingError ? error.statusCode : 500;
    logger.error('Slot hold failed', error, { requestId, statusCode });

    return NextResponse.json(
      {
        error: error.message || 'Failed to hold slot',
        code: error.code || 'INTERNAL_ERROR',
      },
      { status: statusCode, headers: { 'x-request-id': requestId } }
    );
  }
}
