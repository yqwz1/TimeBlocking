import { Redo2, Undo2 } from 'lucide-react';
import { useUndoRedo } from '../lib/undoStack.js';

export default function UndoRedoControls({ gameMode }: { gameMode: boolean }) {
  const { canUndo, canRedo, undoLabel, redoLabel, undo, redo } = useUndoRedo();
  const base = `rounded-md p-1.5 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${
    gameMode ? 'text-slate-300 hover:bg-white/5' : 'text-slate-600 hover:bg-slate-100 dark:text-neutral-300 dark:hover:bg-white/5'
  }`;

  return (
    <div className="flex items-center gap-0.5">
      <button
        type="button"
        onClick={undo}
        disabled={!canUndo}
        title={canUndo ? `Undo ${undoLabel} (Ctrl+Z)` : 'Nothing to undo'}
        aria-label="Undo"
        className={base}
      >
        <Undo2 size={16} />
      </button>
      <button
        type="button"
        onClick={redo}
        disabled={!canRedo}
        title={canRedo ? `Redo ${redoLabel} (Ctrl+Y)` : 'Nothing to redo'}
        aria-label="Redo"
        className={base}
      >
        <Redo2 size={16} />
      </button>
    </div>
  );
}
