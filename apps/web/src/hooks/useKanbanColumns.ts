import { useCallback, useEffect, useRef, useState } from 'react';
import type { TaskStatus } from '@timeblock/shared';

const MIN_WIDTH = 220;
const MAX_WIDTH = 480;
const DEFAULT_WIDTH = 288;
const COLLAPSED_WIDTH = 44;

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

/** Persists per-column order/width/collapsed state for the Kanban view (drag-to-reorder columns, resize, collapse). */
export function useKanbanColumns(storageKey: string, defaultOrder: TaskStatus[]) {
  const [order, setOrder] = useState<TaskStatus[]>(() => {
    const stored = loadJson<TaskStatus[]>(`${storageKey}.order`, defaultOrder);
    const known = stored.filter((s) => defaultOrder.includes(s));
    const missing = defaultOrder.filter((s) => !known.includes(s));
    return [...known, ...missing];
  });
  const [widths, setWidths] = useState<Partial<Record<TaskStatus, number>>>(() => loadJson(`${storageKey}.widths`, {}));
  const [collapsed, setCollapsed] = useState<Set<TaskStatus>>(() => new Set(loadJson<TaskStatus[]>(`${storageKey}.collapsed`, [])));
  const [resizing, setResizing] = useState<TaskStatus | null>(null);
  const dragState = useRef<{ startX: number; startWidth: number; status: TaskStatus } | null>(null);

  useEffect(() => {
    localStorage.setItem(`${storageKey}.order`, JSON.stringify(order));
  }, [storageKey, order]);
  useEffect(() => {
    localStorage.setItem(`${storageKey}.widths`, JSON.stringify(widths));
  }, [storageKey, widths]);
  useEffect(() => {
    localStorage.setItem(`${storageKey}.collapsed`, JSON.stringify([...collapsed]));
  }, [storageKey, collapsed]);

  // Reconcile the persisted order when the set of visible columns changes (e.g. cancelled column toggled).
  const syncColumns = useCallback((cols: TaskStatus[]) => {
    setOrder((prev) => {
      const known = prev.filter((s) => cols.includes(s));
      const missing = cols.filter((s) => !known.includes(s));
      const next = [...known, ...missing];
      return next.length === prev.length && next.every((s, i) => s === prev[i]) ? prev : next;
    });
  }, []);

  const widthOf = useCallback((status: TaskStatus) => (collapsed.has(status) ? COLLAPSED_WIDTH : (widths[status] ?? DEFAULT_WIDTH)), [widths, collapsed]);
  const isCollapsed = useCallback((status: TaskStatus) => collapsed.has(status), [collapsed]);

  const toggleCollapsed = useCallback((status: TaskStatus) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
  }, []);

  const startResize = useCallback(
    (status: TaskStatus, e: React.MouseEvent) => {
      e.preventDefault();
      if (collapsed.has(status)) return;
      dragState.current = { startX: e.clientX, startWidth: widths[status] ?? DEFAULT_WIDTH, status };
      setResizing(status);
    },
    [widths, collapsed],
  );

  useEffect(() => {
    if (!resizing) return;
    const onMove = (e: MouseEvent) => {
      if (!dragState.current) return;
      const delta = e.clientX - dragState.current.startX;
      const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, dragState.current.startWidth + delta));
      setWidths((prev) => ({ ...prev, [dragState.current!.status]: next }));
    };
    const onUp = () => {
      dragState.current = null;
      setResizing(null);
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [resizing]);

  const moveColumn = useCallback((from: TaskStatus, to: TaskStatus) => {
    if (from === to) return;
    setOrder((prev) => {
      const fromIdx = prev.indexOf(from);
      const toIdx = prev.indexOf(to);
      if (fromIdx < 0 || toIdx < 0) return prev;
      const next = [...prev];
      next.splice(fromIdx, 1);
      next.splice(toIdx, 0, from);
      return next;
    });
  }, []);

  return { order, widthOf, isCollapsed, toggleCollapsed, startResize, resizing, moveColumn, syncColumns, COLLAPSED_WIDTH };
}
