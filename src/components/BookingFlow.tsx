'use client';

import React, { useState, useEffect, useTransition } from 'react';
import { Calendar, Clock, Globe, Shield, ArrowRight, User, Mail, FileText, CheckCircle2, AlertCircle, RefreshCw, Download } from 'lucide-react';
import Link from 'next/link';

interface Slot {
  slot_start: string;
  slot_end: string;
  local_start: string;
  local_end: string;
  local_date: string;
  capacity: number;
  spots_remaining: number;
  is_available: boolean;
}

interface EventData {
  id: string;
  title: string;
  slug: string;
  description: string;
  duration_minutes: number;
  capacity: number;
  min_notice_hours: number;
  booking_horizon_days: number;
}

interface HostData {
  id: string;
  name: string;
  slug: string;
  timezone: string;
}

interface HoldState {
  id: string;
  hold_token: string;
  slot_start: string;
  slot_end: string;
  hold_expires_at: string;
}

interface ConfirmedBooking {
  id: string;
  booking_token: string;
  slot_start: string;
  slot_end: string;
  guest_name: string;
  guest_email: string;
  manage_url: string;
}

const COMMON_TIMEZONES = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Sydney',
];

export default function BookingFlow({
  host,
  event,
  isEmbed = false,
}: {
  host: HostData;
  event: EventData;
  isEmbed?: boolean;
}) {
  const [guestTz, setGuestTz] = useState<string>('UTC');
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Selected date filter
  const [selectedDate, setSelectedDate] = useState<string>('');

  // Active Hold
  const [activeHold, setActiveHold] = useState<HoldState | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number>(300);
  const [isHolding, setIsHolding] = useState<boolean>(false);

  // Form details
  const [guestName, setGuestName] = useState<string>('');
  const [guestEmail, setGuestEmail] = useState<string>('');
  const [guestNotes, setGuestNotes] = useState<string>('');
  const [isConfirming, setIsConfirming] = useState<boolean>(false);

  // Confirmed booking state
  const [confirmedBooking, setConfirmedBooking] = useState<ConfirmedBooking | null>(null);

  // 1. Detect browser timezone
  useEffect(() => {
    try {
      const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (detected) {
        setGuestTz(detected);
      }
    } catch (e) {
      // Default to host timezone or UTC
      setGuestTz(host.timezone || 'UTC');
    }
  }, [host.timezone]);

  // 2. Fetch available slots whenever guestTz changes
  const fetchSlots = async (tz: string) => {
    setLoadingSlots(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/hosts/${host.slug}/events/${event.slug}/slots?tz=${encodeURIComponent(tz)}`, {
        cache: 'no-store',
      });
      if (!res.ok) {
        throw new Error('Failed to load slots');
      }
      const data = await res.json();
      setSlots(data.slots || []);
      if (data.slots && data.slots.length > 0) {
        // Default to first available slot date
        setSelectedDate(data.slots[0].local_date);
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Error loading slots');
    } finally {
      setLoadingSlots(false);
    }
  };

  useEffect(() => {
    fetchSlots(guestTz);
  }, [guestTz, host.slug, event.slug]);

  // 3. 5-minute Hold countdown timer
  useEffect(() => {
    if (!activeHold) return;

    const interval = setInterval(() => {
      const expiry = new Date(activeHold.hold_expires_at).getTime();
      const remaining = Math.max(0, Math.floor((expiry - Date.now()) / 1000));
      setSecondsLeft(remaining);

      if (remaining === 0) {
        clearInterval(interval);
        setActiveHold(null);
        setErrorMsg('Your 5-minute hold expired. The slot has been released back to availability.');
        fetchSlots(guestTz);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [activeHold, guestTz]);

  // 4. Handle Hold creation
  const handleHoldSlot = async (slot: Slot) => {
    setIsHolding(true);
    setErrorMsg(null);

    const idempotencyKey = `hold_${host.slug}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    try {
      const res = await fetch('/api/holds', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({
          host_slug: host.slug,
          event_slug: event.slug,
          slot_start: slot.slot_start,
          slot_end: slot.slot_end,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to hold slot. It may have just been booked.');
      }

      setActiveHold({
        id: data.id,
        hold_token: data.hold_token,
        slot_start: data.slot_start,
        slot_end: data.slot_end,
        hold_expires_at: data.hold_expires_at,
      });

      const expiry = new Date(data.hold_expires_at).getTime();
      setSecondsLeft(Math.max(0, Math.floor((expiry - Date.now()) / 1000)));
    } catch (err: any) {
      setErrorMsg(err.message || 'Could not hold slot');
      fetchSlots(guestTz);
    } finally {
      setIsHolding(false);
    }
  };

  // 5. Handle Confirm
  const handleConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeHold) return;

    setIsConfirming(true);
    setErrorMsg(null);

    try {
      const res = await fetch(`/api/holds/${activeHold.id}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          guest_name: guestName,
          guest_email: guestEmail,
          guest_notes: guestNotes,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to confirm booking.');
      }

      setConfirmedBooking(data);
      setActiveHold(null);
    } catch (err: any) {
      setErrorMsg(err.message || 'Error confirming booking');
    } finally {
      setIsConfirming(false);
    }
  };

  // Group slots by local_date
  const dates = Array.from(new Set(slots.map((s) => s.local_date))).sort();
  const filteredSlots = slots.filter((s) => s.local_date === selectedDate);

  // If already confirmed:
  if (confirmedBooking) {
    return (
      <div className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-10 shadow-sm text-center max-w-xl mx-auto space-y-6">
        <div className="w-16 h-16 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto">
          <CheckCircle2 className="w-10 h-10" />
        </div>

        <div className="space-y-2">
          <h2 className="text-2xl font-bold text-slate-900">Booking Confirmed!</h2>
          <p className="text-sm text-slate-600">
            You're scheduled with <strong className="text-slate-900">{host.name}</strong> for{' '}
            <strong className="text-slate-900">{event.title}</strong>.
          </p>
        </div>

        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-left space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-slate-500">Date & Time:</span>
            <span className="font-semibold text-slate-800">
              {new Date(confirmedBooking.slot_start).toLocaleString(undefined, {
                timeZone: guestTz,
                dateStyle: 'medium',
                timeStyle: 'short',
              })} ({guestTz})
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Guest:</span>
            <span className="font-medium text-slate-800">{confirmedBooking.guest_name}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Email:</span>
            <span className="font-medium text-slate-800">{confirmedBooking.guest_email}</span>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-center gap-3 justify-center pt-2">
          <Link
            href={confirmedBooking.manage_url}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 transition-colors"
          >
            <span>Manage / Reschedule / Cancel</span>
            <ArrowRight className="w-4 h-4" />
          </Link>
          <a
            href={`/api/bookings/${confirmedBooking.booking_token}/ics`}
            download
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-white border border-slate-300 text-slate-700 font-medium hover:bg-slate-50 transition-colors"
          >
            <Download className="w-4 h-4" />
            <span>Download .ics</span>
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className={`bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden ${isEmbed ? 'p-4' : 'p-6 sm:p-8'}`}>
      {/* Event Header */}
      <div className="border-b border-slate-100 pb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-wider font-semibold text-indigo-600 mb-1">
            {host.name} · @{host.slug}
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900">{event.title}</h1>
          <p className="text-sm text-slate-600 mt-1 max-w-xl">{event.description}</p>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 font-medium text-slate-700">
            <Clock className="w-4 h-4 text-indigo-600" />
            <span>{event.duration_minutes} mins</span>
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 font-medium text-slate-700">
            <Shield className="w-4 h-4 text-indigo-600" />
            <span>{event.capacity === 1 ? '1-on-1' : `Max ${event.capacity} people`}</span>
          </div>
        </div>
      </div>

      {/* Error alert */}
      {errorMsg && (
        <div className="mt-4 p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Active Hold Countdown Banner */}
      {activeHold && (
        <div className="mt-6 p-4 rounded-xl bg-amber-50 border border-amber-300 text-amber-900 flex flex-col sm:flex-row items-center justify-between gap-3 animate-pulse">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Clock className="w-5 h-5 text-amber-600" />
            <span>
              Slot held exclusively for you! Please complete your details before time expires.
            </span>
          </div>
          <div className="font-mono text-base font-bold bg-white px-3 py-1 rounded-lg border border-amber-300 text-amber-800">
            {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')}
          </div>
        </div>
      )}

      {/* Step 1: Select Slot OR Step 2: Confirm Details */}
      {!activeHold ? (
        <div className="mt-6 grid grid-cols-1 md:grid-cols-12 gap-8">
          {/* Left: Timezone Switcher & Date Picker */}
          <div className="md:col-span-5 space-y-6">
            <div>
              <label htmlFor="tz-select" className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
                Your Time Zone
              </label>
              <div className="relative">
                <Globe className="w-4 h-4 text-slate-400 absolute left-3 top-3 pointer-events-none" />
                <select
                  id="tz-select"
                  value={guestTz}
                  onChange={(e) => setGuestTz(e.target.value)}
                  className="w-full pl-9 pr-8 py-2 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  {COMMON_TIMEZONES.map((tz) => (
                    <option key={tz} value={tz}>
                      {tz}
                    </option>
                  ))}
                  {!COMMON_TIMEZONES.includes(guestTz) && (
                    <option value={guestTz}>{guestTz}</option>
                  )}
                </select>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Select a Date
                </span>
                <span className="text-xs text-slate-400">Next 30 Days</span>
              </div>

              {loadingSlots ? (
                <div className="py-8 text-center text-slate-400 text-sm flex items-center justify-center gap-2">
                  <RefreshCw className="w-4 h-4 animate-spin text-indigo-600" />
                  <span>Loading available dates...</span>
                </div>
              ) : dates.length === 0 ? (
                <div className="py-8 text-center text-slate-500 text-sm bg-slate-50 rounded-xl border border-dashed border-slate-200">
                  No open slots found within the 30-day booking horizon.
                </div>
              ) : (
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 max-h-72 overflow-y-auto pr-1">
                  {dates.map((d) => {
                    const isSelected = d === selectedDate;
                    const dateObj = new Date(`${d}T00:00:00`);
                    const weekday = dateObj.toLocaleDateString(undefined, { weekday: 'short' });
                    const dayNum = dateObj.getDate();
                    const month = dateObj.toLocaleDateString(undefined, { month: 'short' });

                    return (
                      <button
                        key={d}
                        type="button"
                        onClick={() => setSelectedDate(d)}
                        className={`p-2 rounded-lg border text-center transition-all ${
                          isSelected
                            ? 'border-indigo-600 bg-indigo-50 text-indigo-900 font-bold shadow-sm'
                            : 'border-slate-200 bg-white hover:border-slate-300 text-slate-700'
                        }`}
                      >
                        <div className="text-xs text-slate-400 uppercase font-medium">{weekday}</div>
                        <div className="text-base">{dayNum}</div>
                        <div className="text-[10px] text-slate-400">{month}</div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Right: Slot Selection Grid */}
          <div className="md:col-span-7">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Available Times for {selectedDate || 'Selected Date'}
              </span>
              <span className="text-xs text-slate-400 font-medium">({guestTz})</span>
            </div>

            {loadingSlots ? (
              <div className="py-12 text-center text-slate-400 text-sm flex items-center justify-center gap-2">
                <RefreshCw className="w-4 h-4 animate-spin text-indigo-600" />
                <span>Generating slots...</span>
              </div>
            ) : filteredSlots.length === 0 ? (
              <div className="py-12 text-center text-slate-500 text-sm bg-slate-50 rounded-xl border border-dashed border-slate-200">
                No slots available on this date.
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {filteredSlots.map((slot) => (
                  <button
                    key={slot.slot_start}
                    type="button"
                    disabled={isHolding}
                    onClick={() => handleHoldSlot(slot)}
                    className="p-3 rounded-xl border border-slate-200 bg-white hover:border-indigo-500 hover:bg-indigo-50/50 hover:shadow-sm text-left transition-all disabled:opacity-50 group"
                  >
                    <div className="text-sm font-bold text-slate-900 group-hover:text-indigo-600">
                      {slot.local_start}
                    </div>
                    <div className="text-xs text-slate-400 mt-0.5">to {slot.local_end}</div>
                    {event.capacity > 1 && (
                      <div className="mt-2 text-[11px] font-medium text-emerald-600">
                        {slot.spots_remaining} spot{slot.spots_remaining > 1 ? 's' : ''} left
                      </div>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        /* Step 2: Guest Details Form (Active 5-minute hold) */
        <div className="mt-6 max-w-lg mx-auto bg-slate-50/70 border border-slate-200 rounded-xl p-6 sm:p-8 space-y-6">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Enter Your Details</h2>
            <p className="text-xs text-slate-500 mt-1">
              Time:{' '}
              <strong className="text-slate-800">
                {new Date(activeHold.slot_start).toLocaleString(undefined, {
                  timeZone: guestTz,
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })}
              </strong>{' '}
              ({guestTz})
            </p>
          </div>

          <form onSubmit={handleConfirm} className="space-y-4">
            <div>
              <label htmlFor="name-input" className="block text-xs font-semibold text-slate-700 mb-1">
                Your Full Name <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <User className="w-4 h-4 text-slate-400 absolute left-3 top-3 pointer-events-none" />
                <input
                  id="name-input"
                  type="text"
                  required
                  value={guestName}
                  onChange={(e) => setGuestName(e.target.value)}
                  placeholder="e.g. Sarah Jenkins"
                  className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                />
              </div>
            </div>

            <div>
              <label htmlFor="email-input" className="block text-xs font-semibold text-slate-700 mb-1">
                Your Email Address <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-3 pointer-events-none" />
                <input
                  id="email-input"
                  type="email"
                  required
                  value={guestEmail}
                  onChange={(e) => setGuestEmail(e.target.value)}
                  placeholder="sarah@example.com"
                  className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                />
              </div>
            </div>

            <div>
              <label htmlFor="notes-input" className="block text-xs font-semibold text-slate-700 mb-1">
                Notes or Agenda (Optional)
              </label>
              <textarea
                id="notes-input"
                rows={3}
                value={guestNotes}
                onChange={(e) => setGuestNotes(e.target.value)}
                placeholder="What would you like to discuss?"
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
              />
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button
                type="submit"
                disabled={isConfirming}
                className="flex-1 inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors shadow-sm"
              >
                {isConfirming ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Confirming...</span>
                  </>
                ) : (
                  <>
                    <span>Confirm Booking</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => {
                  setActiveHold(null);
                  fetchSlots(guestTz);
                }}
                className="px-4 py-2.5 rounded-lg border border-slate-300 bg-white text-slate-600 text-sm font-medium hover:bg-slate-50 transition-colors"
              >
                Cancel Hold
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
