import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/db';
import { Host } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const hostSlug = req.headers.get('x-host-slug') || searchParams.get('host') || 'alex';
    const statusFilter = searchParams.get('status'); // optional filter: confirmed, held, cancelled

    const hostRes = await pool.query<Host>('SELECT id FROM hosts WHERE slug = $1', [hostSlug]);
    if (hostRes.rowCount === 0) {
      return NextResponse.json({ error: 'Host not found' }, { status: 404 });
    }
    const hostId = hostRes.rows[0].id;

    let queryText = `
      SELECT b.*,
             e.title as event_title,
             e.slug as event_slug,
             e.duration_minutes,
             e.capacity
      FROM bookings b
      JOIN event_types e ON b.event_type_id = e.id
      WHERE b.host_id = $1
    `;
    const params: any[] = [hostId];

    if (statusFilter) {
      queryText += ' AND b.status = $2';
      params.push(statusFilter);
    } else {
      // By default show active confirmed and held bookings
      queryText += " AND b.status IN ('confirmed', 'held', 'cancelled')";
    }

    queryText += ' ORDER BY b.slot_start ASC';

    const res = await pool.query(queryText, params);

    return NextResponse.json(res.rows);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
