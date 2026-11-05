'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { Calendar, Clock, Globe, Shield, Plus, XCircle, CheckCircle2, AlertCircle, RefreshCw, Layers, CalendarCheck } from 'lucide-react';
import { Host } from '@/lib/types';

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

interface HostBooking {
  id: string;
  status: string;
  booking_token: string;
  slot_start: string;
  slot_end: string;
  guest_name: string;
  guest_email: string;
  guest_notes: string;
  cancellation_reason: string;
  event_title: string;
  event_slug: string;
  capacity: number;
}

export default function HostDashboardPage() {
  const [host, setHost] = useState<Host | null>(null);
  const [bookings, setBookings] = useState<HostBooking[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [statusFilter, setStatusFilter] = useState<string>('all');

  // Updating host timezone
  const [selectedTz, setSelectedTz] = useState<string>('');
  const [isUpdatingTz, setIsUpdatingTz] = useState<boolean>(false);
  const [tzSuccess, setTzSuccess] = useState<boolean>(false);

  // Cancellation modal
  const [selectedBookingToCancel, setSelectedBookingToCancel] = useState<HostBooking | null>(null);
  const [cancelReason, setCancelReason] = useState<string>('');
  const [isCancelling, setIsCancelling] = useState<boolean>(false);
  const [feedbackMsg, setFeedbackMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [hostRes, bookingsRes] = await Promise.all([
        fetch('/api/host/me', { cache: 'no-store' }),
        fetch('/api/host/bookings', { cache: 'no-store' }),
      ]);

      if (hostRes.ok) {
        const hostData = await hostRes.json();
        setHost(hostData);
        setSelectedTz(hostData.timezone || 'UTC');
      }

      if (bookingsRes.ok) {
        const bookingsData = await bookingsRes.json();
        setBookings(bookingsData);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleUpdateTimezone = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsUpdatingTz(true);
    setTzSuccess(false);
    try {
      const res = await fetch('/api/host/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timezone: selectedTz }),
      });
      if (res.ok) {
        const updated = await res.json();
        setHost(updated);
        setTzSuccess(true);
        setTimeout(() => setTzSuccess(false), 3000);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsUpdatingTz(false);
    }
  };

  const handleCancelBooking = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBookingToCancel || !cancelReason.trim()) return;

    setIsCancelling(true);
    setFeedbackMsg(null);
    try {
      const res = await fetch(`/api/host/bookings/${selectedBookingToCancel.id}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: cancelReason.trim() }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to cancel booking');
      }

      setSelectedBookingToCancel(null);
      setCancelReason('');
      setFeedbackMsg({ type: 'success', text: 'Booking successfully cancelled. Guest notified.' });
      fetchData();
    } catch (err: any) {
      setFeedbackMsg({ type: 'error', text: err.message || 'Error cancelling booking' });
    } finally {
      setIsCancelling(false);
    }
  };

  const filteredBookings = bookings.filter((b) => {
    if (statusFilter === 'all') return true;
    return b.status === statusFilter;
  });

  return (
    <div className="space-y-8 py-4">
      {/* Top Navigation Subbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900">Host Dashboard</h1>
          <p className="text-sm text-slate-500">
            Logged in as <strong className="text-slate-800">{host?.name || 'Alex Rivers'}</strong> (@{host?.slug || 'alex'})
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/dashboard/events"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-white border border-slate-300 text-slate-700 text-sm font-semibold hover:bg-slate-50 transition-colors shadow-sm"
          >
            <Layers className="w-4 h-4 text-indigo-600" />
            <span>Event Types</span>
          </Link>
          <Link
            href="/dashboard/availability"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 transition-colors shadow-sm"
          >
            <CalendarCheck className="w-4 h-4" />
            <span>Availability & Overrides</span>
          </Link>
        </div>
      </div>

      {feedbackMsg && (
        <div
          className={`p-4 rounded-xl text-sm flex items-center gap-2 border ${
            feedbackMsg.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}
        >
          {feedbackMsg.type === 'success' ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-600" />
          ) : (
            <AlertCircle className="w-5 h-5 text-rose-600" />
          )}
          <span>{feedbackMsg.text}</span>
        </div>
      )}

      {/* Host Requirement 1: Home Timezone Setting */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Home Time Zone (IANA)</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Your weekly availability and custom date overrides are defined in this time zone.
            </p>
          </div>

          <form onSubmit={handleUpdateTimezone} className="flex items-center gap-2">
            <div className="relative">
              <Globe className="w-4 h-4 text-slate-400 absolute left-3 top-2.5 pointer-events-none" />
              <select
                value={selectedTz}
                onChange={(e) => setSelectedTz(e.target.value)}
                className="pl-9 pr-8 py-2 rounded-lg border border-slate-300 text-sm font-semibold text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {COMMON_TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
                {!COMMON_TIMEZONES.includes(selectedTz) && selectedTz && (
                  <option value={selectedTz}>{selectedTz}</option>
                )}
              </select>
            </div>

            <button
              type="submit"
              disabled={isUpdatingTz || selectedTz === host?.timezone}
              className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 disabled:opacity-40 transition-colors"
            >
              {isUpdatingTz ? 'Saving...' : 'Update'}
            </button>
            {tzSuccess && (
              <span className="text-xs text-emerald-600 font-semibold flex items-center gap-1">
                <CheckCircle2 className="w-4 h-4" /> Saved!
              </span>
            )}
          </form>
        </div>
      </div>

      {/* Host Requirement 4: Bookings List & Host Cancellation */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Bookings & Appointments</h2>
            <p className="text-xs text-slate-500">Upcoming reservations, confirmed guests, and active holds.</p>
          </div>

          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg text-xs font-semibold">
            {['all', 'confirmed', 'held', 'cancelled'].map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setStatusFilter(tab)}
                className={`px-3 py-1.5 rounded-md capitalize transition-colors ${
                  statusFilter === tab
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="py-16 text-center text-slate-400 text-sm flex items-center justify-center gap-2">
            <RefreshCw className="w-5 h-5 animate-spin text-indigo-600" />
            <span>Loading bookings...</span>
          </div>
        ) : filteredBookings.length === 0 ? (
          <div className="py-16 text-center text-slate-500 text-sm bg-slate-50/50 rounded-xl border border-dashed border-slate-200">
            No {statusFilter === 'all' ? '' : statusFilter} bookings found.
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {filteredBookings.map((b) => (
              <div key={b.id} className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-[11px] uppercase font-bold px-2 py-0.5 rounded-full ${
                        b.status === 'confirmed'
                          ? 'bg-emerald-100 text-emerald-800'
                          : b.status === 'held'
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-rose-100 text-rose-700'
                      }`}
                    >
                      {b.status}
                    </span>
                    <span className="font-bold text-slate-900 text-base">{b.event_title}</span>
                  </div>

                  <div className="text-xs text-slate-600">
                    <span className="font-semibold text-slate-800">
                      {new Date(b.slot_start).toLocaleString(undefined, {
                        timeZone: host?.timezone || 'UTC',
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                    </span>{' '}
                    ({host?.timezone})
                  </div>

                  <div className="text-xs text-slate-500">
                    Guest: <strong className="text-slate-700">{b.guest_name || 'Pending Hold'}</strong>{' '}
                    {b.guest_email && `(${b.guest_email})`}
                  </div>

                  {b.cancellation_reason && (
                    <div className="text-xs text-rose-600 font-medium">
                      Cancelled reason: "{b.cancellation_reason}"
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2 self-start sm:self-center">
                  {b.status === 'confirmed' && (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedBookingToCancel(b);
                        setCancelReason('');
                      }}
                      className="px-3 py-1.5 rounded-lg border border-rose-200 text-rose-700 hover:bg-rose-50 text-xs font-semibold transition-colors"
                    >
                      Cancel with Reason
                    </button>
                  )}
                  {b.booking_token && (
                    <Link
                      href={`/manage/${b.booking_token}`}
                      target="_blank"
                      className="px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-medium transition-colors"
                    >
                      Manage Link
                    </Link>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Host Cancel Modal */}
      {selectedBookingToCancel && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl space-y-4">
            <h3 className="text-lg font-bold text-slate-900">Host Booking Cancellation</h3>
            <p className="text-sm text-slate-600">
              Cancel appointment with <strong className="text-slate-800">{selectedBookingToCancel.guest_name}</strong> for{' '}
              <strong className="text-slate-800">{selectedBookingToCancel.event_title}</strong>.
            </p>

            <form onSubmit={handleCancelBooking} className="space-y-4">
              <div>
                <label htmlFor="host-cancel-reason" className="block text-xs font-semibold text-slate-700 mb-1">
                  Reason for Cancellation <span className="text-rose-500">*</span>
                </label>
                <textarea
                  id="host-cancel-reason"
                  required
                  rows={3}
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  placeholder="e.g. Host is unavailable due to an emergency"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-rose-500"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setSelectedBookingToCancel(null)}
                  className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 text-sm font-medium hover:bg-slate-50"
                >
                  Keep Booking
                </button>
                <button
                  type="submit"
                  disabled={isCancelling}
                  className="px-4 py-2 rounded-lg bg-rose-600 text-white text-sm font-medium hover:bg-rose-700 disabled:opacity-50"
                >
                  {isCancelling ? 'Cancelling...' : 'Cancel Appointment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
