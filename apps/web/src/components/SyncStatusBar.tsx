import { useEffect, useState } from 'react';
import { useSyncStatus, useManualSync } from '../hooks.js';

/** Reactive `navigator.onLine`, so the bar flips to "offline" the instant the link drops. */
function useBrowserOnline(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

function relTime(iso: string | null): string {
  if (!iso) return 'never';
  const ms = Date.now() - Date.parse(iso);
  if (ms < 5_000) return 'just now';
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  return `${Math.round(ms / 3_600_000)}h ago`;
}

export default function SyncStatusBar() {
  const { data } = useSyncStatus();
  const sync = useManualSync();
  const browserOnline = useBrowserOnline();

  // Offline is a paused state, not an error: the browser reports no connection, or
  // the server's last Google attempt failed on the network. Show it neutrally.
  const offline = !browserOnline || !!data?.offline;

  const color = !data
    ? 'bg-slate-300'
    : offline
      ? 'bg-slate-400'
      : data.lastError
        ? 'bg-red-500'
        : data.running
          ? 'bg-amber-400 animate-pulse'
          : 'bg-emerald-500';
  const label = !data
    ? 'loading…'
    : offline
      ? 'offline · sync paused'
      : data.lastError
        ? data.lastError
        : data.running
          ? 'syncing…'
          : `synced ${relTime(data.lastCycleAt)}`;

  return (
    <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-neutral-400">
      <span className={`h-2 w-2 rounded-full ${color}`} />
      <span className="max-w-[16rem] truncate" title={label}>
        {label}
      </span>
      <button
        onClick={() => sync.mutate()}
        disabled={sync.isPending || data?.running}
        className="rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-neutral-800 dark:text-neutral-400 dark:hover:bg-white/5 disabled:opacity-50"
      >
        Sync now
      </button>
    </div>
  );
}
