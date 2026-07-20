import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  screen,
  shell,
  Tray,
  utilityProcess,
  type UtilityProcess,
} from 'electron';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadSettings,
  loadWindowState,
  saveSettings,
  saveWindowState,
  type DesktopSettings,
  type WindowState,
} from './settings.js';
import { initUpdater } from './updater.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PREFERRED_PORT = 4141;
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

const isPackaged = app.isPackaged;
const RESOURCES_DIR = isPackaged ? process.resourcesPath : REPO_ROOT;

// The server bundle ships inside dist/ (see copy-assets.mjs) so it packages
// into app.asar next to node_modules — utilityProcess.fork can execute it
// straight out of the archive, and module resolution stays within the same
// tree instead of trying to cross the asar boundary into a sibling resource.
const SERVER_ENTRY = isPackaged
  ? path.join(__dirname, 'server', 'index.mjs')
  : path.join(REPO_ROOT, 'apps', 'server', 'dist', 'index.mjs');
const WEB_DIST = isPackaged
  ? path.join(RESOURCES_DIR, 'web')
  : path.join(REPO_ROOT, 'apps', 'web', 'dist');
const MIGRATIONS_DIR = isPackaged
  ? path.join(RESOURCES_DIR, 'migrations')
  : path.join(REPO_ROOT, 'apps', 'server', 'src', 'db', 'migrations');

const REPO_DATA_DIR = path.join(REPO_ROOT, 'data');
const REPO_ENV_PATH = path.join(REPO_ROOT, '.env');
const APP_DATA_DIR = app.getPath('userData');

let serverProcess: UtilityProcess | null = null;
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let settings: DesktopSettings = { closeToTray: true, launchAtStartup: false };

const ICON_PATH = path.join(__dirname, 'icon.ico');

// Listen-probe: actually binding catches non-connectable listeners that a
// connect-probe would miss. Returns the bound port (useful for port 0).
function tryListen(port: number): Promise<number | null> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once('error', () => resolve(null));
    server.listen(port, '127.0.0.1', () => {
      const bound = (server.address() as net.AddressInfo).port;
      server.close(() => resolve(bound));
    });
  });
}

// Prefer 4141; scan 4142-4144 so a running `npm run dev` server doesn't block
// the app. Ports past 4144 fall back to an OS-assigned port — Google OAuth
// with a "Web application" client only works on pre-registered redirect URIs,
// so off-range ports lose Google connect until the dev server is closed.
async function findFreePort(): Promise<number> {
  for (let port = PREFERRED_PORT; port <= PREFERRED_PORT + 3; port++) {
    if ((await tryListen(port)) !== null) return port;
  }
  const fallback = await tryListen(0);
  if (fallback === null) throw new Error('No free port available for the TimeBlock server.');
  return fallback;
}

function copyRecursiveSync(src: string, dest: string) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyRecursiveSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function bootstrapData() {
  fs.mkdirSync(APP_DATA_DIR, { recursive: true });
  const marker = path.join(APP_DATA_DIR, '.migrated');
  if (fs.existsSync(marker)) return;

  if (fs.existsSync(REPO_DATA_DIR)) {
    copyRecursiveSync(REPO_DATA_DIR, APP_DATA_DIR);
  }
  if (fs.existsSync(REPO_ENV_PATH)) {
    fs.copyFileSync(REPO_ENV_PATH, path.join(APP_DATA_DIR, '.env'));
  }
  fs.writeFileSync(marker, new Date().toISOString());
}

function startServer(port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = utilityProcess.fork(SERVER_ENTRY, [], {
      env: {
        ...process.env,
        NODE_ENV: 'production',
        PORT: String(port),
        TB_DATA_DIR: APP_DATA_DIR,
        TB_WEB_DIST: WEB_DIST,
        TB_MIGRATIONS_DIR: MIGRATIONS_DIR,
      },
      stdio: 'pipe',
    });
    serverProcess = child;

    const timeout = setTimeout(() => {
      reject(new Error('TimeBlock server did not become ready in time.'));
    }, 20_000);

    child.on('message', (message: unknown) => {
      if (message && typeof message === 'object' && (message as { type?: string }).type === 'ready') {
        clearTimeout(timeout);
        const readyPort = (message as { port?: number }).port;
        resolve(typeof readyPort === 'number' ? readyPort : port);
      }
    });

    child.stdout?.on('data', (chunk: Buffer) => console.log(`[server] ${chunk.toString().trim()}`));
    child.stderr?.on('data', (chunk: Buffer) => console.error(`[server] ${chunk.toString().trim()}`));

    child.on('exit', (code: number) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(`TimeBlock server exited early with code ${code}. Check the console for details.`));
      }
    });
  });
}

