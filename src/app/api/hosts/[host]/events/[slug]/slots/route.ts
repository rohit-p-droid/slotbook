import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/db';
import { generateAvailableSlots } from '@/lib/slots';
import { Host, EventType } from '@/lib/types';
import { checkRateLimit } from '@/lib/rate-limiter';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: { host: string; slug: string } }
) {
  const start = Date.now();
  const requestId = req.headers.get('x-request-id') || crypto.randomUUID();
  const ip = req.headers.get('x-forwarded-for') || '127.0.0.1';

  // Abuse protection / rate limiting
  const rateLimit = checkRateLimit(`slots:${ip}`, 120, 60000);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Too many requests. Please try again later.' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(rateLimit.resetMs / 1000)) } }
    );
  }

  try {
    const { host: hostSlug, slug: eventSlug } = params;
    const { searchParams } = new URL(req.url);

    const from = searchParams.get('from') || undefined;
    const to = searchParams.get('to') || undefined;
    const tz = searchParams.get('tz') || 'UTC';

    // Fetch host
    const hostRes = await pool.query<Host>(
      'SELECT * FROM hosts WHERE slug = $1',
      [hostSlug]
    );

    if (hostRes.rowCount === 0) {
      return NextResponse.json({ error: `Host '@${hostSlug}' not found` }, { status: 404 });
    }
    const host = hostRes.rows[0];

    // Fetch event type
    const eventRes = await pool.query<EventType>(
      'SELECT * FROM event_types WHERE host_id = $1 AND slug = $2 AND is_active = TRUE',
      [host.id, eventSlug]
    );

    if (eventRes.rowCount === 0) {
      return NextResponse.json({ error: `Event '${eventSlug}' not found for this host` }, { status: 404 });
    }
    const eventType = eventRes.rows[0];

    // Generate slots
    const slots = await generateAvailableSlots({
      host,
      eventType,
      from,
      to,
      guestTimeZone: tz,
    });

    const durationMs = Date.now() - start;
    logger.info('Generated available slots', {
      requestId,
      method: 'GET',
      path: req.nextUrl.pathname,
      statusCode: 200,
      durationMs,
      hostSlug,
      eventSlug,
      tz,
      slotsCount: slots.length,
    });

    return NextResponse.json({
      host: {
        id: host.id,
        name: host.name,
        slug: host.slug,
        timezone: host.timezone,
      },
      event: {
        id: eventType.id,
        title: eventType.title,
        slug: eventType.slug,
        description: eventType.description,
        duration_minutes: eventType.duration_minutes,
        capacity: eventType.capacity,
        min_notice_hours: eventType.min_notice_hours,
        booking_horizon_days: eventType.booking_horizon_days,
      },
      timezone: tz,
      slots,
    }, {
      headers: {
        'x-request-id': requestId,
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    });
  } catch (error: any) {
    logger.error('Failed to generate slots', error, { requestId });
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
