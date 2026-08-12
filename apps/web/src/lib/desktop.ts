export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'not-available'; version: string }
  | { state: 'available'; version: string }
  | {
      state: 'downloading';
      percent: number;
      transferred: number;
      total: number;
      bytesPerSecond: number;
      method: 'differential' | 'full' | 'unknown';
    }
  | { state: 'downloaded'; version: string }
  | { state: 'error'; message: string };

interface DesktopBridge {
  getAppVersion: () => Promise<string>;
  checkForUpdates: () => Promise<{ ok: boolean; message?: string }>;
  installUpdate: () => Promise<void>;
  onUpdateStatus: (cb: (status: UpdateStatus) => void) => () => void;
  showAttention: (alert: { id: string; title: string; body: string }) => Promise<void>;
  escalateAttention: () => Promise<void>;
  clearAttention: (id: string) => Promise<void>;
  onAttentionOpen: (cb: (id: string) => void) => () => void;
}

declare global {
  interface Window {
    desktop?: DesktopBridge;
  }
}

/** True only inside the packaged/dev Electron shell — absent on the plain web app. */
export function isDesktopApp(): boolean {
  return typeof window !== 'undefined' && !!window.desktop;
}
