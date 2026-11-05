import { NextResponse } from 'next/server';
import { pool } from '@/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const [bookingsCountRes, notificationsRes, holdStatsRes] = await Promise.all([
      pool.query(`
        SELECT status, COUNT(*)::int as count
        FROM bookings
        GROUP BY status
      `),
      pool.query(`
        SELECT status, COUNT(*)::int as count
        FROM notifications
        GROUP BY status
      `),
      pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE status = 'held' AND hold_expires_at > NOW())::int as active_holds,
          COUNT(*) FILTER (WHERE status = 'held' AND hold_expires_at <= NOW())::int as stale_uncleaned_holds
        FROM bookings
      `),
    ]);

    const bookingsByStatus: Record<string, number> = {};
    for (const row of bookingsCountRes.rows) {
      bookingsByStatus[row.status] = row.count;
    }

    const notificationsByStatus: Record<string, number> = {};
    for (const row of notificationsRes.rows) {
      notificationsByStatus[row.status] = row.count;
    }

    return NextResponse.json({
      timestamp: new Date().toISOString(),
      bookings: {
        total: bookingsCountRes.rows.reduce((acc, r) => acc + r.count, 0),
        by_status: bookingsByStatus,
      },
      holds: {
        active: holdStatsRes.rows[0]?.active_holds || 0,
        stale_uncleaned: holdStatsRes.rows[0]?.stale_uncleaned_holds || 0,
      },
      notifications: {
        pending_outbox_lag: notificationsByStatus['pending'] || 0,
        delivered: notificationsByStatus['delivered'] || 0,
        failed: notificationsByStatus['failed'] || 0,
      },
      system: {
        node_version: process.version,
        memory_usage_mb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
