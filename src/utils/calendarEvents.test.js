import { describe, expect, it } from 'vitest';
import { eventDocument } from './calendarEvents.js';
import { withOngoingEvents } from './dateUtils.js';

const base = { title: ' With Ashley ', description: '', startDate: '2021-04-17', endDate: '2026-08-31', color: '#ff6699', visibility: 'ownerOnly' };

describe('ongoing main-calendar events', () => {
  it('are saved with no end, to be carried every day', () => {
    expect(eventDocument({ ...base, ongoing: true })).toEqual({
      title: 'With Ashley', description: '', startDate: '2021-04-17', endDate: '', ongoing: true, everyDay: true,
      color: '#ff6699', relatedPeopleIds: [], visibility: 'ownerOnly'
    });
  });

  it('keep every day once stopped, and other events save as before', () => {
    expect(eventDocument({ ...base, ongoing: false, everyDay: true, endDate: '2026-10-24' })).toMatchObject({ endDate: '2026-10-24', ongoing: false, everyDay: true });
    expect(eventDocument({ title: 'Dentist', startDate: '2026-10-24', endDate: '2026-10-24', color: '#000000' })).toMatchObject({ endDate: '2026-10-24', ongoing: false, everyDay: false, visibility: 'viewers' });
  });

  it('run through today wherever events are shown', () => {
    const shown = withOngoingEvents([
      { id: 'ash', ...base, endDate: '', ongoing: true },
      { id: 'later', ...base, startDate: '2026-11-01', endDate: '', ongoing: true },
      { id: 'trip', ...base, endDate: '2026-08-31' }
    ], '2026-10-24');
    expect(shown.map((event) => [event.id, event.endDate])).toEqual([['ash', '2026-10-24'], ['later', '2026-11-01'], ['trip', '2026-08-31']]);
    expect(withOngoingEvents(undefined, '2026-10-24')).toEqual([]);
  });
});
