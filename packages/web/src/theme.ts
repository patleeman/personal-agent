import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { THEME_STORAGE_KEY } from './localSettings';

export type Theme = 'light' | 'dark';
export type ThemePreference = Theme | 'system';

const DEFAULT_THEME_PREFERENCE: ThemePreference = 'system';
const SYSTEM_THEME_QUERY = '(prefers-color-scheme: dark)';

interface ThemeContextValue {
  theme: Theme;
  themePreference: ThemePreference;
  setThemePreference: (theme: ThemePreference) => void;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function applyTheme(theme: Theme) {
  if (typeof document === 'undefined') {
    return;
  }

  if (theme === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
}

function readSystemTheme(): Theme {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'light';
  }

  return window.matchMedia(SYSTEM_THEME_QUERY).matches ? 'dark' : 'light';
}

export function resolveThemePreference(preference: ThemePreference, systemTheme: Theme = 'light'): Theme {
  return preference === 'system' ? systemTheme : preference;
}

export function readStoredThemePreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === 'system' || stored === 'light' || stored === 'dark') {
      return stored;
    }
  } catch {
    // ignore
  }

  return DEFAULT_THEME_PREFERENCE;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themePreference, setThemePreferenceState] = useState<ThemePreference>(() => {
    const currentPreference = readStoredThemePreference();
    applyTheme(resolveThemePreference(currentPreference, readSystemTheme()));
    return currentPreference;
  });
  const [systemTheme, setSystemTheme] = useState<Theme>(() => readSystemTheme());

  const theme = useMemo(
    () => resolveThemePreference(themePreference, systemTheme),
    [systemTheme, themePreference],
  );

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    if (themePreference !== 'system' || typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return undefined;
    }

    const mediaQuery = window.matchMedia(SYSTEM_THEME_QUERY);
    const updateSystemTheme = (matches: boolean) => {
      setSystemTheme(matches ? 'dark' : 'light');
    };
    const handleChange = (event: Event) => {
      updateSystemTheme((event as MediaQueryListEvent).matches);
    };
    const legacyHandleChange = (event: MediaQueryListEvent) => {
      updateSystemTheme(event.matches);
    };

    updateSystemTheme(mediaQuery.matches);

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleChange);
      return () => {
        mediaQuery.removeEventListener('change', handleChange);
      };
    }

    mediaQuery.addListener(legacyHandleChange);
    return () => {
      mediaQuery.removeListener(legacyHandleChange);
    };
  }, [themePreference]);

  const setThemePreference = useCallback((nextThemePreference: ThemePreference) => {
    const nextSystemTheme = nextThemePreference === 'system' ? readSystemTheme() : systemTheme;
    const nextTheme = resolveThemePreference(nextThemePreference, nextSystemTheme);

    setThemePreferenceState(nextThemePreference);
    if (nextThemePreference === 'system') {
      setSystemTheme(nextSystemTheme);
    }
    applyTheme(nextTheme);

    try {
      localStorage.setItem(THEME_STORAGE_KEY, nextThemePreference);
    } catch {
      // Ignore storage failures.
    }
  }, [systemTheme]);

  const toggle = useCallback(() => {
    setThemePreference(theme === 'light' ? 'dark' : 'light');
  }, [setThemePreference, theme]);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, themePreference, setThemePreference, toggle }),
    [setThemePreference, theme, themePreference, toggle],
  );

  return createElement(ThemeContext.Provider, { value }, children);
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return value;
}