function restoredBounds(): Partial<WindowState> {
  const state = loadWindowState();
  if (!state) return {};
  // Discard saved bounds that no longer intersect any display (unplugged monitor).
  if (state.x !== undefined && state.y !== undefined) {
    const display = screen.getDisplayMatching({
      x: state.x,
      y: state.y,
      width: state.width,
      height: state.height,
    });
    const d = display.workArea;
    const intersects =
      state.x < d.x + d.width && state.x + state.width > d.x && state.y < d.y + d.height && state.y + state.height > d.y;
    if (!intersects) return { width: state.width, height: state.height, isMaximized: state.isMaximized };
  }
  return state;
}

function currentWindowState(win: BrowserWindow): WindowState {
  const bounds = win.getNormalBounds();
  return { ...bounds, isMaximized: win.isMaximized() };
}

async function createWindow(port: number) {
  const state = restoredBounds();

  const win = new BrowserWindow({
    x: state.x,
    y: state.y,
    width: state.width ?? 1440,
    height: state.height ?? 900,
    icon: ICON_PATH,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow = win;
  if (state.isMaximized) win.maximize();

  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  let saveTimer: NodeJS.Timeout | null = null;
  const debouncedSave = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveWindowState(currentWindowState(win)), 500);
  };
  win.on('resize', debouncedSave);
  win.on('move', debouncedSave);

  win.on('close', (event) => {
    saveWindowState(currentWindowState(win));
    if (!isQuitting && settings.closeToTray) {
      event.preventDefault();
      win.hide();
    }
  });

  await win.loadURL(`http://127.0.0.1:${port}`);
}

function showMainWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function syncLoginItem() {
  // In dev this would register electron.exe as a startup app — packaged only.
  if (!app.isPackaged) return;
  app.setLoginItemSettings({ openAtLogin: settings.launchAtStartup });
}

function buildTrayMenu(port: number, extra: Electron.MenuItemConstructorOptions[] = []) {
  return Menu.buildFromTemplate([
    { label: 'Open TimeBlock', click: showMainWindow },
    {
      label: 'New Task',
      click: () => {
        showMainWindow();
        void mainWindow?.loadURL(`http://127.0.0.1:${port}/tasks`);
      },
    },
    { type: 'separator' },
    {
      label: 'Close to tray',
      type: 'checkbox',
      checked: settings.closeToTray,
      click: (item) => {
        settings.closeToTray = item.checked;
        saveSettings(settings);
      },
    },
    {
      label: 'Launch at startup',
      type: 'checkbox',
      checked: app.isPackaged ? app.getLoginItemSettings().openAtLogin : settings.launchAtStartup,
      enabled: app.isPackaged,
      click: (item) => {
        settings.launchAtStartup = item.checked;
        saveSettings(settings);
        syncLoginItem();
      },
    },
    ...extra,
    { type: 'separator' },
    { label: 'Quit TimeBlock', click: () => app.quit() },
  ]);
}

function createTray(port: number) {
  tray = new Tray(ICON_PATH);
  tray.setToolTip('TimeBlock');
  tray.setContextMenu(buildTrayMenu(port));
  tray.on('double-click', showMainWindow);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

app.on('second-instance', showMainWindow);

app.whenReady().then(async () => {
  // Must match build.appId so renderer Notifications show as branded Windows toasts.
  app.setAppUserModelId('com.timeblock.desktop');

  bootstrapData();
  settings = loadSettings();
  syncLoginItem();

  let port: number;
  try {
    port = await findFreePort();
    if (port !== PREFERRED_PORT) {
      console.warn(
        `[desktop] Port ${PREFERRED_PORT} is busy (dev server?). Using port ${port}. ` +
          'Google OAuth needs this redirect URI registered unless the client is a "Desktop app" type.',
      );
    }
    port = await startServer(port);
  } catch (err) {
    dialog.showErrorBox('TimeBlock failed to start', err instanceof Error ? err.message : String(err));
    app.quit();
    return;
  }

  await createWindow(port);
  createTray(port);
  initUpdater(tray, (extra) => buildTrayMenu(port, extra));

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow(port);
  });
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('before-quit', () => {
  isQuitting = true;
  serverProcess?.kill();
});
