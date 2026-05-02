import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { THEME_STORAGE_KEY } from '../local/localSettings';
import { ThemeProvider, useTheme } from './theme';

function createStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key) {
      return map.has(key) ? map.get(key) ?? null : null;
    },
    key(index) {
      return [...map.keys()][index] ?? null;
    },
    removeItem(key) {
      map.delete(key);
    },
    setItem(key, value) {
      map.set(key, value);
    },
  } as Storage;
}

let lastThemeState: {
  theme: string;
  themePreference: string;
} | null = null;

function ThemeProbe() {
  const themeState = useTheme();
  lastThemeState = {
    theme: themeState.theme,
    themePreference: themeState.themePreference,
  };
  return null;
}

function renderThemeProbe() {
  lastThemeState = null;
  renderToStaticMarkup(
    React.createElement(ThemeProvider, null, React.createElement(ThemeProbe)),
  );
  return lastThemeState;
}

describe('theme preferences', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    lastThemeState = null;
  });

  it('defaults to the system preference when nothing is stored', () => {
    expect(renderThemeProbe()).toEqual({
      theme: 'light',
      themePreference: 'system',
    });
  });

  it('reads an explicit stored theme preference', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');

    expect(renderThemeProbe()).toEqual({
      theme: 'dark',
      themePreference: 'dark',
    });
  });

  it('falls back to system for invalid stored values', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'sepia');

    expect(renderThemeProbe()).toEqual({
      theme: 'light',
      themePreference: 'system',
    });
  });

  it('resolves the system preference from a dark system theme', () => {
    vi.stubGlobal('window', {
      matchMedia: vi.fn().mockReturnValue({
        matches: true,
        addEventListener: undefined,
        removeEventListener: undefined,
        addListener: vi.fn(),
        removeListener: vi.fn(),
      }),
    });

    expect(renderThemeProbe()).toEqual({
      theme: 'dark',
      themePreference: 'system',
    });
  });
});
