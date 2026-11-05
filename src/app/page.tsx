import Link from 'next/link';
import { Calendar, Users, Clock, ShieldCheck, ArrowRight, Zap, CheckCircle2 } from 'lucide-react';
import { pool } from '@/db';
import { Host, EventType } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  let host: Host | null = null;
  let eventTypes: EventType[] = [];

  try {
    const hostRes = await pool.query<Host>("SELECT * FROM hosts WHERE slug = 'alex'");
    if (hostRes.rowCount && hostRes.rowCount > 0) {
      host = hostRes.rows[0];
      const eventsRes = await pool.query<EventType>(
        'SELECT * FROM event_types WHERE host_id = $1 AND is_active = TRUE ORDER BY capacity ASC',
        [host.id]
      );
      eventTypes = eventsRes.rows;
    }
  } catch (e) {
    // DB might be spinning up
  }

  return (
    <div className="space-y-12 py-6">
      {/* Hero section */}
      <div className="text-center max-w-3xl mx-auto space-y-4">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 text-xs font-semibold border border-emerald-200">
          <ShieldCheck className="w-4 h-4" />
          <span>Rock-Solid Booking Core on PostgreSQL 16</span>
        </div>
        <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-slate-900">
          Booking you would trust with money.
        </h1>
        <p className="text-lg text-slate-600 leading-relaxed">
          Slotbook guarantees hosts publish free times, guests reserve slots with 5-minute temporary holds,
          and <strong className="text-slate-900 font-semibold">nobody is ever double-booked</strong> — even across network timeouts,
          clock drift, and high concurrency.
        </p>

        <div className="pt-2 flex flex-wrap items-center justify-center gap-4">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 shadow-sm transition-all"
          >
            <span>Open Host Dashboard</span>
            <ArrowRight className="w-4 h-4" />
          </Link>
          <Link
            href="/alex/quick-chat"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-white text-slate-700 font-medium border border-slate-300 hover:bg-slate-50 shadow-sm transition-all"
          >
            <span>Book a Demo Slot</span>
          </Link>
        </div>
      </div>

      {/* Demo Host Card & Event Types */}
      {host && (
        <div className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-6 border-b border-slate-100 gap-4">
            <div>
              <div className="text-xs uppercase tracking-wider font-bold text-indigo-600 mb-1">Seeded Demo Host</div>
              <h2 className="text-2xl font-bold text-slate-900">{host.name}</h2>
              <p className="text-sm text-slate-500">
                @{host.slug} · Home Time Zone: <span className="font-mono text-slate-700 font-semibold">{host.timezone}</span>
              </p>
            </div>
            <Link
              href="/dashboard"
              className="text-sm font-semibold text-indigo-600 hover:text-indigo-800 flex items-center gap-1"
            >
              <span>Manage Availability & Settings</span>
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-6">
            {eventTypes.map((evt) => (
              <div
                key={evt.id}
                className="border border-slate-200 rounded-xl p-6 bg-slate-50/50 hover:border-indigo-300 hover:bg-indigo-50/20 transition-all flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-semibold px-2.5 py-1 rounded bg-white border border-slate-200 text-slate-700">
                      {evt.capacity === 1 ? '1-on-1 Meeting' : `Group Session (${evt.capacity} spots)`}
                    </span>
                    <span className="text-xs text-slate-500 font-medium flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5" />
                      {evt.duration_minutes} mins
                    </span>
                  </div>
                  <h3 className="text-lg font-bold text-slate-900">{evt.title}</h3>
                  <p className="text-sm text-slate-600 mt-2 line-clamp-2">{evt.description}</p>

                  <div className="mt-4 pt-4 border-t border-slate-200/60 grid grid-cols-2 gap-2 text-xs text-slate-500">
                    <div>Buffer: {evt.buffer_before_minutes}m before / {evt.buffer_after_minutes}m after</div>
                    <div>Min notice: {evt.min_notice_hours}h</div>
                  </div>
                </div>

                <div className="mt-6 flex items-center gap-3">
                  <Link
                    href={`/${host.slug}/${evt.slug}`}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition-colors"
                  >
                    <span>View Booking Page</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </Link>
                  <Link
                    href={`/${host.slug}/${evt.slug}/embed`}
                    className="px-3 py-2 rounded-lg bg-white border border-slate-300 text-slate-700 text-xs font-medium hover:bg-slate-100 transition-colors"
                    title="Embeddable Widget Preview"
                  >
                    Widget
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* System Guarantees & Architecture Highlights */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-2">
          <div className="w-9 h-9 rounded-lg bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <h3 className="font-bold text-slate-900">Postgres Correctness</h3>
          <p className="text-xs text-slate-600 leading-relaxed">
            Postgres is the single source of truth. Advisory locks and row-level serialization protect against race conditions without external Redis.
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-2">
          <div className="w-9 h-9 rounded-lg bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold">
            <Zap className="w-5 h-5" />
          </div>
          <h3 className="font-bold text-slate-900">5-Minute Atomic Holds</h3>
          <p className="text-xs text-slate-600 leading-relaxed">
            Selecting a slot places a temporary 5-minute hold with idempotency protection. Expired holds auto-release back to available capacity.
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-2">
          <div className="w-9 h-9 rounded-lg bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold">
            <CheckCircle2 className="w-5 h-5" />
          </div>
          <h3 className="font-bold text-slate-900">Transactional Outbox</h3>
          <p className="text-xs text-slate-600 leading-relaxed">
            Confirmations, reschedules, and cancellations emit notification records and RFC 5545 .ics calendars within the booking transaction.
          </p>
        </div>
      </div>
    </div>
  );
}
