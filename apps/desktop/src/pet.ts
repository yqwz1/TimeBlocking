import { BrowserWindow, ipcMain, Menu, powerMonitor, screen } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PET_WIDTH = 200;
const PET_HEIGHT = 175;

let petWindow: BrowserWindow | null = null;
let ipcRegistered = false;
let cursorTimer: NodeJS.Timeout | null = null;

export interface PetCallbacks {
  onHide: () => void;
  onOpenApp: () => void;
}

export function hasPetWindow(): boolean {
  return petWindow !== null;
}

function sendToPet(channel: string, ...args: unknown[]) {
  if (petWindow && !petWindow.webContents.isDestroyed()) {
    petWindow.webContents.send(channel, ...args);
  }
}

export function initPetIpc(callbacks: PetCallbacks) {
  if (ipcRegistered) return;
  ipcRegistered = true;

  ipcMain.handle('pet:bounds', () => {
    if (!petWindow) return null;
    const [x, y] = petWindow.getPosition();
    const workArea = screen.getDisplayMatching(petWindow.getBounds()).workArea;
    return { x, y, width: PET_WIDTH, height: PET_HEIGHT, workArea };
  });

  ipcMain.on('pet:set-position', (_event, x: number, y: number) => {
    if (!petWindow || typeof x !== 'number' || typeof y !== 'number') return;
    const wa = screen.getDisplayMatching(petWindow.getBounds()).workArea;
    const clampedX = Math.min(Math.max(x, wa.x - 40), wa.x + wa.width - PET_WIDTH + 40);
    const clampedY = Math.min(Math.max(y, wa.y), wa.y + wa.height - PET_HEIGHT);
    petWindow.setPosition(Math.round(clampedX), Math.round(clampedY));
  });

  ipcMain.on('pet:open-app', () => callbacks.onOpenApp());

  ipcMain.on('pet:menu', () => {
    if (!petWindow) return;
    Menu.buildFromTemplate([
      { label: 'Feed 🍗', click: () => sendToPet('pet:do', 'feed') },
      { label: 'Play 🧶', click: () => sendToPet('pet:do', 'play') },
      { type: 'separator' },
      { label: 'Open TimeBlock', click: callbacks.onOpenApp },
      { type: 'separator' },
      { label: 'Hide pet', click: callbacks.onHide },
    ]).popup({ window: petWindow });
  });
}

export function createPetWindow() {
  if (petWindow) return;
  const wa = screen.getPrimaryDisplay().workArea;
  petWindow = new BrowserWindow({
    width: PET_WIDTH,
    height: PET_HEIGHT,
    x: wa.x + wa.width - PET_WIDTH - 80,
    y: wa.y + wa.height - PET_HEIGHT,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    // Never steal keyboard focus from whatever the user is working in.
    focusable: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: path.join(__dirname, 'pet-preload.js'),
    },
  });
  petWindow.setAlwaysOnTop(true, 'floating');
  petWindow.setMenu(null);
  void petWindow.loadFile(path.join(__dirname, 'pet.html'));
  petWindow.on('closed', () => {
    petWindow = null;
    stopCursorFeed();
  });

  // Cursor + system-idle feed: lets the pet's eyes follow the mouse, chase it,
  // and fall asleep when the user steps away from the keyboard.
  startCursorFeed();
}

function startCursorFeed() {
  if (cursorTimer) return;
  cursorTimer = setInterval(() => {
    if (!petWindow) return;
    const pt = screen.getCursorScreenPoint();
    sendToPet('pet:cursor', { x: pt.x, y: pt.y, idle: powerMonitor.getSystemIdleTime() });
  }, 150);
}

function stopCursorFeed() {
  if (cursorTimer) {
    clearInterval(cursorTimer);
    cursorTimer = null;
  }
}

export function destroyPetWindow() {
  stopCursorFeed();
  if (!petWindow) return;
  petWindow.destroy();
  petWindow = null;
}
