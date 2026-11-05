export interface Host {
  id: string;
  name: string;
  slug: string;
  email: string;
  timezone: string;
  created_at: string;
  updated_at: string;
}

export interface EventType {
  id: string;
  host_id: string;
  title: string;
  slug: string;
  description: string | null;
  duration_minutes: number;
  capacity: number;
  buffer_before_minutes: number;
  buffer_after_minutes: number;
  min_notice_hours: number;
  booking_horizon_days: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface HostAvailability {
  id: string;
  host_id: string;
  day_of_week: number; // 0=Sunday, 1=Monday, ..., 6=Saturday
  start_time: string;  // HH:MM:SS
  end_time: string;    // HH:MM:SS
}

export interface HostOverride {
  id: string;
  host_id: string;
  override_date: string; // YYYY-MM-DD
  is_unavailable: boolean;
  start_time: string | null; // HH:MM:SS
  end_time: string | null;   // HH:MM:SS
}

export type BookingStatus = 'held' | 'confirmed' | 'cancelled' | 'expired';

export interface Booking {
  id: string;
  host_id: string;
  event_type_id: string;
  status: BookingStatus;
  slot_start: string;
  slot_end: string;
  buffered_start: string;
  buffered_end: string;
  hold_token: string | null;
  hold_expires_at: string | null;
  booking_token: string | null;
  guest_name: string | null;
  guest_email: string | null;
  guest_notes: string | null;
  cancellation_reason: string | null;
  cancelled_at: string | null;
  confirmed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Slot {
  slot_start: string; // ISO 8601 UTC string
  slot_end: string;   // ISO 8601 UTC string
  local_start: string; // Formatted in guest's timezone e.g. "09:00"
  local_end: string;   // Formatted in guest's timezone e.g. "09:30"
  local_date: string;  // Formatted in guest's timezone e.g. "2026-11-06"
  capacity: number;
  spots_remaining: number;
  is_available: boolean;
}

export interface NotificationRecord {
  id: string;
  booking_id: string | null;
  event_type: 'BOOKING_CONFIRMED' | 'BOOKING_RESCHEDULED' | 'BOOKING_CANCELLED' | 'REMINDER_24H' | 'REMINDER_1H';
  recipient_email: string;
  subject: string;
  payload: Record<string, any>;
  status: 'pending' | 'delivered' | 'failed';
  attempts: number;
  last_error: string | null;
  delivered_at: string | null;
  scheduled_for: string;
  created_at: string;
}
