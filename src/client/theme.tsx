import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export type ThemePref = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'usage-console-theme';
const QUERY = '(prefers-color-scheme: dark)';

function readPref(): ThemePref {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === 'light' || saved === 'dark' || saved === 'system') return saved;
  } catch {
    // Storage can be blocked; follow the system.
  }
  return 'system';
}

function resolve(pref: ThemePref): ResolvedTheme {
  if (pref === 'system') return window.matchMedia(QUERY).matches ? 'dark' : 'light';
  return pref;
}

function apply(theme: ResolvedTheme): void {
  document.documentElement.dataset.theme = theme;
}

interface ThemeValue {
  pref: ThemePref;
  resolved: ResolvedTheme;
  setPref: (pref: ThemePref) => void;
}

const ThemeContext = createContext<ThemeValue | null>(null);

/**
 * The stylesheet only looks at `data-theme` on <html>. index.html sets it before first paint from the same
 * stored preference; this provider keeps it in sync when the choice or the system setting changes.
 */
export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [pref, setPrefState] = useState<ThemePref>(readPref);
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolve(readPref()));

  useEffect(() => {
    const update = () => {
      const next = resolve(pref);
      setResolved(next);
      apply(next);
    };
    update();
    if (pref !== 'system') return;
    const media = window.matchMedia(QUERY);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [pref]);

  const setPref = useCallback((next: ThemePref) => {
    setPrefState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Not persisted; the choice still applies for this session.
    }
  }, []);

  const value = useMemo(() => ({ pref, resolved, setPref }), [pref, resolved, setPref]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export function useTheme(): ThemeValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme must be used inside ThemeProvider');
  return value;
}
