import { contextBridge, ipcRenderer } from 'electron';

export interface PetBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  workArea: { x: number; y: number; width: number; height: number };
  platforms: Array<{ x: number; y: number; width: number; height: number }>;
}

export interface PetCursor {
  x: number;
  y: number;
  idle: number;
}

export interface PetAppContext {
  process: string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  media?: { process: string; title: string } | null;
}

contextBridge.exposeInMainWorld('pet', {
  getBounds: (): Promise<PetBounds | null> => ipcRenderer.invoke('pet:bounds'),
  setPosition: (x: number, y: number, crossDisplays = false): void =>
    ipcRenderer.send('pet:set-position', x, y, crossDisplays),
  openApp: (): void => ipcRenderer.send('pet:open-app'),
  showMenu: (): void => ipcRenderer.send('pet:menu'),
  renameComplete: (): void => ipcRenderer.send('pet:rename-complete'),
  onDo: (cb: (action: string) => void): void => {
    ipcRenderer.on('pet:do', (_event, action: string) => cb(action));
  },
  onCursor: (cb: (cursor: PetCursor) => void): void => {
    ipcRenderer.on('pet:cursor', (_event, cursor: PetCursor) => cb(cursor));
  },
  onContext: (cb: (context: PetAppContext | null) => void): void => {
    ipcRenderer.on('pet:context', (_event, context: PetAppContext | null) => cb(context));
  },
  onRename: (cb: () => void): void => {
    ipcRenderer.on('pet:rename', cb);
  },
});
