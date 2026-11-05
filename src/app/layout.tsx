import './globals.css';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Calendar, ShieldCheck, LayoutDashboard, Globe } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Slotbook — Reliable Appointment Scheduling',
  description: 'Industrial-grade TypeScript appointment booking engine on Postgres.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
        <header className="border-b border-slate-200 bg-white sticky top-0 z-30 shadow-sm">
          <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
            <Link href="/" className="flex items-center gap-2 font-bold text-xl text-indigo-600 hover:text-indigo-700">
              <Calendar className="w-6 h-6" />
              <span>Slotbook</span>
            </Link>

            <nav className="flex items-center gap-4 text-sm font-medium">
              <Link
                href="/alex/quick-chat"
                className="text-slate-600 hover:text-indigo-600 flex items-center gap-1.5 transition-colors"
              >
                <Globe className="w-4 h-4" />
                <span>Guest Page</span>
              </Link>
              <Link
                href="/dashboard"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-50 text-indigo-700 hover:bg-indigo-100 transition-colors"
              >
                <LayoutDashboard className="w-4 h-4" />
                <span>Host Dashboard</span>
              </Link>
            </nav>
          </div>
        </header>

        <main className="flex-1 max-w-6xl w-full mx-auto p-4 sm:p-6 lg:p-8">
          {children}
        </main>

        <footer className="border-t border-slate-200 bg-white py-6 text-center text-xs text-slate-500">
          <div className="max-w-6xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              <span>Postgres-backed concurrency & idempotency engine. Zero double-booking guarantee.</span>
            </div>
            <div className="flex items-center gap-4">
              <Link href="/api/health" className="hover:underline">Health</Link>
              <Link href="/api/metrics" className="hover:underline">Metrics</Link>
              <span>Built for Take-Home Assignment</span>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
