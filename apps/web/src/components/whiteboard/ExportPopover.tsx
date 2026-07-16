import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Check, ClipboardCopy, Download, Share2 } from 'lucide-react';
import { exportToBlob, exportToClipboard, exportToSvg } from '@excalidraw/excalidraw';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import { popoverVariants } from '../../lib/motion.js';

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ExportPopover({ apiRef, boardName }: { apiRef: React.RefObject<ExcalidrawImperativeAPI | null>; boardName: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function sceneArgs() {
    const api = apiRef.current;
    if (!api) return null;
    return {
      elements: api.getSceneElements(),
      appState: api.getAppState(),
      files: api.getFiles(),
    };
  }

  async function handleExportPng() {
    const scene = sceneArgs();
    if (!scene) return;
    const blob = await exportToBlob({
      ...scene,
      mimeType: 'image/png',
      getDimensions: (w: number, h: number) => ({ width: w * 2, height: h * 2, scale: 2 }),
    });
    downloadBlob(blob, `${boardName || 'whiteboard'}.png`);
    setOpen(false);
  }

  async function handleExportSvg() {
    const scene = sceneArgs();
    if (!scene) return;
    const svg = await exportToSvg(scene);
    const blob = new Blob([svg.outerHTML], { type: 'image/svg+xml' });
    downloadBlob(blob, `${boardName || 'whiteboard'}.svg`);
    setOpen(false);
  }

  async function handleCopyImage() {
    const scene = sceneArgs();
    if (!scene) return;
    await exportToClipboard({ ...scene, type: 'png' });
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Export or share this whiteboard"
        className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 shadow-sm hover:bg-slate-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700/60"
      >
        <Share2 size={13} className="text-teal-500" />
        Export
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            variants={popoverVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            style={{ transformOrigin: 'top right' }}
            className="absolute right-0 z-30 mt-1.5 w-52 overflow-hidden rounded-xl border border-slate-200 bg-white p-1 shadow-xl dark:border-neutral-800 dark:bg-neutral-900"
          >
            <button
              type="button"
              onClick={handleExportPng}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-50 dark:text-neutral-200 dark:hover:bg-white/5"
            >
              <Download size={13} className="shrink-0 text-slate-400 dark:text-neutral-500" />
              Download PNG
            </button>
            <button
              type="button"
              onClick={handleExportSvg}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-50 dark:text-neutral-200 dark:hover:bg-white/5"
            >
              <Download size={13} className="shrink-0 text-slate-400 dark:text-neutral-500" />
              Download SVG
            </button>
            <button
              type="button"
              onClick={handleCopyImage}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-50 dark:text-neutral-200 dark:hover:bg-white/5"
            >
              {copied ? (
                <Check size={13} className="shrink-0 text-teal-500" />
              ) : (
                <ClipboardCopy size={13} className="shrink-0 text-slate-400 dark:text-neutral-500" />
              )}
              {copied ? 'Copied!' : 'Copy image to clipboard'}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
