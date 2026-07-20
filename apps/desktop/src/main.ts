import { app, BrowserWindow, dialog, shell, utilityProcess, type UtilityProcess } from 'electron';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = 4141;
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

function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host: '127.0.0.1' });
    const finish = (inUse: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(inUse);
    };
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.setTimeout(1000, () => finish(false));
  });
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

function startServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = utilityProcess.fork(SERVER_ENTRY, [], {
      env: {
        ...process.env,
        NODE_ENV: 'production',
        PORT: String(PORT),
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
        resolve();
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

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    icon: path.join(__dirname, 'icon.ico'),
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  await mainWindow.loadURL(`http://127.0.0.1:${PORT}`);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

app.whenReady().then(async () => {
  const busy = await isPortInUse(PORT);
  if (busy) {
    dialog.showErrorBox(
      'TimeBlock is already running',
      `Port ${PORT} is already in use, likely by a "npm run dev" server. Close it and relaunch TimeBlock.`,
    );
    app.quit();
    return;
  }

  bootstrapData();

  try {
    await startServer();
  } catch (err) {
    dialog.showErrorBox('TimeBlock failed to start', err instanceof Error ? err.message : String(err));
    app.quit();
    return;
  }

  await createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('before-quit', () => {
  serverProcess?.kill();
});
