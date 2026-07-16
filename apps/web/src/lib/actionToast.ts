import { useEffect, useState } from 'react';

/**
 * Lightweight, component-independent bus for transient "you just did X — Undo?" toasts,
 * shown bottom-left (distinct from the bottom-right XP/celebration toasts). Mutation hooks
 * push here; the undo callback runs the reverse action directly against the API so it still
 * works after the originating component unmounts. Kept separate from the global undoStack so
 * the toast's Undo always targets *this* action, not whatever happens to be on the stack top.
 */
export interface ActionToast {
  id: string;
  message: string;
  /** Label for the action button; defaults to "Undo". */
  actionLabel?: string;
  onAction: () => void | Promise<void>;
}

type Listener = () => void;

const DISMISS_MS = 6000;

class ActionToastBus {
  private toasts: ActionToast[] = [];
  private listeners = new Set<Listener>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private seq = 0;

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const l of this.listeners) l();
  }

  get current(): ActionToast[] {
    return this.toasts;
  }

  show(message: string, onAction: () => void | Promise<void>, actionLabel = 'Undo'): string {
    const id = `at-${++this.seq}`;
    this.toasts = [...this.toasts, { id, message, onAction, actionLabel }];
    const timer = setTimeout(() => this.dismiss(id), DISMISS_MS);
    this.timers.set(id, timer);
    this.emit();
    return id;
  }

  dismiss(id: string) {
    const timer = this.timers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(id);
    }
    const before = this.toasts.length;
    this.toasts = this.toasts.filter((t) => t.id !== id);
    if (this.toasts.length !== before) this.emit();
  }

  async run(id: string) {
    const toast = this.toasts.find((t) => t.id === id);
    if (!toast) return;
    this.dismiss(id);
    await toast.onAction();
  }
}

export const actionToasts = new ActionToastBus();

/** Convenience: push an "Undo" toast. Returns the toast id. */
export function showUndoToast(message: string, onUndo: () => void | Promise<void>): string {
  return actionToasts.show(message, onUndo);
}

/** Subscribes a component to the live toast list. */
export function useActionToasts(): ActionToast[] {
  const [, force] = useState(0);
  useEffect(() => actionToasts.subscribe(() => force((n) => n + 1)), []);
  return actionToasts.current;
}
