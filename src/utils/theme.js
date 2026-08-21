export const CALENDAR_THEME_STORAGE_KEY = 'lifeCalendarTheme';

export function normalizeCalendarTheme(value) {
  return value === 'light' ? 'light' : 'dark';
}

export function readCalendarTheme(storage = typeof window === 'undefined' ? null : window.localStorage) {
  try {
    return normalizeCalendarTheme(storage?.getItem(CALENDAR_THEME_STORAGE_KEY));
  } catch (_error) {
    return 'dark';
  }
}

export function writeCalendarTheme(theme, storage = typeof window === 'undefined' ? null : window.localStorage) {
  const normalized = normalizeCalendarTheme(theme);
  try {
    storage?.setItem(CALENDAR_THEME_STORAGE_KEY, normalized);
  } catch (_error) {
    // Private browsing or a restricted storage context should not block the calendar.
  }
  return normalized;
}

export function toggleCalendarTheme(theme) {
  return normalizeCalendarTheme(theme) === 'light' ? 'dark' : 'light';
}
