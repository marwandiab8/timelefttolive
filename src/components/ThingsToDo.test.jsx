import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import ThingsToDo, { describePlan } from './ThingsToDo.jsx';

const today = '2026-11-26';
const calendar = {
  id: 'c1',
  birthDate: '1975-02-24',
  children: [{ id: 'j', name: 'Joseph', birthDate: '2013-04-15' }],
  custodySchedule: { enabled: true, nextStartDate: '2026-11-22', cycleWeeks: 2, withParentWeeks: 1, childIds: ['j'] }
};
const plans = [
  { id: 'a', title: 'Leafs game', who: ['j'], deadline: { kind: 'age', personId: 'j', age: 18 }, plannedWeekStart: '2026-11-22', visibility: 'ownerOnly' },
  { id: 'b', title: 'Iceland', who: ['me'], deadline: null, visibility: 'viewers' },
  { id: 'c', title: 'Bruce Trail', who: ['me', 'j'], deadline: null, doneOn: '2026-11-20' }
];

describe('describePlan', () => {
  it('says who, by when, the chances left and the week it is planned for', () => {
    const item = describePlan(plans[0], calendar, today);
    expect(item.meta).toBe('Joseph · Before Joseph turns 18');
    expect(item.chances).toBe('115 of your weeks with them · 4 summers left');
    expect(item.planned).toMatch(/^Planned for your week from /);
    expect(describePlan(plans[1], calendar, today)).toMatchObject({ meta: 'You', chances: '', shared: true });
  });
});

describe('ThingsToDo', () => {
  it('names what is planned for your next week with the boys when this one has nothing', () => {
    const later = [{ ...plans[0], plannedWeekStart: '2026-12-06' }, plans[1]];
    const html = renderToStaticMarkup(<ThingsToDo calendar={calendar} plans={later} today={today} canEdit onAdd={() => {}} onEdit={() => {}} />);
    expect(html).toMatch(/Your next week with the boys, from [^:]+: Leafs game/);
  });

  it('lists the open plans, what is planned for this week with the boys and the done ones, with actions for the owner', () => {
    const html = renderToStaticMarkup(<ThingsToDo calendar={calendar} plans={plans} today={today} canEdit onAdd={() => {}} onEdit={() => {}} />);
    expect(html).toContain('Things to do');
    expect(html).toContain('This week with the boys: Leafs game');
    expect(html.indexOf('Leafs game')).toBeLessThan(html.indexOf('Iceland'));
    expect(html).toContain('Done (1)');
    expect(html).toContain('Add something');
    expect(html).toContain('>Done<');
  });

  it('is read-only for a viewer, and hidden when a viewer has nothing shared', () => {
    const html = renderToStaticMarkup(<ThingsToDo calendar={calendar} plans={[plans[1]]} today={today} canEdit={false} />);
    expect(html).toContain('Iceland');
    expect(html).not.toContain('<button');
    expect(renderToStaticMarkup(<ThingsToDo calendar={calendar} plans={[]} today={today} canEdit={false} />)).toBe('');
  });
});
