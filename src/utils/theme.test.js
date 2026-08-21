import { describe, expect, it } from 'vitest';
import {
  CALENDAR_THEME_STORAGE_KEY,
  normalizeCalendarTheme,
  readCalendarTheme,
  toggleCalendarTheme,
  writeCalendarTheme
} from './theme.js';

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    value(key) { return values.get(key); }
  };
}

describe('calendar theme preference', () => {
  it('defaults safely to dark and normalizes unknown values', () => {
    expect(normalizeCalendarTheme('unknown')).toBe('dark');
    expect(readCalendarTheme(memoryStorage())).toBe('dark');
    expect(readCalendarTheme(memoryStorage({ [CALENDAR_THEME_STORAGE_KEY]: 'light' }))).toBe('light');
  });

  it('persists only the supported light/dark values', () => {
    const storage = memoryStorage();
    expect(writeCalendarTheme('light', storage)).toBe('light');
    expect(storage.value(CALENDAR_THEME_STORAGE_KEY)).toBe('light');
    expect(writeCalendarTheme('invalid', storage)).toBe('dark');
    expect(storage.value(CALENDAR_THEME_STORAGE_KEY)).toBe('dark');
  });

  it('toggles deterministically', () => {
    expect(toggleCalendarTheme('dark')).toBe('light');
    expect(toggleCalendarTheme('light')).toBe('dark');
    expect(toggleCalendarTheme('unknown')).toBe('light');
  });
});
