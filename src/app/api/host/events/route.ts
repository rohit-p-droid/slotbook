import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/db';
import { EventType, Host } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const hostSlug = req.headers.get('x-host-slug') || searchParams.get('host') || 'alex';

    const hostRes = await pool.query<Host>('SELECT id FROM hosts WHERE slug = $1', [hostSlug]);
    if (hostRes.rowCount === 0) {
      return NextResponse.json({ error: 'Host not found' }, { status: 404 });
    }

    const res = await pool.query<EventType>(
      'SELECT * FROM event_types WHERE host_id = $1 ORDER BY created_at ASC',
      [hostRes.rows[0].id]
    );

    return NextResponse.json(res.rows);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const hostSlug = req.headers.get('x-host-slug') || searchParams.get('host') || 'alex';
    const body = await req.json();

    const hostRes = await pool.query<Host>('SELECT id FROM hosts WHERE slug = $1', [hostSlug]);
    if (hostRes.rowCount === 0) {
      return NextResponse.json({ error: 'Host not found' }, { status: 404 });
    }
    const hostId = hostRes.rows[0].id;

    const {
      title,
      slug,
      description,
      duration_minutes,
      capacity = 1,
      buffer_before_minutes = 0,
      buffer_after_minutes = 0,
      min_notice_hours = 4,
      booking_horizon_days = 30,
    } = body;

    if (!title || !slug || !duration_minutes) {
      return NextResponse.json(
        { error: 'title, slug, and duration_minutes are required' },
        { status: 400 }
      );
    }

    if (duration_minutes < 15 || duration_minutes > 120) {
      return NextResponse.json(
        { error: 'duration_minutes must be between 15 and 120' },
        { status: 400 }
      );
    }

    const res = await pool.query<EventType>(
      `INSERT INTO event_types (
        host_id, title, slug, description, duration_minutes, capacity,
        buffer_before_minutes, buffer_after_minutes, min_notice_hours, booking_horizon_days
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *`,
      [
        hostId,
        title,
        slug.toLowerCase().trim().replace(/[^a-z0-9-]/g, '-'),
        description || null,
        duration_minutes,
        capacity,
        buffer_before_minutes,
        buffer_after_minutes,
        min_notice_hours,
        booking_horizon_days,
      ]
    );

    return NextResponse.json(res.rows[0], { status: 201 });
  } catch (error: any) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'An event with this slug already exists' }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
