import { useEffect, useState } from 'react';

function readBoolean(key: string, fallback: boolean): boolean {
  try {
    const value = window.localStorage.getItem(key);
    return value === null ? fallback : value === '1';
  } catch {
    return fallback;
  }
}

function readStringSet(key: string): Set<string> {
  try {
    const value = JSON.parse(window.localStorage.getItem(key) ?? '[]');
    return new Set(Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []);
  } catch {
    return new Set();
  }
}

export function usePersistentBoolean(key: string, fallback: boolean) {
  const [value, setValue] = useState(() => readBoolean(key, fallback));

  useEffect(() => {
    try {
      window.localStorage.setItem(key, value ? '1' : '0');
    } catch {
      // A blocked storage area should not stop the surrounding UI from working.
    }
  }, [key, value]);

  return [value, setValue] as const;
}

export function usePersistentStringSet(key: string) {
  const [values, setValues] = useState(() => readStringSet(key));

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify([...values]));
    } catch {
      // A blocked storage area should not stop the surrounding UI from working.
    }
  }, [key, values]);

  return [values, setValues] as const;
}
