'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, Plus, Trash2, Clock, Calendar, CheckCircle2, AlertCircle, RefreshCw, Sun } from 'lucide-react';
import { Host, HostAvailability, HostOverride } from '@/lib/types';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

interface DayWindow {
  id?: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
}

export default function HostAvailabilityPage() {
  const [host, setHost] = useState<Host | null>(null);
  const [windows, setWindows] = useState<DayWindow[]>([]);
  const [overrides, setOverrides] = useState<HostOverride[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [savingSchedule, setSavingSchedule] = useState<boolean>(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // New Override form
  const [overrideDate, setOverrideDate] = useState<string>('');
  const [isDayOff, setIsDayOff] = useState<boolean>(true);
  const [customStart, setCustomStart] = useState<string>('10:00');
  const [customEnd, setCustomEnd] = useState<string>('14:00');
  const [submittingOverride, setSubmittingOverride] = useState<boolean>(false);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [hostRes, availRes, overridesRes] = await Promise.all([
        fetch('/api/host/me', { cache: 'no-store' }),
        fetch('/api/host/availability', { cache: 'no-store' }),
        fetch('/api/host/overrides', { cache: 'no-store' }),
      ]);

      if (hostRes.ok) setHost(await hostRes.json());
      if (availRes.ok) setWindows(await availRes.json());
      if (overridesRes.ok) setOverrides(await overridesRes.json());
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Add window to day
  const handleAddWindow = (dayIndex: number) => {
    setWindows([
      ...windows,
      { day_of_week: dayIndex, start_time: '09:00:00', end_time: '17:00:00' },
    ]);
  };

  // Remove window
  const handleRemoveWindow = (index: number) => {
    const updated = [...windows];
    updated.splice(index, 1);
    setWindows(updated);
  };

  // Update window time
  const handleWindowChange = (index: number, field: 'start_time' | 'end_time', value: string) => {
    const updated = [...windows];
    const valWithSecs = value.length === 5 ? `${value}:00` : value;
    updated[index] = { ...updated[index], [field]: valWithSecs };
    setWindows(updated);
  };

  // Save weekly schedule
  const handleSaveSchedule = async () => {
    setSavingSchedule(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/host/availability', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ windows }),
      });
      if (!res.ok) throw new Error('Failed to save weekly schedule');
      setSuccessMsg('Weekly schedule updated successfully!');
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err: any) {
      setErrorMsg(err.message || 'Error saving availability');
    } finally {
      setSavingSchedule(false);
    }
  };

  // Add Override
  const handleCreateOverride = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!overrideDate) return;

    setSubmittingOverride(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/host/overrides', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          override_date: overrideDate,
          is_unavailable: isDayOff,
          start_time: isDayOff ? null : `${customStart}:00`,
          end_time: isDayOff ? null : `${customEnd}:00`,
        }),
      });

      if (!res.ok) throw new Error('Failed to create date override');
      setOverrideDate('');
      fetchData();
      setSuccessMsg('Date override added!');
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err: any) {
      setErrorMsg(err.message || 'Error creating override');
    } finally {
      setSubmittingOverride(false);
    }
  };

  // Delete Override
  const handleDeleteOverride = async (id: string) => {
    try {
      await fetch(`/api/host/overrides/${id}`, { method: 'DELETE' });
      setOverrides(overrides.filter((o) => o.id !== id));
    } catch (e) {
      console.error(e);
    }
  };

  if (loading) {
    return (
      <div className="py-24 text-center text-slate-400 text-sm flex items-center justify-center gap-2">
        <RefreshCw className="w-5 h-5 animate-spin text-indigo-600" />
        <span>Loading availability configuration...</span>
      </div>
    );
  }

  return (
    <div className="space-y-8 py-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <Link
            href="/dashboard"
            className="text-xs font-semibold text-slate-500 hover:text-indigo-600 flex items-center gap-1 mb-1"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to Dashboard</span>
          </Link>
          <h1 className="text-2xl font-extrabold text-slate-900">Availability & Overrides</h1>
          <p className="text-sm text-slate-500">
            Define recurring hours in <strong className="text-slate-800">{host?.timezone || 'UTC'}</strong> and special date exceptions.
          </p>
        </div>

        <button
          type="button"
          onClick={handleSaveSchedule}
          disabled={savingSchedule}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-colors shadow-sm self-start"
        >
          {savingSchedule ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
          <span>Save Weekly Schedule</span>
        </button>
      </div>

      {successMsg && (
        <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm flex items-center gap-2">
          <CheckCircle2 className="w-5 h-5 text-emerald-600" />
          <span>{successMsg}</span>
        </div>
      )}

      {errorMsg && (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-sm flex items-center gap-2">
          <AlertCircle className="w-5 h-5 text-rose-600" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Weekly Schedule Section */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 shadow-sm space-y-6">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Weekly Recurring Hours</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            You can add multiple windows per day (e.g. morning 09:00–12:00 and afternoon 13:00–17:00).
          </p>
        </div>

        <div className="divide-y divide-slate-100">
          {DAYS.map((dayName, dayIndex) => {
            const dayWindows = windows
              .map((w, originalIdx) => ({ ...w, originalIdx }))
              .filter((w) => w.day_of_week === dayIndex);

            return (
              <div key={dayName} className="py-4 flex flex-col sm:flex-row sm:items-start gap-4">
                <div className="w-28 text-sm font-bold text-slate-800 pt-2">{dayName}</div>

                <div className="flex-1 space-y-2">
                  {dayWindows.length === 0 ? (
                    <div className="text-xs text-slate-400 italic pt-2">Unavailable</div>
                  ) : (
                    dayWindows.map((win) => (
                      <div key={win.originalIdx} className="flex items-center gap-2">
                        <input
                          type="time"
                          value={win.start_time.slice(0, 5)}
                          onChange={(e) => handleWindowChange(win.originalIdx, 'start_time', e.target.value)}
                          className="px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                        <span className="text-xs text-slate-400">to</span>
                        <input
                          type="time"
                          value={win.end_time.slice(0, 5)}
                          onChange={(e) => handleWindowChange(win.originalIdx, 'end_time', e.target.value)}
                          className="px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                        <button
                          type="button"
                          onClick={() => handleRemoveWindow(win.originalIdx)}
                          className="p-1.5 text-slate-400 hover:text-rose-600 transition-colors"
                          title="Remove window"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => handleAddWindow(dayIndex)}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-800 pt-2"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Window</span>
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Date Overrides Section */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 shadow-sm space-y-6">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Date Overrides</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Add a day off or customize hours for specific calendar dates.
          </p>
        </div>

        {/* Add Override Form */}
        <form
          onSubmit={handleCreateOverride}
          className="bg-slate-50/70 p-4 rounded-xl border border-slate-200 flex flex-wrap items-center gap-3 text-sm"
        >
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1">Date</label>
            <input
              type="date"
              required
              value={overrideDate}
              onChange={(e) => setOverrideDate(e.target.value)}
              className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
            />
          </div>

          <div className="flex items-center gap-3 pt-5">
            <label className="flex items-center gap-1.5 text-xs font-medium cursor-pointer">
              <input
                type="radio"
                name="override-type"
                checked={isDayOff}
                onChange={() => setIsDayOff(true)}
                className="text-indigo-600"
              />
              <span>Day Off (Unavailable)</span>
            </label>
            <label className="flex items-center gap-1.5 text-xs font-medium cursor-pointer">
              <input
                type="radio"
                name="override-type"
                checked={!isDayOff}
                onChange={() => setIsDayOff(false)}
                className="text-indigo-600"
              />
              <span>Custom Hours</span>
            </label>
          </div>

          {!isDayOff && (
            <div className="flex items-center gap-2 pt-5">
              <input
                type="time"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                className="px-2 py-1 rounded border border-slate-300 text-xs bg-white"
              />
              <span className="text-xs text-slate-400">to</span>
              <input
                type="time"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="px-2 py-1 rounded border border-slate-300 text-xs bg-white"
              />
            </div>
          )}

          <div className="pt-5">
            <button
              type="submit"
              disabled={submittingOverride || !overrideDate}
              className="px-4 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 disabled:opacity-40 transition-colors"
            >
              {submittingOverride ? 'Adding...' : 'Add Override'}
            </button>
          </div>
        </form>

        {/* List of existing overrides */}
        {overrides.length === 0 ? (
          <p className="text-xs text-slate-400 italic">No date overrides configured.</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {overrides.map((ov) => {
              const dateStr = String(ov.override_date).slice(0, 10);
              return (
                <div key={ov.id} className="py-3 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Calendar className="w-4 h-4 text-indigo-600" />
                    <div>
                      <span className="font-bold text-slate-900 text-sm">{dateStr}</span>
                      <span className="ml-2 text-xs font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">
                        {ov.is_unavailable ? 'Full Day Off' : `Custom Hours: ${ov.start_time?.slice(0, 5)} - ${ov.end_time?.slice(0, 5)}`}
                      </span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleDeleteOverride(ov.id)}
                    className="text-slate-400 hover:text-rose-600 p-1 transition-colors"
                    title="Delete override"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
