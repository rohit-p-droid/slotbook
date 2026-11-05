import { NextRequest, NextResponse } from 'next/server';
import { pool, withTransaction } from '@/db';
import { Host, HostAvailability } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const hostSlug = req.headers.get('x-host-slug') || searchParams.get('host') || 'alex';

    const hostRes = await pool.query<Host>('SELECT id FROM hosts WHERE slug = $1', [hostSlug]);
    if (hostRes.rowCount === 0) {
      return NextResponse.json({ error: 'Host not found' }, { status: 404 });
    }

    const res = await pool.query<HostAvailability>(
      'SELECT * FROM host_availabilities WHERE host_id = $1 ORDER BY day_of_week ASC, start_time ASC',
      [hostRes.rows[0].id]
    );

    return NextResponse.json(res.rows);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const hostSlug = req.headers.get('x-host-slug') || searchParams.get('host') || 'alex';
    const body = await req.json();

    const hostRes = await pool.query<Host>('SELECT id FROM hosts WHERE slug = $1', [hostSlug]);
    if (hostRes.rowCount === 0) {
      return NextResponse.json({ error: 'Host not found' }, { status: 404 });
    }
    const hostId = hostRes.rows[0].id;

    const windows: Array<{ day_of_week: number; start_time: string; end_time: string }> = body.windows || [];

    await withTransaction(async (client) => {
      await client.query('DELETE FROM host_availabilities WHERE host_id = $1', [hostId]);

      for (const win of windows) {
        if (win.day_of_week < 0 || win.day_of_week > 6) continue;
        await client.query(
          `INSERT INTO host_availabilities (host_id, day_of_week, start_time, end_time)
           VALUES ($1, $2, $3, $4)`,
          [hostId, win.day_of_week, win.start_time, win.end_time]
        );
      }
    });

    const updated = await pool.query<HostAvailability>(
      'SELECT * FROM host_availabilities WHERE host_id = $1 ORDER BY day_of_week ASC, start_time ASC',
      [hostId]
    );

    return NextResponse.json(updated.rows);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
