'use client';

import React, { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { Calendar, Clock, Globe, Download, RefreshCw, XCircle, CheckCircle2, AlertCircle, ArrowRight } from 'lucide-react';
import Link from 'next/link';

interface BookingDetails {
  id: string;
  status: 'confirmed' | 'cancelled' | 'held' | 'expired';
  booking_token: string;
  slot_start: string;
  slot_end: string;
  guest_name: string;
  guest_email: string;
  guest_notes: string | null;
  cancellation_reason: string | null;
  cancelled_at: string | null;
  confirmed_at: string | null;
  event: {
    title: string;
    slug: string;
    duration_minutes: number;
    capacity: number;
  };
  host: {
    name: string;
    slug: string;
    email: string;
    timezone: string;
  };
}

interface Slot {
  slot_start: string;
  slot_end: string;
  local_start: string;
  local_end: string;
  local_date: string;
}

export default function GuestManagePage() {
  const params = useParams();
  const token = params?.token as string;

  const [booking, setBooking] = useState<BookingDetails | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Time zone for display
  const [displayTz, setDisplayTz] = useState<string>('UTC');

  // Cancel dialog
  const [showCancelModal, setShowCancelModal] = useState<boolean>(false);
  const [cancelReason, setCancelReason] = useState<string>('');
  const [isCancelling, setIsCancelling] = useState<boolean>(false);

  // Reschedule state
  const [isRescheduling, setIsRescheduling] = useState<boolean>(false);
  const [availableSlots, setAvailableSlots] = useState<Slot[]>([]);
  const [selectedRescheduleDate, setSelectedRescheduleDate] = useState<string>('');
  const [loadingSlots, setLoadingSlots] = useState<boolean>(false);
  const [submittingReschedule, setSubmittingReschedule] = useState<boolean>(false);

  useEffect(() => {
    try {
      setDisplayTz(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
    } catch (e) {
      setDisplayTz('UTC');
    }
  }, []);

  const fetchBooking = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/bookings/${token}`, { cache: 'no-store' });
      if (!res.ok) {
        throw new Error('Booking not found');
      }
      const data = await res.json();
      setBooking(data);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to load booking');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (token) {
      fetchBooking();
    }
  }, [token]);

  // Load slots for reschedule
  const loadRescheduleSlots = async () => {
    if (!booking) return;
    setIsRescheduling(true);
    setLoadingSlots(true);
    setErrorMsg(null);
    try {
      const res = await fetch(
        `/api/hosts/${booking.host.slug}/events/${booking.event.slug}/slots?tz=${encodeURIComponent(displayTz)}`,
        { cache: 'no-store' }
      );
      const data = await res.json();
      setAvailableSlots(data.slots || []);
      if (data.slots && data.slots.length > 0) {
        setSelectedRescheduleDate(data.slots[0].local_date);
      }
    } catch (err: any) {
      setErrorMsg('Failed to load alternative slots for rescheduling.');
    } finally {
      setLoadingSlots(false);
    }
  };

  // Perform Reschedule
  const handleReschedule = async (slot: Slot) => {
    setSubmittingReschedule(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/bookings/${token}/reschedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          new_slot_start: slot.slot_start,
          new_slot_end: slot.slot_end,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to reschedule');
      }

      setSuccessMsg('Your booking has been rescheduled successfully!');
      setIsRescheduling(false);
      fetchBooking();
    } catch (err: any) {
      setErrorMsg(err.message || 'Error rescheduling slot');
    } finally {
      setSubmittingReschedule(false);
    }
  };

  // Perform Cancellation
  const handleCancelBooking = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cancelReason.trim()) return;

    setIsCancelling(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/bookings/${token}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: cancelReason.trim() }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to cancel booking');
      }

      setShowCancelModal(false);
      setSuccessMsg('Booking has been cancelled.');
      fetchBooking();
    } catch (err: any) {
      setErrorMsg(err.message || 'Error cancelling booking');
    } finally {
      setIsCancelling(false);
    }
  };

  if (loading) {
    return (
      <div className="py-24 text-center text-slate-500 flex items-center justify-center gap-2">
        <RefreshCw className="w-5 h-5 animate-spin text-indigo-600" />
        <span>Loading booking details...</span>
      </div>
    );
  }

  if (!booking) {
    return (
      <div className="bg-white border border-slate-200 rounded-2xl p-10 max-w-lg mx-auto text-center space-y-4">
        <AlertCircle className="w-12 h-12 text-rose-500 mx-auto" />
        <h2 className="text-xl font-bold text-slate-900">Booking Not Found</h2>
        <p className="text-sm text-slate-600">The link you followed may be invalid or expired.</p>
        <Link href="/" className="inline-block text-sm font-semibold text-indigo-600 hover:underline">
          Return Home
        </Link>
      </div>
    );
  }

  const isCancelled = booking.status === 'cancelled';
  const rescheduleDates = Array.from(new Set(availableSlots.map((s) => s.local_date))).sort();
  const filteredRescheduleSlots = availableSlots.filter((s) => s.local_date === selectedRescheduleDate);

  return (
    <div className="max-w-2xl mx-auto space-y-6 py-6">
      {/* Notifications */}
      {successMsg && (
        <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm flex items-center gap-2">
          <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-600" />
          <span>{successMsg}</span>
        </div>
      )}

      {errorMsg && (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-sm flex items-center gap-2">
          <AlertCircle className="w-5 h-5 shrink-0 text-rose-600" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Main Booking Card */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 shadow-sm space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-6 border-b border-slate-100 gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span
                className={`text-xs uppercase font-bold px-2 py-0.5 rounded-full ${
                  isCancelled
                    ? 'bg-rose-100 text-rose-700'
                    : 'bg-emerald-100 text-emerald-800'
                }`}
              >
                {booking.status}
              </span>
              <span className="text-xs text-slate-500">Booking Reference: {booking.booking_token.slice(0, 10)}...</span>
            </div>
            <h1 className="text-2xl font-extrabold text-slate-900">{booking.event.title}</h1>
            <p className="text-sm text-slate-500">With {booking.host.name} ({booking.host.email})</p>
          </div>

          {!isCancelled && (
            <a
              href={`/api/bookings/${booking.booking_token}/ics`}
              download
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold shadow-sm transition-colors self-start"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download .ics</span>
            </a>
          )}
        </div>

        {/* Appointment Details */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm bg-slate-50/70 p-4 rounded-xl border border-slate-100">
          <div>
            <div className="text-xs text-slate-400 font-semibold uppercase">Date & Time</div>
            <div className="font-bold text-slate-900 mt-1">
              {new Date(booking.slot_start).toLocaleString(undefined, {
                timeZone: displayTz,
                dateStyle: 'full',
                timeStyle: 'short',
              })}
            </div>
            <div className="text-xs text-slate-500 mt-0.5">Timezone: {displayTz}</div>
          </div>

          <div>
            <div className="text-xs text-slate-400 font-semibold uppercase">Guest Information</div>
            <div className="font-bold text-slate-900 mt-1">{booking.guest_name}</div>
            <div className="text-xs text-slate-500 mt-0.5">{booking.guest_email}</div>
          </div>

          {booking.guest_notes && (
            <div className="sm:col-span-2 pt-2 border-t border-slate-200/60">
              <div className="text-xs text-slate-400 font-semibold uppercase">Agenda / Notes</div>
              <div className="text-xs text-slate-700 mt-1">{booking.guest_notes}</div>
            </div>
          )}

          {isCancelled && (
            <div className="sm:col-span-2 pt-2 border-t border-rose-200 text-rose-800">
              <div className="text-xs font-semibold uppercase">Cancellation Reason</div>
              <div className="text-sm mt-0.5">{booking.cancellation_reason || 'No reason provided'}</div>
              {booking.cancelled_at && (
                <div className="text-[11px] text-rose-500 mt-0.5">
                  Cancelled at: {new Date(booking.cancelled_at).toLocaleString()}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Actions (if not cancelled) */}
        {!isCancelled && !isRescheduling && (
          <div className="flex flex-wrap items-center gap-3 pt-2">
            <button
              type="button"
              onClick={loadRescheduleSlots}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 transition-colors shadow-sm"
            >
              <RefreshCw className="w-4 h-4" />
              <span>Reschedule to New Slot</span>
            </button>

            <button
              type="button"
              onClick={() => setShowCancelModal(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg border border-rose-200 text-rose-700 hover:bg-rose-50 text-sm font-medium transition-colors"
            >
              <XCircle className="w-4 h-4 text-rose-500" />
              <span>Cancel Booking</span>
            </button>
          </div>
        )}

        {/* Reschedule Interface */}
        {!isCancelled && isRescheduling && (
          <div className="border-t border-slate-200 pt-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-slate-900">Choose a New Slot</h2>
              <button
                type="button"
                onClick={() => setIsRescheduling(false)}
                className="text-xs text-slate-500 hover:underline"
              >
                Close Reschedule
              </button>
            </div>

            {loadingSlots ? (
              <div className="py-8 text-center text-slate-400 text-sm flex items-center justify-center gap-2">
                <RefreshCw className="w-4 h-4 animate-spin text-indigo-600" />
                <span>Loading available slots...</span>
              </div>
            ) : availableSlots.length === 0 ? (
              <p className="text-sm text-slate-500 bg-slate-50 p-4 rounded-lg">
                No alternative slots currently open.
              </p>
            ) : (
              <div className="space-y-4">
                {/* Date buttons */}
                <div className="flex gap-2 overflow-x-auto pb-2">
                  {rescheduleDates.map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setSelectedRescheduleDate(d)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap border transition-colors ${
                        d === selectedRescheduleDate
                          ? 'bg-indigo-600 text-white border-indigo-600'
                          : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      {d}
                    </button>
                  ))}
                </div>

                {/* Slots grid */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {filteredRescheduleSlots.map((slot) => (
                    <button
                      key={slot.slot_start}
                      type="button"
                      disabled={submittingReschedule}
                      onClick={() => handleReschedule(slot)}
                      className="p-2.5 rounded-lg border border-slate-200 hover:border-indigo-600 hover:bg-indigo-50/50 text-left transition-all disabled:opacity-50"
                    >
                      <div className="text-sm font-bold text-slate-900">{slot.local_start}</div>
                      <div className="text-xs text-slate-400">to {slot.local_end}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Cancellation Modal */}
      {showCancelModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl space-y-4">
            <h3 className="text-lg font-bold text-slate-900">Cancel Booking</h3>
            <p className="text-sm text-slate-600">
              Are you sure you want to cancel this booking with <strong className="text-slate-800">{booking.host.name}</strong>?
            </p>

            <form onSubmit={handleCancelBooking} className="space-y-4">
              <div>
                <label htmlFor="cancel-reason" className="block text-xs font-semibold text-slate-700 mb-1">
                  Reason for Cancellation <span className="text-rose-500">*</span>
                </label>
                <textarea
                  id="cancel-reason"
                  required
                  rows={3}
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  placeholder="e.g. Unforeseen schedule conflict"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-rose-500"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCancelModal(false)}
                  className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 text-sm font-medium hover:bg-slate-50 transition-colors"
                >
                  Keep Booking
                </button>
                <button
                  type="submit"
                  disabled={isCancelling}
                  className="px-4 py-2 rounded-lg bg-rose-600 text-white text-sm font-medium hover:bg-rose-700 disabled:opacity-50 transition-colors shadow-sm"
                >
                  {isCancelling ? 'Cancelling...' : 'Confirm Cancellation'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
