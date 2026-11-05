import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/db';
import { EventType } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const eventId = params.id;
    const body = await req.json();

    const {
      title,
      description,
      duration_minutes,
      capacity,
      buffer_before_minutes,
      buffer_after_minutes,
      min_notice_hours,
      booking_horizon_days,
      is_active,
    } = body;

    const res = await pool.query<EventType>(
      `UPDATE event_types
       SET title = COALESCE($1, title),
           description = COALESCE($2, description),
           duration_minutes = COALESCE($3, duration_minutes),
           capacity = COALESCE($4, capacity),
           buffer_before_minutes = COALESCE($5, buffer_before_minutes),
           buffer_after_minutes = COALESCE($6, buffer_after_minutes),
           min_notice_hours = COALESCE($7, min_notice_hours),
           booking_horizon_days = COALESCE($8, booking_horizon_days),
           is_active = COALESCE($9, is_active),
           updated_at = NOW()
       WHERE id = $10
       RETURNING *`,
      [
        title,
        description,
        duration_minutes,
        capacity,
        buffer_before_minutes,
        buffer_after_minutes,
        min_notice_hours,
        booking_horizon_days,
        is_active,
        eventId,
      ]
    );

    if (res.rowCount === 0) {
      return NextResponse.json({ error: 'Event type not found' }, { status: 404 });
    }

    return NextResponse.json(res.rows[0]);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
