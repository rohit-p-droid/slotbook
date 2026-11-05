import crypto from 'crypto';

export interface CalendarEventDetails {
  uid?: string;
  title: string;
  description?: string;
  location?: string;
  start: Date;
  end: Date;
  organizerName: string;
  organizerEmail: string;
  attendeeName: string;
  attendeeEmail: string;
  sequence?: number;
  status?: 'CONFIRMED' | 'CANCELLED';
  method?: 'REQUEST' | 'CANCEL';
}

function formatDateToICS(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

export function generateICS(event: CalendarEventDetails): string {
  const uid = event.uid || `${crypto.randomUUID()}@slotbook.app`;
  const now = formatDateToICS(new Date());
  const dtStart = formatDateToICS(event.start);
  const dtEnd = formatDateToICS(event.end);
  const sequence = event.sequence ?? 0;
  const status = event.status || 'CONFIRMED';
  const method = event.method || (status === 'CANCELLED' ? 'CANCEL' : 'REQUEST');

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Slotbook Inc//Slotbook Booking Engine//EN',
    'CALSCALE:GREGORIAN',
    `METHOD:${method}`,
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${now}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${escapeICS(event.title)}`,
    `DESCRIPTION:${escapeICS(event.description || '')}`,
    `ORGANIZER;CN=${escapeICS(event.organizerName)}:mailto:${event.organizerEmail}`,
    `ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;CN=${escapeICS(event.attendeeName)}:mailto:${event.attendeeEmail}`,
    `STATUS:${status}`,
    `SEQUENCE:${sequence}`,
    'TRANSP:OPAQUE',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}

function escapeICS(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}
