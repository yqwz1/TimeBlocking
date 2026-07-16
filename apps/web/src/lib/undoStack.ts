import { useCallback, useEffect, useState } from 'react';

export interface UndoCommand {
  /** Short human-readable description shown in tooltips/toasts, e.g. `Edit "Write report"`. */
  label: string;
  undo: () => Promise<void> | void;
  redo: () => Promise<void> | void;
}

type Listener = () => void;

/**
 * Global, component-independent undo/redo history. Mutation hooks in hooks.ts push a command
 * here on success; commands call the API directly (not `.mutate()`) so they still work after
 * the component that triggered the original action has unmounted (e.g. undoing a calendar move
 * while sitting on the Tasks page).
 */
class UndoStack {
  private past: UndoCommand[] = [];
  private future: UndoCommand[] = [];
  private listeners = new Set<Listener>();
  private busy = false;

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const l of this.listeners) l();
  }

  push(cmd: UndoCommand) {
    this.past.push(cmd);
    this.future = [];
    this.emit();
  }

  get canUndo() {
    return this.past.length > 0;
  }

  get canRedo() {
    return this.future.length > 0;
  }

  get undoLabel() {
    return this.past[this.past.length - 1]?.label;
  }

  get redoLabel() {
    return this.future[this.future.length - 1]?.label;
  }

  async undo() {
    if (this.busy || !this.past.length) return;
    this.busy = true;
    const cmd = this.past.pop()!;
    try {
      await cmd.undo();
      this.future.push(cmd);
    } catch (err) {
      // Put it back so a failed network call doesn't silently drop history.
      this.past.push(cmd);
      throw err;
    } finally {
      this.busy = false;
      this.emit();
    }
  }

  async redo() {
    if (this.busy || !this.future.length) return;
    this.busy = true;
    const cmd = this.future.pop()!;
    try {
      await cmd.redo();
      this.past.push(cmd);
    } catch (err) {
      this.future.push(cmd);
      throw err;
    } finally {
      this.busy = false;
      this.emit();
    }
  }

  clear() {
    this.past = [];
    this.future = [];
    this.emit();
  }
}

export const undoStack = new UndoStack();

/** Subscribes a component to the undo/redo history so it can render enabled/disabled buttons. */
export function useUndoRedo() {
  const [, force] = useState(0);
  useEffect(() => undoStack.subscribe(() => force((n) => n + 1)), []);

  const undo = useCallback(() => {
    void undoStack.undo();
  }, []);
  const redo = useCallback(() => {
    void undoStack.redo();
  }, []);

  return {
    canUndo: undoStack.canUndo,
    canRedo: undoStack.canRedo,
    undoLabel: undoStack.undoLabel,
    redoLabel: undoStack.redoLabel,
    undo,
    redo,
  };
}

function isTypingTarget(el: EventTarget | null) {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

/** App-wide Ctrl/Cmd+Z (undo) and Ctrl/Cmd+Y or Ctrl/Cmd+Shift+Z (redo). Ignored while typing. */
export function useUndoRedoShortcuts() {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        void undoStack.undo();
      } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
        e.preventDefault();
        void undoStack.redo();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
}
