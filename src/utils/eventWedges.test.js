import { describe, expect, it } from 'vitest';
import { MAX_EVENT_WEDGES, buildWedgeGradient, isSafeColor, pickWeekWedges } from './eventWedges.js';

const event = (id, startDate, color, title = id) => ({ id, startDate, color, title });

describe('isSafeColor', () => {
  it('accepts hex colours only', () => {
    ['#fff', '#FFFFFF', '#7c9cff', '#7c9cff80'].forEach((value) => expect(isSafeColor(value)).toBe(true));
  });

  it('rejects anything else, so odd stored values never reach an inline style', () => {
    ['', 'red', 'rgb(1,2,3)', '#12', '#12345', 'url(https://example.com/x)', '#fff, url(x)', null, undefined, 42].forEach((value) => {
      expect(isSafeColor(value), String(value)).toBe(false);
    });
  });
});

describe('pickWeekWedges', () => {
  it('returns nothing for a week with no events', () => {
    expect(pickWeekWedges([], '#7c9cff')).toEqual({ wedges: [], overflow: 0 });
    expect(pickWeekWedges(undefined, '#7c9cff')).toEqual({ wedges: [], overflow: 0 });
  });

  it('gives each event one wedge, in the order the events began, so a slice keeps its place', () => {
    const { wedges } = pickWeekWedges([
      event('late', '2024-05-01', '#111111'),
      event('early', '2020-01-01', '#222222'),
      event('middle', '2022-03-01', '#333333')
    ], '#7c9cff');
    expect(wedges.map((wedge) => wedge.id)).toEqual(['early', 'middle', 'late']);
    expect(wedges.map((wedge) => wedge.color)).toEqual(['#222222', '#333333', '#111111']);
  });

  it('breaks ties on the same start date by id, so the order never changes between renders', () => {
    const { wedges } = pickWeekWedges([event('b', '2024-01-01', '#bbbbbb'), event('a', '2024-01-01', '#aaaaaa')], '#7c9cff');
    expect(wedges.map((wedge) => wedge.id)).toEqual(['a', 'b']);
  });

  it('falls back to the default colour when an event has none, or an unusable one', () => {
    const { wedges } = pickWeekWedges([event('a', '2024-01-01', undefined), event('b', '2024-01-02', 'url(x)')], '#7c9cff');
    expect(wedges.map((wedge) => wedge.color)).toEqual(['#7c9cff', '#7c9cff']);
  });

  it('keeps the event title for the tooltip', () => {
    expect(pickWeekWedges([event('a', '2024-01-01', '#111111', 'Marathon')], '#7c9cff').wedges[0].title).toBe('Marathon');
  });

  it('caps the wedges and says how many events were left out', () => {
    const many = Array.from({ length: MAX_EVENT_WEDGES + 3 }, (_, index) => event(`e${index}`, `2024-01-${String(index + 1).padStart(2, '0')}`, '#111111'));
    const { wedges, overflow } = pickWeekWedges(many, '#7c9cff');
    expect(wedges).toHaveLength(MAX_EVENT_WEDGES);
    expect(overflow).toBe(3);
  });

  it('does not change the events it was given', () => {
    const input = [event('b', '2024-02-01', '#bbbbbb'), event('a', '2024-01-01', '#aaaaaa')];
    pickWeekWedges(input, '#7c9cff');
    expect(input.map((item) => item.id)).toEqual(['b', 'a']);
  });
});

describe('buildWedgeGradient', () => {
  it('is empty when there is nothing to draw', () => {
    expect(buildWedgeGradient([])).toBe('');
  });

  it('fills the square with a single colour for one event', () => {
    expect(buildWedgeGradient(['#ef7a85'])).toBe('linear-gradient(#ef7a85, #ef7a85)');
  });

  it('splits the square in two halves for two events', () => {
    expect(buildWedgeGradient(['#111111', '#222222'])).toBe('conic-gradient(from 0deg, #111111 0% 50%, #222222 50% 100%)');
  });

  it('gives every wedge an equal share that adds up to the whole square', () => {
    const gradient = buildWedgeGradient(['#111111', '#222222', '#333333']);
    expect(gradient).toBe('conic-gradient(from 0deg, #111111 0% 33.333%, #222222 33.333% 66.667%, #333333 66.667% 100%)');
  });

  it('ends exactly at 100% however many wedges there are', () => {
    for (let count = 2; count <= MAX_EVENT_WEDGES; count += 1) {
      const gradient = buildWedgeGradient(Array.from({ length: count }, (_, index) => `#00000${index}`));
      expect(gradient.endsWith('100%)'), `${count} wedges`).toBe(true);
      expect(gradient.match(/#/g)).toHaveLength(count);
    }
  });
});
