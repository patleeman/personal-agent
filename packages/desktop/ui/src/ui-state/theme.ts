import { createContext, createElement, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { api } from '../client/api';
import type { ExtensionManifest } from '../extensions/types';
import { DARK_THEME_STORAGE_KEY, LIGHT_THEME_STORAGE_KEY, THEME_STORAGE_KEY } from '../local/localSettings';

type ThemeAppearance = 'light' | 'dark';
type Theme = 'tokyo-night-light' | 'tokyo-night-dark' | 'light' | 'dark' | string;
export type ThemePreference = 'light' | 'dark' | 'system';

export interface ColorTheme {
  id: Theme;
  label: string;
  appearance: ThemeAppearance;
  tokens?: Record<string, string>;
  extensionId?: string;
}

const BUILT_IN_THEMES: ColorTheme[] = [
  { id: 'tokyo-night-light', label: 'Tokyo Night Light', appearance: 'light' },
  { id: 'tokyo-night-dark', label: 'Tokyo Night Dark', appearance: 'dark' },
];

const DEFAULT_THEME_PREFERENCE: ThemePreference = 'system';
const DEFAULT_LIGHT_THEME: Theme = 'tokyo-night-light';
const DEFAULT_DARK_THEME: Theme = 'tokyo-night-dark';
const SYSTEM_THEME_QUERY = '(prefers-color-scheme: dark)';

interface ThemeContextValue {
  theme: Theme;
  themePreference: ThemePreference;
  lightTheme: Theme;
  darkTheme: Theme;
  availableThemes: ColorTheme[];
  setThemePreference: (theme: ThemePreference) => void;
  setLightTheme: (theme: Theme) => void;
  setDarkTheme: (theme: Theme) => void;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function normalizeThemeId(theme: Theme): Theme {
  if (theme === 'light') return 'tokyo-night-light';
  if (theme === 'dark') return 'tokyo-night-dark';
  return theme;
}

function findTheme(themes: ColorTheme[], theme: Theme): ColorTheme {
  const normalizedTheme = normalizeThemeId(theme);
  return themes.find((candidate) => candidate.id === normalizedTheme) ?? BUILT_IN_THEMES[0];
}

function applyTheme(theme: ColorTheme) {
  if (typeof document === 'undefined') {
    return;
  }

  document.documentElement.setAttribute('data-theme', theme.id);
  document.documentElement.setAttribute('data-theme-appearance', theme.appearance);
  document.documentElement.style.colorScheme = theme.appearance;

  for (const property of Array.from(document.documentElement.style)) {
    if (property.startsWith('--color-')) {
      document.documentElement.style.removeProperty(property);
    }
  }

  for (const [property, value] of Object.entries(theme.tokens ?? {})) {
    document.documentElement.style.setProperty(property, value);
  }

  document.documentElement.style.setProperty('--pa-bg', 'rgb(var(--color-base))');
  document.documentElement.style.setProperty('--pa-surface', 'rgb(var(--color-surface))');
  document.documentElement.style.setProperty('--pa-surface-hover', 'rgb(var(--color-elevated))');
  document.documentElement.style.setProperty('--pa-border', 'rgb(var(--color-border-default))');
  document.documentElement.style.setProperty('--pa-border-subtle', 'rgb(var(--color-border-subtle))');
  document.documentElement.style.setProperty('--pa-text', 'rgb(var(--color-primary))');
  document.documentElement.style.setProperty('--pa-text-secondary', 'rgb(var(--color-secondary))');
  document.documentElement.style.setProperty('--pa-text-dim', 'rgb(var(--color-dim))');
  document.documentElement.style.setProperty('--pa-accent', 'rgb(var(--color-accent))');
  document.documentElement.style.setProperty('--pa-accent-hover', 'rgb(var(--color-accent))');
  document.documentElement.style.setProperty('--pa-danger', 'rgb(var(--color-danger))');
  document.documentElement.style.setProperty('--pa-success', 'rgb(var(--color-success))');
  document.documentElement.style.setProperty('--pa-warning', 'rgb(var(--color-warning))');
}

function readSystemTheme(): ThemeAppearance {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'light';
  }

  return window.matchMedia(SYSTEM_THEME_QUERY).matches ? 'dark' : 'light';
}

function resolveThemePreference(preference: ThemePreference, systemTheme: ThemeAppearance, lightTheme: Theme, darkTheme: Theme): Theme {
  const appearance = preference === 'system' ? systemTheme : preference;
  return appearance === 'dark' ? darkTheme : lightTheme;
}

function isColorThemeContribution(value: unknown): value is ColorTheme {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === 'string' &&
    typeof record.label === 'string' &&
    (record.appearance === 'light' || record.appearance === 'dark') &&
    (record.tokens === undefined || (typeof record.tokens === 'object' && record.tokens !== null && !Array.isArray(record.tokens)))
  );
}

