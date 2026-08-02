import { useCallback, useEffect, useRef, useState } from 'react';

const DEFAULT_OPTIONS = {
  minWidth: 180,
  maxWidth: 420,
  defaultWidth: 224,
  collapsedWidth: 56,
};

export function useResizableSidebar(
  storageKey: string,
  options: Partial<typeof DEFAULT_OPTIONS> = {},
) {
  const { minWidth, maxWidth, defaultWidth, collapsedWidth } = { ...DEFAULT_OPTIONS, ...options };
  const [width, setWidth] = useState(() => {
    const stored = Number(localStorage.getItem(`${storageKey}.width`));
    return stored >= minWidth && stored <= maxWidth ? stored : defaultWidth;
  });
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(`${storageKey}.collapsed`) === '1');
  const [dragging, setDragging] = useState(false);
  const dragState = useRef<{ startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    localStorage.setItem(`${storageKey}.width`, String(width));
  }, [storageKey, width]);

  useEffect(() => {
    localStorage.setItem(`${storageKey}.collapsed`, collapsed ? '1' : '0');
  }, [storageKey, collapsed]);

  const startDrag = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      if (collapsed) return;
      dragState.current = { startX: e.clientX, startWidth: width };
      setDragging(true);
    },
    [collapsed, width],
  );

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      if (!dragState.current) return;
      const delta = e.clientX - dragState.current.startX;
      const next = Math.min(maxWidth, Math.max(minWidth, dragState.current.startWidth + delta));
      setWidth(next);
    };
    const onUp = () => {
      dragState.current = null;
      setDragging(false);
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
  }, [dragging, maxWidth, minWidth]);

  const toggleCollapsed = useCallback(() => setCollapsed((v) => !v), []);

  return {
    width: collapsed ? collapsedWidth : width,
    collapsed,
    dragging,
    toggleCollapsed,
    startDrag,
  };
}
