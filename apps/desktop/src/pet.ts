import { BrowserWindow, ipcMain, Menu, powerMonitor, screen } from 'electron';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PET_WIDTH = 200;
const PET_HEIGHT = 175;

let petWindow: BrowserWindow | null = null;
let ipcRegistered = false;
let cursorTimer: NodeJS.Timeout | null = null;
let platformTimer: NodeJS.Timeout | null = null;

interface WindowPlatform {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ActiveApp {
  process: string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  media?: { process: string; title: string } | null;
}

let platformCache: WindowPlatform[] = [];
let platformCacheAt = 0;
let platformRefresh: Promise<WindowPlatform[]> | null = null;
let activeAppCache: ActiveApp | null = null;
let activeAppKey = '';

const ENUMERATE_WINDOWS = String.raw`
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class PetWindows {
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr data);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
}
'@
$items = [System.Collections.Generic.List[object]]::new()
[PetWindows]::EnumWindows({ param($h, $unused)
  $r = New-Object PetWindows+RECT
  if ([PetWindows]::IsWindowVisible($h) -and -not [PetWindows]::IsIconic($h) -and
      [PetWindows]::GetWindowTextLength($h) -gt 0 -and
      [PetWindows]::GetWindowRect($h, [ref]$r)) {
    $w = $r.Right - $r.Left; $height = $r.Bottom - $r.Top
    if ($w -gt 120 -and $height -gt 80) {
      $items.Add([pscustomobject]@{ x=$r.Left; y=$r.Top; width=$w; height=$height })
    }
  }
  return $true
}, [IntPtr]::Zero) | Out-Null
$active = $null
$foreground = [PetWindows]::GetForegroundWindow()
if ($foreground -ne [IntPtr]::Zero) {
  $activePid = [uint32]0
  [void][PetWindows]::GetWindowThreadProcessId($foreground, [ref]$activePid)
  $activeRect = New-Object PetWindows+RECT
  $titleLength = [PetWindows]::GetWindowTextLength($foreground)
  $titleBuffer = New-Object System.Text.StringBuilder ($titleLength + 1)
  [void][PetWindows]::GetWindowText($foreground, $titleBuffer, $titleBuffer.Capacity)
  if ([PetWindows]::GetWindowRect($foreground, [ref]$activeRect)) {
    try { $processName = [Diagnostics.Process]::GetProcessById($activePid).ProcessName } catch { $processName = '' }
    $active = [pscustomobject]@{
      process=$processName; title=$titleBuffer.ToString()
      x=$activeRect.Left; y=$activeRect.Top
      width=$activeRect.Right-$activeRect.Left; height=$activeRect.Bottom-$activeRect.Top
    }
  }
}
$media = $null
try {
  $spotify = Get-Process -Name Spotify -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle } | Select-Object -First 1
  if ($spotify) { $media = [pscustomobject]@{ process='spotify'; title=$spotify.MainWindowTitle } }
} catch {}
ConvertTo-Json -Compress -Depth 3 -InputObject ([pscustomobject]@{ platforms=@($items); active=$active; media=$media })
`;

function getWindowPlatforms(): Promise<WindowPlatform[]> {
  if (process.platform !== 'win32') return Promise.resolve([]);
  if (Date.now() - platformCacheAt < 750) return Promise.resolve(platformCache);
  if (platformRefresh) return platformRefresh;

  platformRefresh = new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', ENUMERATE_WINDOWS],
      { windowsHide: true, timeout: 2500, maxBuffer: 256 * 1024 },
      (error, stdout) => {
        if (!error) {
          try {
            const parsed = JSON.parse(stdout.trim() || '{}');
            platformCache = (Array.isArray(parsed.platforms) ? parsed.platforms : []).filter((rect: WindowPlatform) =>
              rect && [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite),
            );
            const active = parsed.active;
            activeAppCache = active && typeof active.process === 'string' && typeof active.title === 'string'
              ? { ...active as ActiveApp, media: parsed.media ?? null }
              : null;
            platformCacheAt = Date.now();
          } catch {
            // Keep the last good snapshot; the desktop floor remains available.
          }
        }
        const result = platformCache;
        platformRefresh = null;
        resolve(result);
      },
    );
  });
  return platformRefresh;
}

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
    return { x, y, width: PET_WIDTH, height: PET_HEIGHT, workArea, platforms: platformCache };
  });

  ipcMain.on('pet:set-position', (_event, x: number, y: number, crossDisplays = false) => {
    if (!petWindow || typeof x !== 'number' || typeof y !== 'number') return;
    const display = crossDisplays
      ? screen.getDisplayNearestPoint({ x: Math.round(x + PET_WIDTH / 2), y: Math.round(y + PET_HEIGHT / 2) })
      : screen.getDisplayMatching(petWindow.getBounds());
    const wa = display.workArea;
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
    stopPlatformFeed();
  });

  // Cursor + system-idle feed: lets the pet's eyes follow the mouse, chase it,
  // and fall asleep when the user steps away from the keyboard.
  startCursorFeed();
  startPlatformFeed();
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

function startPlatformFeed() {
  if (platformTimer || process.platform !== 'win32') return;
  void getWindowPlatforms();
  platformTimer = setInterval(() => {
    void getWindowPlatforms().then(() => {
      const nextKey = activeAppCache
        ? `${activeAppCache.process}\n${activeAppCache.title}\n${activeAppCache.media?.title ?? ''}`
        : '';
      if (nextKey !== activeAppKey) {
        activeAppKey = nextKey;
        sendToPet('pet:context', activeAppCache);
      }
    });
  }, 1000);
}

function stopPlatformFeed() {
  if (platformTimer) {
    clearInterval(platformTimer);
    platformTimer = null;
  }
}

export function destroyPetWindow() {
  stopCursorFeed();
  stopPlatformFeed();
  if (!petWindow) return;
  petWindow.destroy();
  petWindow = null;
}
