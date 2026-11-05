import { notFound } from 'next/navigation';
import { pool } from '@/db';
import { Host, EventType } from '@/lib/types';
import BookingFlow from '@/components/BookingFlow';

export const dynamic = 'force-dynamic';

export default async function EmbedBookingPage({
  params,
}: {
  params: { host: string; eventSlug: string };
}) {
  const { host: hostSlug, eventSlug } = params;

  const hostRes = await pool.query<Host>('SELECT * FROM hosts WHERE slug = $1', [hostSlug]);
  if (hostRes.rowCount === 0) {
    notFound();
  }
  const host = hostRes.rows[0];

  const eventRes = await pool.query<EventType>(
    'SELECT * FROM event_types WHERE host_id = $1 AND slug = $2 AND is_active = TRUE',
    [host.id, eventSlug]
  );
  if (eventRes.rowCount === 0) {
    notFound();
  }
  const event = eventRes.rows[0];

  return (
    <div className="p-2 bg-transparent">
      <BookingFlow
        isEmbed={true}
        host={{
          id: host.id,
          name: host.name,
          slug: host.slug,
          timezone: host.timezone,
        }}
        event={{
          id: event.id,
          title: event.title,
          slug: event.slug,
          description: event.description || '',
          duration_minutes: event.duration_minutes,
          capacity: event.capacity,
          min_notice_hours: event.min_notice_hours,
          booking_horizon_days: event.booking_horizon_days,
        }}
      />
    </div>
  );
}
