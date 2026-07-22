import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

export interface DesktopSettings {
  closeToTray: boolean;
  launchAtStartup: boolean;
  showPet: boolean;
  playfulPet: boolean;
}

const DEFAULTS: DesktopSettings = {
  closeToTray: true,
  // Ships on: the app lives in the tray, so starting with the OS is the expected behavior.
  launchAtStartup: true,
  showPet: true,
  playfulPet: true,
};

const settingsPath = () => path.join(app.getPath('userData'), 'desktop-settings.json');

export function loadSettings(): DesktopSettings {
  try {
    const raw = JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
    return { ...DEFAULTS, ...raw };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(settings: DesktopSettings) {
  try {
    fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2));
  } catch (err) {
    console.error('[desktop] Failed to save settings:', err);
  }
}

export interface WindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
  isMaximized: boolean;
}

const windowStatePath = () => path.join(app.getPath('userData'), 'window-state.json');

export function loadWindowState(): WindowState | null {
  try {
    const raw = JSON.parse(fs.readFileSync(windowStatePath(), 'utf8'));
    if (typeof raw.width === 'number' && typeof raw.height === 'number') {
      return raw as WindowState;
    }
    return null;
  } catch {
    return null;
  }
}

export function saveWindowState(state: WindowState) {
  try {
    fs.writeFileSync(windowStatePath(), JSON.stringify(state, null, 2));
  } catch (err) {
    console.error('[desktop] Failed to save window state:', err);
  }
}
