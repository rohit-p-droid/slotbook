import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/db';
import { Host, HostOverride } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const hostSlug = req.headers.get('x-host-slug') || searchParams.get('host') || 'alex';

    const hostRes = await pool.query<Host>('SELECT id FROM hosts WHERE slug = $1', [hostSlug]);
    if (hostRes.rowCount === 0) {
      return NextResponse.json({ error: 'Host not found' }, { status: 404 });
    }

    const res = await pool.query<HostOverride>(
      'SELECT * FROM host_overrides WHERE host_id = $1 ORDER BY override_date ASC',
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

    const { override_date, is_unavailable, start_time, end_time } = body;

    if (!override_date) {
      return NextResponse.json({ error: 'override_date is required' }, { status: 400 });
    }

    const res = await pool.query<HostOverride>(
      `INSERT INTO host_overrides (host_id, override_date, is_unavailable, start_time, end_time)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [
        hostId,
        override_date,
        Boolean(is_unavailable),
        is_unavailable ? null : start_time || null,
        is_unavailable ? null : end_time || null,
      ]
    );

    return NextResponse.json(res.rows[0], { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