function readExtensionThemes(extensions: ExtensionManifest[]): ColorTheme[] {
  return extensions.flatMap((extension) =>
    (extension.contributes?.themes ?? []).filter(isColorThemeContribution).map((theme) => ({
      id: `${extension.id}/${theme.id}`,
      label: theme.label,
      appearance: theme.appearance,
      tokens: theme.tokens,
      extensionId: extension.id,
    })),
  );
}

function readStoredThemePreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === 'system') return 'system';
    if (stored === 'light' || stored === 'tokyo-night-light') return 'light';
    if (stored === 'dark' || stored === 'tokyo-night-dark') return 'dark';
  } catch {
    // ignore
  }

  return DEFAULT_THEME_PREFERENCE;
}

function readStoredThemeId(storageKey: string, fallback: Theme): Theme {
  try {
    const stored = localStorage.getItem(storageKey);
    if (stored && stored.trim().length > 0) return normalizeThemeId(stored);
  } catch {
    // ignore
  }

  return fallback;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themePreference, setThemePreferenceState] = useState<ThemePreference>(() => {
    const currentPreference = readStoredThemePreference();
    const lightTheme = readStoredThemeId(LIGHT_THEME_STORAGE_KEY, DEFAULT_LIGHT_THEME);
    const darkTheme = readStoredThemeId(DARK_THEME_STORAGE_KEY, DEFAULT_DARK_THEME);
    applyTheme(findTheme(BUILT_IN_THEMES, resolveThemePreference(currentPreference, readSystemTheme(), lightTheme, darkTheme)));
    return currentPreference;
  });
  const [systemTheme, setSystemTheme] = useState<ThemeAppearance>(() => readSystemTheme());
  const [lightTheme, setLightThemeState] = useState<Theme>(() => readStoredThemeId(LIGHT_THEME_STORAGE_KEY, DEFAULT_LIGHT_THEME));
  const [darkTheme, setDarkThemeState] = useState<Theme>(() => readStoredThemeId(DARK_THEME_STORAGE_KEY, DEFAULT_DARK_THEME));
  const [extensionThemes, setExtensionThemes] = useState<ColorTheme[]>([]);
  const availableThemes = useMemo(() => [...BUILT_IN_THEMES, ...extensionThemes], [extensionThemes]);

  const theme = useMemo(() => {
    const resolvedTheme = resolveThemePreference(themePreference, systemTheme, lightTheme, darkTheme);
    return findTheme(availableThemes, resolvedTheme).id;
  }, [availableThemes, darkTheme, lightTheme, systemTheme, themePreference]);

  useEffect(() => {
    applyTheme(findTheme(availableThemes, theme));
  }, [availableThemes, theme]);

  useEffect(() => {
    let cancelled = false;
    if (typeof api.extensions === 'function') {
      api
        .extensions()
        .then((extensions) => {
          if (!cancelled) setExtensionThemes(readExtensionThemes(extensions));
        })
        .catch(() => {
          if (!cancelled) setExtensionThemes([]);
        });
    } else {
      setExtensionThemes([]);
    }
    return () => {
      cancelled = true;
    };
  }, []);

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

  const setThemePreference = useCallback(
    (nextThemePreference: ThemePreference) => {
      const nextSystemTheme = nextThemePreference === 'system' ? readSystemTheme() : systemTheme;
      const nextTheme = findTheme(availableThemes, resolveThemePreference(nextThemePreference, nextSystemTheme, lightTheme, darkTheme));

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
    },
    [availableThemes, darkTheme, lightTheme, systemTheme],
  );

  const setLightTheme = useCallback((nextTheme: Theme) => {
    const normalizedTheme = normalizeThemeId(nextTheme);
    setLightThemeState(normalizedTheme);
    try {
      localStorage.setItem(LIGHT_THEME_STORAGE_KEY, normalizedTheme);
    } catch {
      // Ignore storage failures.
    }
  }, []);

  const setDarkTheme = useCallback((nextTheme: Theme) => {
    const normalizedTheme = normalizeThemeId(nextTheme);
    setDarkThemeState(normalizedTheme);
    try {
      localStorage.setItem(DARK_THEME_STORAGE_KEY, normalizedTheme);
    } catch {
      // Ignore storage failures.
    }
  }, []);

  const toggle = useCallback(() => {
    setThemePreference(findTheme(availableThemes, theme).appearance === 'light' ? 'dark' : 'light');
  }, [availableThemes, setThemePreference, theme]);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, themePreference, lightTheme, darkTheme, availableThemes, setThemePreference, setLightTheme, setDarkTheme, toggle }),
    [availableThemes, darkTheme, lightTheme, setDarkTheme, setLightTheme, setThemePreference, theme, themePreference, toggle],
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
