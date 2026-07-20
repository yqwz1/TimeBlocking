import { app, Menu, Notification, Tray } from 'electron';
import updater from 'electron-updater';

const { autoUpdater } = updater;

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

// Non-blocking auto-update: download in the background, install on quit.
// Never forces a restart; offline or missing-feed errors are logged only.
export function initUpdater(tray: Tray | null, rebuildMenu: (extra?: Electron.MenuItemConstructorOptions[]) => Menu) {
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('error', (err) => {
    console.warn('[updater]', err?.message ?? err);
  });

  autoUpdater.on('update-downloaded', (info) => {
    new Notification({
      title: 'TimeBlock update ready',
      body: `Version ${info.version} will install the next time you quit.`,
    }).show();

    tray?.setContextMenu(
      rebuildMenu([
        { type: 'separator' },
        { label: `Restart to update (v${info.version})`, click: () => autoUpdater.quitAndInstall() },
      ]),
    );
  });

  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  void check();
  setInterval(check, CHECK_INTERVAL_MS);
}
