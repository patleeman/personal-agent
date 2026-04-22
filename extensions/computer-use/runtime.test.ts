import { describe, expect, it } from 'vitest';
import {
  chooseAppByQuery,
  chooseWindowByTitle,
  normalizeComputerUseAction,
  normalizeKeysInput,
  prepareComputerUseArguments,
} from './runtime.js';

describe('computer-use runtime helpers', () => {
  it('normalizes action aliases', () => {
    expect(normalizeComputerUseAction('observe')).toBe('observe');
    expect(normalizeComputerUseAction('screenshot')).toBe('observe');
    expect(normalizeComputerUseAction('move_mouse')).toBe('move');
    expect(normalizeComputerUseAction('type_text')).toBe('type');
    expect(normalizeComputerUseAction('set-value')).toBe('set_value');
    expect(normalizeComputerUseAction('perform_accessibility_action')).toBe('secondary_action');
  });

  it('normalizes key shortcuts from arrays and strings', () => {
    expect(normalizeKeysInput(['cmd+l'])).toEqual(['CMD', 'L']);
    expect(normalizeKeysInput('shift, tab')).toEqual(['SHIFT', 'TAB']);
    expect(normalizeKeysInput(['control', 'return'])).toEqual(['CTRL', 'ENTER']);
  });

  it('prepares arguments with normalized keys and aliases', () => {
    expect(prepareComputerUseArguments({
      action: 'screenshot',
      app: 'Safari',
      keys: 'cmd+l',
    })).toEqual({
      action: 'observe',
      app: 'Safari',
      keys: ['CMD', 'L'],
    });
  });

  it('preserves element-targeted arguments for accessibility actions', () => {
    expect(prepareComputerUseArguments({
      action: 'set-value',
      elementId: 'e12',
      text: 'hello',
      accessibilityAction: 'AXShowMenu',
    })).toEqual({
      action: 'set_value',
      elementId: 'e12',
      text: 'hello',
      accessibilityAction: 'AXShowMenu',
    });
  });

  it('chooses the frontmost exact app match first', () => {
    expect(chooseAppByQuery([
      { appName: 'Safari', pid: 11, isFrontmost: false },
      { appName: 'Safari', pid: 12, isFrontmost: true },
      { appName: 'Spotify', pid: 13, isFrontmost: false },
    ], 'safari').pid).toBe(12);
  });

  it('throws for ambiguous partial app matches', () => {
    expect(() => chooseAppByQuery([
      { appName: 'Personal Agent', pid: 1, isFrontmost: false },
      { appName: 'Personal Agent Dev', pid: 2, isFrontmost: true },
    ], 'personal')).toThrow("App 'personal' is ambiguous");
  });

  it('resolves exact and partial window title matches', () => {
    const windows = [
      { windowId: 1, title: 'Inbox', x: 0, y: 0, width: 100, height: 100, isOnscreen: true },
      { windowId: 2, title: 'Inbox — Draft', x: 0, y: 0, width: 100, height: 100, isOnscreen: true },
    ];

    expect(chooseWindowByTitle(windows, 'Inbox', 'Mail').windowId).toBe(1);
    expect(chooseWindowByTitle(windows, 'Draft', 'Mail').windowId).toBe(2);
  });

  it('throws when window title matches multiple windows', () => {
    const windows = [
      { windowId: 1, title: 'project.md', x: 0, y: 0, width: 100, height: 100, isOnscreen: true },
      { windowId: 2, title: 'project.md', x: 0, y: 0, width: 120, height: 100, isOnscreen: true },
    ];

    expect(() => chooseWindowByTitle(windows, 'project.md', 'Editor')).toThrow("Window title 'project.md' is ambiguous");
  });
});
