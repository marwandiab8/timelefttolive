import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { buildSearchRecords } from '../utils/search.js';

const hookCalls = [];
vi.mock('../hooks/useCalendar.js', () => ({
  useDailyEntries: (calendarId, role, enabled) => {
    hookCalls.push({ calendarId, role, enabled });
    return { entries: [], loading: false, error: '' };
  }
}));

const { default: SearchDialog, SearchResults } = await import('./Search.jsx');

const records = buildSearchRecords({
  entries: [{ dateId: '2025-11-27', notes: '7:24 PM: Pancakes with Ben' }],
  events: [{ id: 'e1', title: 'Pancake breakfast', startDate: '1970-01-01', endDate: '1970-01-01' }],
  plans: [{ id: 'p1', title: 'Make Ben pancakes on his birthday' }]
});

describe('search results', () => {
  it('says what it searches before anything is typed', () => {
    expect(renderToStaticMarkup(<SearchResults records={records} query="p" />)).toContain('Search your day notes, events, weekly reviews, things to do and heights.');
  });

  it('lists each match with what it is, when, and the words marked', () => {
    const html = renderToStaticMarkup(<SearchResults records={records} query="pancake" onOpen={() => {}} />);
    expect(html).toContain('3 results');
    expect(html).toContain('<li class="search-note"><button type="button" class="search-result"><span class="search-kind">Day note</span><strong>Thu, Nov 27, 2025</strong><span class="search-snippet"><mark>Pancake</mark>s with Ben</span></button></li>');
    expect(html).toContain('<span class="search-kind">To do · Not done yet</span><strong>Make Ben <mark>pancake</mark>s on his birthday</strong>');
  });

  it('shows a result it can’t open without a button, and says when nothing matched', () => {
    const html = renderToStaticMarkup(<SearchResults records={records} query="breakfast" canOpen={(result) => result.dateId > '2000-01-01'} onOpen={() => {}} />);
    expect(html).toContain('<div class="search-result"><span class="search-kind">Event · Jan 1, 1970</span>');
    expect(html).not.toContain('<button');
    expect(renderToStaticMarkup(<SearchResults records={records} query="waffles" />)).toContain('Nothing found for “waffles”.');
  });

  it('loads the day notes for whoever is reading, only while open', () => {
    hookCalls.length = 0;
    const html = renderToStaticMarkup(
      <SearchDialog calendar={{ id: 'c1', children: [] }} role="viewer" events={[]} reviews={{}} plans={[]} measurements={[]} onOpen={() => {}} onClose={() => {}} />
    );
    expect(html).toContain('role="dialog"');
    expect(html).toContain('type="search"');
    expect(hookCalls).toEqual([{ calendarId: 'c1', role: 'viewer', enabled: true }]);
  });
});
