import { app, ipcMain, Menu, Notification, Tray, type BrowserWindow } from 'electron';
import updater from 'electron-updater';
import type { UpdateStatus } from './preload.js';

const { autoUpdater } = updater;

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

// Non-blocking auto-update: download in the background, install on quit (or
// on demand via the renderer's "Restart & Update" button). Offline or
// missing-feed errors surface to the renderer instead of just being logged.
export function initUpdater(tray: Tray | null, rebuildMenu: (extra?: Electron.MenuItemConstructorOptions[]) => Menu, getWindow: () => BrowserWindow | null) {
  ipcMain.handle('app:version', () => app.getVersion());

  if (!app.isPackaged) {
    ipcMain.handle('updater:check', (): { ok: boolean; message?: string } => ({
      ok: false,
      message: 'Updates only run in the installed app, not in dev mode.',
    }));
    ipcMain.handle('updater:install', () => {});
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  const broadcast = (status: UpdateStatus) => {
    getWindow()?.webContents.send('updater:status', status);
  };

  autoUpdater.on('checking-for-update', () => broadcast({ state: 'checking' }));
  autoUpdater.on('update-not-available', (info) => broadcast({ state: 'not-available', version: info.version }));
  autoUpdater.on('update-available', (info) => broadcast({ state: 'available', version: info.version }));
  autoUpdater.on('download-progress', (p) => broadcast({ state: 'downloading', percent: Math.round(p.percent) }));

  autoUpdater.on('error', (err) => {
    console.warn('[updater]', err?.message ?? err);
    broadcast({ state: 'error', message: err?.message ?? String(err) });
  });

  autoUpdater.on('update-downloaded', (info) => {
    broadcast({ state: 'downloaded', version: info.version });
    new Notification({
      title: 'TimeBlock update ready',
      body: `Version ${info.version} downloaded — restart to install.`,
    }).show();

    tray?.setContextMenu(
      rebuildMenu([
        { type: 'separator' },
        { label: `Restart to update (v${info.version})`, click: () => autoUpdater.quitAndInstall() },
      ]),
    );
  });

  ipcMain.handle('updater:check', async (): Promise<{ ok: boolean; message?: string }> => {
    try {
      await autoUpdater.checkForUpdates();
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      broadcast({ state: 'error', message });
      return { ok: false, message };
    }
  });

  ipcMain.handle('updater:install', () => {
    autoUpdater.quitAndInstall();
  });

  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  void check();
  setInterval(check, CHECK_INTERVAL_MS);
}
