import { useEffect, useState } from 'react';
import { formatDateId } from '../utils/dateUtils.js';

/** Milliseconds from `now` to the next midnight in the local time zone. */
export function msUntilNextLocalMidnight(now = new Date()) {
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return midnight.getTime() - now.getTime();
}

/**
 * Today's date ID (YYYY-MM-DD), kept current. A tab left open overnight would
 * otherwise keep showing yesterday's week as the current one. It updates at
 * local midnight, and again when the tab is shown or focused, since browsers
 * slow timers in background tabs.
 */
export function useCurrentDay() {
  const [day, setDay] = useState(() => formatDateId(new Date()));

  useEffect(() => {
    let timer;
    const refresh = () => setDay(formatDateId(new Date()));
    const schedule = () => {
      timer = window.setTimeout(() => {
        refresh();
        schedule();
      }, msUntilNextLocalMidnight() + 1000);
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    schedule();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', refresh);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', refresh);
    };
  }, []);

  return day;
}
