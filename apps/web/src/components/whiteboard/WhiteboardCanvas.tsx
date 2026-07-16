import { useEffect, useRef, useState } from 'react';
import { ClipboardList, Droplet, Grid3x3, Palette, SlidersHorizontal, StickyNote } from 'lucide-react';
import {
  CaptureUpdateAction,
  Excalidraw,
  ROUNDNESS,
  THEME,
  convertToExcalidrawElements,
  newElementWith,
  viewportCoordsToSceneCoords,
} from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import type { BinaryFileData, ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import type { TaskDTO } from '@timeblock/shared';
import { useTheme } from '../../hooks/useTheme.js';
import { whiteboardApi } from '../../lib/whiteboardApi.js';
import InsertTaskPopover from './InsertTaskPopover.js';
import InsertTablePopover from './InsertTablePopover.js';
import ExportPopover from './ExportPopover.js';
import PenStylePopover, { type PenPreset } from './PenStylePopover.js';

const SAVE_DEBOUNCE_MS = 900;
const STROKE_COLORS = ['#1e1e1e', '#e03131', '#2f9e44', '#1971c2', '#f08c00', '#9c36b5'];

function pickPersistedAppState(appState: {
  viewBackgroundColor: string;
  scrollX: number;
  scrollY: number;
  zoom: { value: number };
  gridModeEnabled: boolean;
}) {
  return {
    viewBackgroundColor: appState.viewBackgroundColor,
    scrollX: appState.scrollX,
    scrollY: appState.scrollY,
    zoom: appState.zoom.value,
    gridModeEnabled: appState.gridModeEnabled,
  };
}

export default function WhiteboardCanvas({
  boardId,
  boardName,
  onOpenTask,
}: {
  boardId: string;
  boardName: string;
  onOpenTask: (taskId: string) => void;
}) {
  const { resolved } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const uploadedFileIds = useRef<Set<string>>(new Set());
  const [selectedTask, setSelectedTask] = useState<{ id: string; title: string } | null>(null);
  const [gridEnabled, setGridEnabled] = useState(true);
  const [strokeWidth, setStrokeWidth] = useState(2);
  const [strokeColor, setStrokeColor] = useState('#1e1e1e');
  const [opacity, setOpacity] = useState(100);

  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    },
    [],
  );

  function sceneCenter(): { x: number; y: number } {
    const api = apiRef.current;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!api || !rect) return { x: 0, y: 0 };
    return viewportCoordsToSceneCoords({ clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 }, api.getAppState());
  }

  function insertElements(newEls: ReturnType<typeof convertToExcalidrawElements>) {
    const api = apiRef.current;
    if (!api) return;
    api.updateScene({ elements: [...api.getSceneElements(), ...newEls], captureUpdate: CaptureUpdateAction.IMMEDIATELY });
  }

  function handleInsertTask(task: TaskDTO) {
    const { x, y } = sceneCenter();
    const els = convertToExcalidrawElements([
      {
        type: 'rectangle',
        x: x - 110,
        y: y - 32,
        width: 220,
        height: 64,
        backgroundColor: '#ccfbf1',
        strokeColor: '#0d9488',
        roundness: { type: ROUNDNESS.ADAPTIVE_RADIUS },
        customData: { tbTaskId: task.id, tbTaskTitle: task.content },
        label: { text: task.content, fontSize: 14, verticalAlign: 'middle' },
      },
    ]);
    insertElements(els);
  }

  function handleInsertTable(rows: number, cols: number) {
    const { x, y } = sceneCenter();
    const cellW = 110;
    const cellH = 44;
    const groupId = crypto.randomUUID();
    const skeletons = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        skeletons.push({
          type: 'rectangle' as const,
          x: x - (cols * cellW) / 2 + c * cellW,
          y: y - (rows * cellH) / 2 + r * cellH,
          width: cellW,
          height: cellH,
          backgroundColor: 'transparent',
          strokeColor: '#94a3b8',
          groupIds: [groupId],
        });
      }
    }
    insertElements(convertToExcalidrawElements(skeletons));
  }

  function toggleGrid() {
    const api = apiRef.current;
    if (!api) return;
    const next = !gridEnabled;
    setGridEnabled(next);
    api.updateScene({ appState: { gridModeEnabled: next }, captureUpdate: CaptureUpdateAction.NEVER });
  }

  function applyPenStyle(
    props: { strokeWidth?: number; strokeColor?: string; opacity?: number },
    captureUpdate: typeof CaptureUpdateAction[keyof typeof CaptureUpdateAction],
  ) {
    const api = apiRef.current;
    if (!api) return;
    const appState = api.getAppState();
    const selectedIds = Object.keys(appState.selectedElementIds ?? {}).filter((id) => appState.selectedElementIds[id]);
    const elements = selectedIds.length
      ? api.getSceneElements().map((el) => (selectedIds.includes(el.id) ? newElementWith(el, props) : el))
      : undefined;
    const nextAppState: Partial<{ currentItemStrokeWidth: number; currentItemStrokeColor: string; currentItemOpacity: number }> = {};
    if (props.strokeWidth !== undefined) nextAppState.currentItemStrokeWidth = props.strokeWidth;
    if (props.strokeColor !== undefined) nextAppState.currentItemStrokeColor = props.strokeColor;
    if (props.opacity !== undefined) nextAppState.currentItemOpacity = props.opacity;
    api.updateScene({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- updateScene's generic K widens to require
      // all picked keys as non-optional even though only a subset is set here; it merges whatever keys are present.
      appState: nextAppState as any,
      ...(elements ? { elements } : {}),
      captureUpdate,
    });
  }

  function handleStrokeWidthInput(value: number) {
    setStrokeWidth(value);
    applyPenStyle({ strokeWidth: value }, CaptureUpdateAction.EVENTUALLY);
  }

  function handleStrokeWidthCommit(value: number) {
    applyPenStyle({ strokeWidth: value }, CaptureUpdateAction.IMMEDIATELY);
  }

  function handleStrokeColorInput(value: string) {
    setStrokeColor(value);
    applyPenStyle({ strokeColor: value }, CaptureUpdateAction.EVENTUALLY);
  }

  function handleStrokeColorCommit(value: string) {
    setStrokeColor(value);
    applyPenStyle({ strokeColor: value }, CaptureUpdateAction.IMMEDIATELY);
  }

  function handleOpacityInput(value: number) {
    setOpacity(value);
    applyPenStyle({ opacity: value }, CaptureUpdateAction.EVENTUALLY);
  }

  function handleOpacityCommit(value: number) {
    applyPenStyle({ opacity: value }, CaptureUpdateAction.IMMEDIATELY);
  }

  function handlePenPreset(preset: PenPreset) {
    setStrokeWidth(preset.strokeWidth);
    setOpacity(preset.opacity);
    applyPenStyle({ strokeWidth: preset.strokeWidth, opacity: preset.opacity }, CaptureUpdateAction.IMMEDIATELY);
    apiRef.current?.setActiveTool({ type: 'freedraw' });
  }

  function handleInsertNote() {
    const { x, y } = sceneCenter();
    const els = convertToExcalidrawElements([
      {
        type: 'rectangle',
        x: x - 90,
        y: y - 90,
        width: 180,
        height: 180,
        backgroundColor: '#fef08a',
        strokeColor: '#ca8a04',
        roundness: { type: ROUNDNESS.ADAPTIVE_RADIUS },
        label: { text: 'New note', fontSize: 16, verticalAlign: 'top', textAlign: 'left' },
      },
    ]);
    insertElements(els);
  }

  return (
    <div ref={containerRef} className="relative h-full w-full">
      <Excalidraw
        excalidrawAPI={(api) => {
          apiRef.current = api;
        }}
        theme={resolved === 'dark' ? THEME.DARK : THEME.LIGHT}
        validateEmbeddable
        initialData={async () => {
          const [scene, files] = await Promise.all([whiteboardApi.scene(boardId), whiteboardApi.files(boardId)]);
          const filesMap: Record<string, BinaryFileData> = {};
          for (const f of files) {
            uploadedFileIds.current.add(f.id);
            filesMap[f.id] = {
              id: f.id as unknown as BinaryFileData['id'],
              mimeType: f.mimeType as unknown as BinaryFileData['mimeType'],
              dataURL: f.dataUrl as unknown as BinaryFileData['dataURL'],
              created: Date.now(),
            };
          }
          const saved = scene.appState as {
            viewBackgroundColor?: string;
            scrollX?: number;
            scrollY?: number;
            zoom?: number;
            gridModeEnabled?: boolean;
          };
          const grid = saved.gridModeEnabled ?? true;
          setGridEnabled(grid);
          return {
            elements: scene.elements as never,
            appState: {
              viewBackgroundColor: saved.viewBackgroundColor,
              scrollX: saved.scrollX,
              scrollY: saved.scrollY,
              zoom: saved.zoom !== undefined ? ({ value: saved.zoom } as never) : undefined,
              gridModeEnabled: grid,
            },
            files: filesMap,
          };
        }}
        onChange={(elements, appState, files) => {
          setGridEnabled((prev) => (prev === appState.gridModeEnabled ? prev : appState.gridModeEnabled));
          setStrokeWidth((prev) => (prev === appState.currentItemStrokeWidth ? prev : appState.currentItemStrokeWidth));
          setStrokeColor((prev) => (prev === appState.currentItemStrokeColor ? prev : appState.currentItemStrokeColor));
          setOpacity((prev) => (prev === appState.currentItemOpacity ? prev : appState.currentItemOpacity));

          for (const id of Object.keys(files)) {
            if (uploadedFileIds.current.has(id)) continue;
            uploadedFileIds.current.add(id);
            const f = files[id as keyof typeof files];
            whiteboardApi.uploadFile(boardId, { id, mimeType: f.mimeType, dataUrl: f.dataURL }).catch(() => uploadedFileIds.current.delete(id));
          }

          const selectedIds = Object.keys(appState.selectedElementIds ?? {}).filter((id) => appState.selectedElementIds[id]);
          const el = selectedIds.length === 1 ? elements.find((e) => e.id === selectedIds[0]) : undefined;
          const taskId = (el?.customData as { tbTaskId?: string } | undefined)?.tbTaskId;
          const title = (el?.customData as { tbTaskTitle?: string } | undefined)?.tbTaskTitle;
          // Bail out via the functional-update reference check so a no-op selection change
          // (fired constantly by onChange during drags/hovers) doesn't re-render the parent —
          // an unconditional setState here caused a render loop against Excalidraw's own internals.
          setSelectedTask((prev) => {
            if (!taskId) return prev === null ? prev : null;
            if (prev && prev.id === taskId) return prev;
            return { id: taskId, title: title ?? '' };
          });

          if (saveTimer.current) clearTimeout(saveTimer.current);
          saveTimer.current = setTimeout(() => {
            whiteboardApi.saveScene(boardId, elements as unknown[], pickPersistedAppState(appState)).catch(() => {});
          }, SAVE_DEBOUNCE_MS);
        }}
        renderTopRightUI={() => (
          <div className="flex items-center gap-1.5">
            <InsertTaskPopover onInsert={handleInsertTask} />
            <InsertTablePopover onInsert={handleInsertTable} />
            <ExportPopover apiRef={apiRef} boardName={boardName} />
            <PenStylePopover strokeColor={strokeColor} onApply={handlePenPreset} />
            <div
              title="Pen color"
              className="flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1.5 shadow-sm dark:border-neutral-700 dark:bg-neutral-800"
            >
              {STROKE_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => handleStrokeColorCommit(c)}
                  aria-label={`Stroke color ${c}`}
                  aria-pressed={strokeColor === c}
                  style={{ backgroundColor: c }}
                  className={`h-4 w-4 shrink-0 rounded-full border ${
                    strokeColor === c
                      ? 'ring-2 ring-teal-500 ring-offset-1 ring-offset-white dark:ring-offset-neutral-800'
                      : 'border-slate-300 dark:border-neutral-600'
                  }`}
                />
              ))}
              <label
                title="Custom pen color"
                className="relative flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-full border border-slate-300 dark:border-neutral-600"
                style={STROKE_COLORS.includes(strokeColor) ? undefined : { backgroundColor: strokeColor }}
              >
                {STROKE_COLORS.includes(strokeColor) && <Palette size={10} className="text-slate-400 dark:text-neutral-500" />}
                <input
                  type="color"
                  value={strokeColor}
                  onInput={(e) => handleStrokeColorInput((e.target as HTMLInputElement).value)}
                  onChange={(e) => handleStrokeColorCommit((e.target as HTMLInputElement).value)}
                  className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                />
              </label>
            </div>
            <div
              title="Stroke width"
              className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 shadow-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
            >
              <SlidersHorizontal size={13} className="shrink-0 text-slate-400 dark:text-neutral-500" />
              <input
                type="range"
                min={1}
                max={20}
                step={1}
                value={strokeWidth}
                onChange={(e) => handleStrokeWidthInput(Number(e.target.value))}
                onMouseUp={(e) => handleStrokeWidthCommit(Number((e.target as HTMLInputElement).value))}
                onTouchEnd={(e) => handleStrokeWidthCommit(Number((e.target as HTMLInputElement).value))}
                onKeyUp={(e) => handleStrokeWidthCommit(Number((e.target as HTMLInputElement).value))}
                className="h-1 w-20 accent-teal-500"
              />
              <span className="w-4 text-right tabular-nums">{strokeWidth}</span>
            </div>
            <div
              title="Pen opacity"
              className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 shadow-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
            >
              <Droplet size={13} className="shrink-0 text-slate-400 dark:text-neutral-500" />
              <input
                type="range"
                min={10}
                max={100}
                step={10}
                value={opacity}
                onChange={(e) => handleOpacityInput(Number(e.target.value))}
                onMouseUp={(e) => handleOpacityCommit(Number((e.target as HTMLInputElement).value))}
                onTouchEnd={(e) => handleOpacityCommit(Number((e.target as HTMLInputElement).value))}
                onKeyUp={(e) => handleOpacityCommit(Number((e.target as HTMLInputElement).value))}
                className="h-1 w-16 accent-teal-500"
              />
              <span className="w-8 text-right tabular-nums">{opacity}%</span>
            </div>
            <button
              type="button"
              onClick={toggleGrid}
              title={gridEnabled ? 'Hide background grid' : 'Show background grid'}
              aria-pressed={gridEnabled}
              className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium shadow-sm ${
                gridEnabled
                  ? 'border-teal-300 bg-teal-50 text-teal-700 hover:bg-teal-100 dark:border-teal-500/40 dark:bg-teal-500/10 dark:text-teal-300 dark:hover:bg-teal-500/20'
                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700/60'
              }`}
            >
              <Grid3x3 size={13} />
              Grid
            </button>
            <button
              type="button"
              onClick={handleInsertNote}
              title="Insert a sticky note"
              className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 shadow-sm hover:bg-slate-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700/60"
            >
              <StickyNote size={13} className="text-amber-500" />
              Note
            </button>
          </div>
        )}
      />
      {selectedTask && (
        <div className="pointer-events-none absolute left-1/2 top-3 z-20 -translate-x-1/2">
          <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-teal-200 bg-white/95 px-3 py-1.5 text-xs shadow-lg backdrop-blur dark:border-teal-500/30 dark:bg-neutral-900/95">
            <ClipboardList size={13} className="shrink-0 text-teal-500" />
            <span className="max-w-[220px] truncate text-slate-700 dark:text-neutral-200">{selectedTask.title}</span>
            <button
              type="button"
              onClick={() => onOpenTask(selectedTask.id)}
              className="shrink-0 font-medium text-teal-600 hover:underline dark:text-teal-400"
            >
              Open ↗
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
