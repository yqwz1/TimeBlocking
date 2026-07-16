import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

type ThemeSetting = 'light' | 'dark' | 'system';
type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'tb-theme';

function systemTheme(): ResolvedTheme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function readStoredSetting(): ThemeSetting {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system';
}

function applyResolvedTheme(theme: ResolvedTheme) {
  document.documentElement.classList.toggle('dark', theme === 'dark');
}

const ThemeContext = createContext<{
  setting: ThemeSetting;
  resolved: ResolvedTheme;
  setSetting: (setting: ThemeSetting) => void;
} | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [setting, setSetting] = useState<ThemeSetting>(() => readStoredSetting());
  const [resolved, setResolved] = useState<ResolvedTheme>(() =>
    setting === 'system' ? systemTheme() : setting,
  );

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, setting);
    if (setting !== 'system') {
      setResolved(setting);
      applyResolvedTheme(setting);
      return;
    }
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => {
      const next = mql.matches ? 'dark' : 'light';
      setResolved(next);
      applyResolvedTheme(next);
    };
    update();
    mql.addEventListener('change', update);
    return () => mql.removeEventListener('change', update);
  }, [setting]);

  const value = useMemo(() => ({ setting, resolved, setSetting }), [setting, resolved]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
