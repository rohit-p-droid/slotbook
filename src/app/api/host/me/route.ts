import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/db';
import { Host } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const hostSlug = req.headers.get('x-host-slug') || searchParams.get('host') || 'alex';

    const res = await pool.query<Host>('SELECT * FROM hosts WHERE slug = $1', [hostSlug]);
    if (res.rowCount === 0) {
      return NextResponse.json({ error: 'Host not found' }, { status: 404 });
    }

    return NextResponse.json(res.rows[0]);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const hostSlug = req.headers.get('x-host-slug') || searchParams.get('host') || 'alex';
    const body = await req.json();

    const { timezone, name, email } = body;

    const res = await pool.query<Host>(
      `UPDATE hosts
       SET timezone = COALESCE($1, timezone),
           name = COALESCE($2, name),
           email = COALESCE($3, email),
           updated_at = NOW()
       WHERE slug = $4
       RETURNING *`,
      [timezone, name, email, hostSlug]
    );

    if (res.rowCount === 0) {
      return NextResponse.json({ error: 'Host not found' }, { status: 404 });
    }

    return NextResponse.json(res.rows[0]);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
