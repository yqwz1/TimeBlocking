import { useEffect, useState } from 'react';
import { CheckCircle2, Download, RefreshCw } from 'lucide-react';
import { isDesktopApp, type UpdateStatus } from '../lib/desktop.js';

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
          <span className="flex items-center gap-1.5 text-sm text-slate-500 dark:text-neutral-400">
            <Download size={14} /> Downloading… {status.percent}%
          </span>
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
