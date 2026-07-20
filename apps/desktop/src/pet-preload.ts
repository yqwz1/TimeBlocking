import { contextBridge, ipcRenderer } from 'electron';

export interface PetBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  workArea: { x: number; y: number; width: number; height: number };
}

export interface PetCursor {
  x: number;
  y: number;
  idle: number;
}

contextBridge.exposeInMainWorld('pet', {
  getBounds: (): Promise<PetBounds | null> => ipcRenderer.invoke('pet:bounds'),
  setPosition: (x: number, y: number): void => ipcRenderer.send('pet:set-position', x, y),
  openApp: (): void => ipcRenderer.send('pet:open-app'),
  showMenu: (): void => ipcRenderer.send('pet:menu'),
  onDo: (cb: (action: string) => void): void => {
    ipcRenderer.on('pet:do', (_event, action: string) => cb(action));
  },
  onCursor: (cb: (cursor: PetCursor) => void): void => {
    ipcRenderer.on('pet:cursor', (_event, cursor: PetCursor) => cb(cursor));
  },
});
