import { useEffect, useState } from 'react';
import { CheckCircle2, Download, RefreshCw } from 'lucide-react';
import { isDesktopApp, type UpdateStatus } from '../lib/desktop.js';

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** unit;
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

/** Desktop-only settings card: manual "Check for updates" + install prompt. Renders nothing on the web app. */
export default function DesktopUpdatePanel() {
  const [status, setStatus] = useState<UpdateStatus>({ state: 'idle' });
  const [version, setVersion] = useState<string | null>(null);
  const desktop = isDesktopApp();

  useEffect(() => {
    if (!window.desktop) return;
    window.desktop.getAppVersion().then(setVersion);
    return window.desktop.onUpdateStatus(setStatus);
  }, []);

  if (!desktop) return null;

  const busy = status.state === 'checking' || status.state === 'downloading';

  const handleCheck = async () => {
    setStatus({ state: 'checking' });
    const result = await window.desktop?.checkForUpdates();
    // On success the 'checking-for-update'/'available'/'not-available' broadcast drives the rest;
    // an immediate ok:false (dev mode, offline, no feed) never fires a broadcast, so surface it here.
    if (result && !result.ok) setStatus({ state: 'error', message: result.message ?? 'Update check failed.' });
  };

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <h3 className="mb-1 font-semibold text-slate-900 dark:text-neutral-100">App updates</h3>
      <p className="mb-3 text-sm text-slate-400 dark:text-neutral-500">{version ? `You're on version ${version}.` : 'Desktop app.'}</p>
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={handleCheck}
          disabled={busy}
          className="flex items-center gap-1.5 rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-neutral-800 dark:text-neutral-400 dark:hover:bg-white/5"
        >
          <RefreshCw size={14} className={busy ? 'animate-spin' : ''} />
          {status.state === 'checking' ? 'Checking…' : 'Check for updates'}
        </button>
        {status.state === 'not-available' && (
          <span className="flex items-center gap-1 text-sm text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 size={14} /> You're up to date (v{status.version})
          </span>
        )}
        {status.state === 'available' && <span className="text-sm text-slate-500 dark:text-neutral-400">Update v{status.version} found — downloading…</span>}
        {status.state === 'downloading' && (
          <div className="min-w-56 flex-1 text-sm text-slate-500 dark:text-neutral-400">
            <span className="flex items-center gap-1.5">
              <Download size={14} /> Downloading… {status.percent}%
              {status.method === 'differential' && <span className="text-emerald-600 dark:text-emerald-400">Delta update</span>}
              {status.method === 'full' && <span className="text-amber-600 dark:text-amber-400">Full installer fallback</span>}
            </span>
            <span className="mt-0.5 block pl-5 text-xs text-slate-400 dark:text-neutral-500">
              {formatBytes(status.transferred)} transferred at {formatBytes(status.bytesPerSecond)}/s
              {status.total > 0 ? ` · ${formatBytes(status.total)} download` : ''}
            </span>
            <div
              className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10"
              role="progressbar"
              aria-label="Update download progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.max(0, Math.min(100, status.percent))}
            >
              <div
                className={`h-full rounded-full transition-[width] duration-500 ease-out ${
                  status.method === 'full' ? 'bg-amber-500' : 'bg-teal-500'
                }`}
                style={{ width: `${Math.max(0, Math.min(100, status.percent))}%` }}
              />
            </div>
          </div>
        )}
        {status.state === 'error' && <span className="text-sm text-red-600 dark:text-red-400">{status.message}</span>}
      </div>
      {status.state === 'downloaded' && (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg bg-teal-50 p-3 text-sm dark:bg-teal-500/10">
          <span className="text-teal-700 dark:text-teal-300">Version {status.version} is downloaded and ready.</span>
          <button onClick={() => window.desktop?.installUpdate()} className="rounded-md bg-teal-600 px-3 py-1.5 text-xs font-medium text-white">
            Restart & Update
          </button>
        </div>
      )}
    </section>
  );
}
