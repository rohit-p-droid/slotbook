-- Performance Indexes

-- Quick lookup for host and event by slug
CREATE INDEX IF NOT EXISTS idx_hosts_slug ON hosts(slug);
CREATE INDEX IF NOT EXISTS idx_event_types_host_slug ON event_types(host_id, slug);

-- Quick lookup for host availabilities and overrides
CREATE INDEX IF NOT EXISTS idx_host_availabilities_lookup ON host_availabilities(host_id, day_of_week);
CREATE INDEX IF NOT EXISTS idx_host_overrides_lookup ON host_overrides(host_id, override_date);

-- Bookings lookup by tokens
CREATE INDEX IF NOT EXISTS idx_bookings_hold_token ON bookings(hold_token) WHERE hold_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bookings_booking_token ON bookings(booking_token) WHERE booking_token IS NOT NULL;

-- Fast overlap query index for host's active bookings and holds using GiST and range
CREATE INDEX IF NOT EXISTS idx_bookings_host_buffered_range ON bookings USING gist (
  host_id,
  tstzrange(buffered_start, buffered_end, '[)')
);

-- Fast capacity check for same slot on event
CREATE INDEX IF NOT EXISTS idx_bookings_event_slot ON bookings(event_type_id, slot_start, slot_end)
  WHERE status IN ('held', 'confirmed');

-- Hold expiration index
CREATE INDEX IF NOT EXISTS idx_bookings_active_holds ON bookings(status, hold_expires_at)
  WHERE status = 'held';

-- Notification outbox index
CREATE INDEX IF NOT EXISTS idx_notifications_pending ON notifications(status, scheduled_for)
  WHERE status = 'pending';
