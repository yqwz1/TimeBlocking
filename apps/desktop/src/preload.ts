import { contextBridge, ipcRenderer } from 'electron';

export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'not-available'; version: string }
  | { state: 'available'; version: string }
  | { state: 'downloading'; percent: number }
  | { state: 'downloaded'; version: string }
  | { state: 'error'; message: string };

contextBridge.exposeInMainWorld('desktop', {
  getAppVersion: (): Promise<string> => ipcRenderer.invoke('app:version'),
  checkForUpdates: (): Promise<{ ok: boolean; message?: string }> => ipcRenderer.invoke('updater:check'),
  installUpdate: (): Promise<void> => ipcRenderer.invoke('updater:install'),
  onUpdateStatus: (cb: (status: UpdateStatus) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, status: UpdateStatus) => cb(status);
    ipcRenderer.on('updater:status', listener);
    return () => ipcRenderer.removeListener('updater:status', listener);
  },
});
