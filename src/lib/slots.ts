import { addMinutes, addDays, isBefore, isAfter, parseISO } from 'date-fns';
import { fromZonedTime, formatInTimeZone, toZonedTime } from 'date-fns-tz';
import { query } from '@/db';
import { EventType, Host, HostAvailability, HostOverride, Slot } from './types';

export interface GenerateSlotsParams {
  host: Host;
  eventType: EventType;
  from?: string; // ISO string or YYYY-MM-DD
  to?: string;   // ISO string or YYYY-MM-DD
  guestTimeZone: string;
  now?: Date;    // Optional reference clock for deterministic testing
}

interface ActiveBooking {
  id: string;
  event_type_id: string;
  slot_start: Date;
  slot_end: Date;
  buffered_start: Date;
  buffered_end: Date;
  status: string;
}

export async function generateAvailableSlots({
  host,
  eventType,
  from,
  to,
  guestTimeZone = 'UTC',
  now = new Date(),
}: GenerateSlotsParams): Promise<Slot[]> {
  const hostTz = host.timezone || 'UTC';

  // 1. Calculate search window bounds
  // Min notice window
  const minNoticeDate = addMinutes(now, eventType.min_notice_hours * 60);

  // Booking horizon window
  const maxHorizonDate = addDays(now, eventType.booking_horizon_days);

  // Effective start and end bounds in UTC
  const effectiveStartDate = from ? new Date(from) : now;
  const effectiveEndDate = to ? new Date(to) : maxHorizonDate;

  const searchStart = isBefore(effectiveStartDate, minNoticeDate) ? minNoticeDate : effectiveStartDate;
  const searchEnd = isAfter(effectiveEndDate, maxHorizonDate) ? maxHorizonDate : effectiveEndDate;

  if (isAfter(searchStart, searchEnd)) {
    return [];
  }

  // 2. Fetch host weekly availabilities and overrides from DB
  const [availabilitiesRes, overridesRes, bookingsRes] = await Promise.all([
    query<HostAvailability>(
      'SELECT id, host_id, day_of_week, start_time::text as start_time, end_time::text as end_time FROM host_availabilities WHERE host_id = $1 ORDER BY day_of_week, start_time',
      [host.id]
    ),
    query<HostOverride>(
      'SELECT id, host_id, override_date::text as override_date, is_unavailable, start_time::text as start_time, end_time::text as end_time FROM host_overrides WHERE host_id = $1 ORDER BY override_date',
      [host.id]
    ),
    query<ActiveBooking>(
      `SELECT id, event_type_id, slot_start, slot_end, buffered_start, buffered_end, status
       FROM bookings
       WHERE host_id = $1
         AND (status = 'confirmed' OR (status = 'held' AND hold_expires_at > $2))
         AND buffered_end > $3
         AND buffered_start < $4`,
      [host.id, now.toISOString(), searchStart.toISOString(), searchEnd.toISOString()]
    ),
  ]);

  const availabilities = availabilitiesRes.rows;
  const overrides = overridesRes.rows;
  const activeBookings = bookingsRes.rows.map(b => ({
    ...b,
    slot_start: new Date(b.slot_start),
    slot_end: new Date(b.slot_end),
    buffered_start: new Date(b.buffered_start),
    buffered_end: new Date(b.buffered_end),
  }));

  // Map overrides by date string (YYYY-MM-DD in host timezone)
  const overridesByDate = new Map<string, HostOverride[]>();
  for (const override of overrides) {
    const dateStr = String(override.override_date).slice(0, 10);
    const existing = overridesByDate.get(dateStr) || [];
    existing.push(override);
    overridesByDate.set(dateStr, existing);
  }

  // Group availabilities by day_of_week
  const availabilitiesByDay = new Map<number, HostAvailability[]>();
  for (const avail of availabilities) {
    const list = availabilitiesByDay.get(avail.day_of_week) || [];
    list.push(avail);
    availabilitiesByDay.set(avail.day_of_week, list);
  }

  // 3. Iterate through each calendar day in the host's timezone
  const slots: Slot[] = [];

  // Determine starting and ending calendar days in host's local date
  const startLocalZoned = toZonedTime(searchStart, hostTz);
  const endLocalZoned = toZonedTime(searchEnd, hostTz);

  // We walk day by day in host's local calendar
  let currentLocalDay = new Date(startLocalZoned.getFullYear(), startLocalZoned.getMonth(), startLocalZoned.getDate());
  const finalLocalDay = new Date(endLocalZoned.getFullYear(), endLocalZoned.getMonth(), endLocalZoned.getDate() + 1);

  while (isBefore(currentLocalDay, finalLocalDay)) {
    const yyyy = currentLocalDay.getFullYear();
    const mm = String(currentLocalDay.getMonth() + 1).padStart(2, '0');
    const dd = String(currentLocalDay.getDate()).padStart(2, '0');
    const dateString = `${yyyy}-${mm}-${dd}`;
    const dayOfWeek = currentLocalDay.getDay(); // 0 = Sunday, 1 = Monday, ...

    // Check if this date has overrides
    const dateOverrides = overridesByDate.get(dateString);

    let windows: Array<{ start_time: string; end_time: string }> = [];

    if (dateOverrides && dateOverrides.length > 0) {
      const isDayOff = dateOverrides.some(o => o.is_unavailable);
      if (!isDayOff) {
        // Use custom hours from overrides
        windows = dateOverrides
          .filter(o => !o.is_unavailable && o.start_time && o.end_time)
          .map(o => ({ start_time: o.start_time!, end_time: o.end_time! }));
      }
    } else {
      // Use recurring availability for this day of week
      const dayAvail = availabilitiesByDay.get(dayOfWeek) || [];
      windows = dayAvail.map(a => ({ start_time: a.start_time, end_time: a.end_time }));
    }

    // Generate slots for each window on this day
    for (const win of windows) {
      // Construct zoned datetime strings
      const winStartTimeStr = win.start_time.length === 5 ? `${win.start_time}:00` : win.start_time;
      const winEndTimeStr = win.end_time.length === 5 ? `${win.end_time}:00` : win.end_time;

      const windowStartUtc = fromZonedTime(`${dateString}T${winStartTimeStr}`, hostTz);
      const windowEndUtc = fromZonedTime(`${dateString}T${winEndTimeStr}`, hostTz);

      let currentSlotStart = windowStartUtc;

      while (true) {
        const currentSlotEnd = addMinutes(currentSlotStart, eventType.duration_minutes);
        if (isAfter(currentSlotEnd, windowEndUtc)) {
          break;
        }

        // Check if slot falls strictly within search bounds, min notice, and horizon
        if (
          !isBefore(currentSlotStart, searchStart) &&
          !isAfter(currentSlotEnd, searchEnd) &&
          !isBefore(currentSlotStart, minNoticeDate) &&
          !isAfter(currentSlotEnd, maxHorizonDate)
        ) {
          // Calculate buffered boundaries for this candidate slot
          const bufferedStart = addMinutes(currentSlotStart, -eventType.buffer_before_minutes);
          const bufferedEnd = addMinutes(currentSlotEnd, eventType.buffer_after_minutes);

          // Evaluate conflicts with active bookings / holds
          let spotsTaken = 0;
          let hasConflict = false;

          for (const booking of activeBookings) {
            // Overlap condition: booking.buffered_start < candidate.buffered_end AND booking.buffered_end > candidate.buffered_start
            const isOverlapping = isBefore(booking.buffered_start, bufferedEnd) && isAfter(booking.buffered_end, bufferedStart);

            if (isOverlapping) {
              if (eventType.capacity === 1) {
                // Capacity 1: any overlapping active booking/hold makes slot unavailable
                hasConflict = true;
                break;
              } else {
                // Capacity > 1 (group session):
                // If it's the EXACT same slot on the same event type, increment spotsTaken
                const isExactSameSlot =
                  booking.event_type_id === eventType.id &&
                  booking.slot_start.getTime() === currentSlotStart.getTime() &&
                  booking.slot_end.getTime() === currentSlotEnd.getTime();

                if (isExactSameSlot) {
                  spotsTaken++;
                } else {
                  // A different event or misaligned slot overlaps the buffer: host is busy!
                  hasConflict = true;
                  break;
                }
              }
            }
          }

          const spotsRemaining = hasConflict
            ? 0
            : Math.max(0, eventType.capacity - spotsTaken);

          if (spotsRemaining > 0) {
            slots.push({
              slot_start: currentSlotStart.toISOString(),
              slot_end: currentSlotEnd.toISOString(),
              local_date: formatInTimeZone(currentSlotStart, guestTimeZone, 'yyyy-MM-dd'),
              local_start: formatInTimeZone(currentSlotStart, guestTimeZone, 'HH:mm'),
              local_end: formatInTimeZone(currentSlotEnd, guestTimeZone, 'HH:mm'),
              capacity: eventType.capacity,
              spots_remaining: spotsRemaining,
              is_available: true,
            });
          }
        }

        // Advance by slot duration (or standard step)
        currentSlotStart = addMinutes(currentSlotStart, eventType.duration_minutes);
      }
    }

    // Advance to next calendar day
    currentLocalDay = addDays(currentLocalDay, 1);
  }

  return slots;
}
