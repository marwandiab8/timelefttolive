import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import FamilyTimePanel, { describeChild, describeCustodyStatus } from './FamilyTimePanel.jsx';
import { parseDateId } from '../utils/dateUtils.js';

const same = (dateId) => dateId;

const calendar = {
  birthDate: '1975-02-24',
  targetAge: 90,
  children: [
    {
      id: 'a',
      name: 'David',
      birthDate: '2010-06-28',
      grade: '11',
      gradeSchoolYear: 2026,
      school: 'Central',
      details: [{ id: 'x', label: 'Teacher', value: 'Ms. Lee' }]
    },
    { id: 'b', name: 'Sam', birthDate: '2015-01-10' }
  ],
  custodySchedule: { enabled: true, nextStartDate: '2026-06-01', cycleWeeks: 2, withParentWeeks: 1, childIds: ['a'], countUntilChildAge: 18 }
};

describe('describeCustodyStatus', () => {
  it('says who has them this week and when that changes', () => {
    expect(describeCustodyStatus({ withYou: true, start: '2026-11-02', end: '2026-11-08', changeDate: '2026-11-09', nextStart: '2026-11-16' }, same)).toEqual({
      headline: 'With you this week',
      sentence: '2026-11-02 to 2026-11-08. They go to their other parent 2026-11-09 and are back with you 2026-11-16.'
    });
    expect(describeCustodyStatus({ withYou: false, end: '2026-11-15', changeDate: '2026-11-16' }, same)).toEqual({
      headline: 'With their other parent this week',
      sentence: 'Until 2026-11-15. Back with you 2026-11-16.'
    });
    expect(describeCustodyStatus(null)).toBeNull();
  });
});

describe('describeChild', () => {
  const now = parseDateId('2026-11-02');
  const custody = calendar.custodySchedule;

  it('gives age, grade, school, what is ahead before 18, the next birthday and the time left', () => {
    const time = { untilDate: '2028-06-28', weeksRemaining: 44, daysRemaining: 303 };
    const card = describeChild(calendar.children[0], { time, untilAge: 18, custody }, now, same);
    expect(card.meta).toEqual(['Age 16', 'Grade 11', 'Central']);
    expect(card.weeks).toEqual({ number: '44', unit: 'weeks left with you', note: '303 days, until 18 on 2028-06-28.' });
    expect(card.ahead).toBe('Before 18: 1\u00a0summer · 2\u00a0Christmases · 1\u00a0birthday');
    expect(card.nextBirthday).toBe('Turns 17 on 2027-06-28, in your week.');
    expect(card.details).toEqual([{ id: 'x', label: 'Teacher', value: 'Ms. Lee' }]);
  });

  it("says when a birthday falls in the other parent's week, or is today", () => {
    const myles = { id: 'm', name: 'Myles', birthDate: '2011-04-27' };
    expect(describeChild(myles, { untilAge: 18, custody }, now, same).nextBirthday).toBe("Turns 16 on 2027-04-27, in their other parent's week.");
    expect(describeChild({ ...myles, birthDate: '2011-11-02' }, { untilAge: 18, custody }, now, same).nextBirthday).toBe('Turns 15 today, in your week.');
  });

  it('has no time line or week for a child not on the schedule, and says when one has turned 18', () => {
    const sam = describeChild(calendar.children[1], { untilAge: 18, custody: null }, now, same);
    expect(sam.weeks).toBeNull();
    expect(sam.nextBirthday).toBe('Turns 12 on 2027-01-10.');
    const later = parseDateId('2028-07-01');
    const grown = describeChild(calendar.children[0], { time: { untilDate: '2028-06-28', weeksRemaining: 0, daysRemaining: 0 }, untilAge: 18, custody }, later, same);
    expect(grown.weeks.note).toBe('Turned 18 on 2028-06-28.');
    expect(grown.ahead).toBe('');
  });
});

describe('FamilyTimePanel', () => {
  it('shows every child, the schedule only for those on it, and editing only to the owner', () => {
    const owner = renderToStaticMarkup(<FamilyTimePanel calendar={calendar} today="2026-11-02" canEdit onEdit={() => {}} />);
    expect(owner).toContain('With you this week');
    expect(owner).toContain('David');
    expect(owner).toContain('Sam');
    expect(owner.match(/weeks? left with you/g)).toHaveLength(1);
    expect(owner).toContain('Ms. Lee');
    expect(owner).toContain('Before 18: 1\u00a0summer');
    expect(owner).toContain('Edit kids and schedule');
    expect(renderToStaticMarkup(<FamilyTimePanel calendar={calendar} today="2026-11-02" canEdit={false} />)).not.toContain('<button');
  });
});

describe('FamilyTimePanel milestones and heights', () => {
  const kid = {
    id: 'a',
    name: 'David',
    birthDate: '2010-06-28',
    grade: '11',
    gradeSchoolYear: 2026,
    details: [
      { id: 'h1', label: 'Height, Nov 23, 2026', value: `5' 11"` },
      { id: 'h2', label: 'Height, Feb 10, 2025', value: `5' 8 1/2"` },
      { id: 'h3', label: 'Height, Sep 27, 2026', value: `5' 10 9/8"` },
      { id: 'x', label: 'Teacher', value: 'Ms. Lee' }
    ]
  };
  const heights = [
    { id: 'a-height-2026-11-23', childId: 'a', kind: 'height', measuredOn: '2026-11-23', valueMm: 1803, asWritten: `5' 11"` },
    { id: 'a-height-2025-02-10', childId: 'a', kind: 'height', measuredOn: '2025-02-10', valueMm: 1740, asWritten: `5' 8 1/2"` },
    { id: 'a-height-2026-09-27', childId: 'a', kind: 'height', measuredOn: '2026-09-27', valueMm: null, asWritten: `5' 10 9/8"`, needsCheck: true }
  ];
  const render = (props) => renderToStaticMarkup(<FamilyTimePanel calendar={{ ...calendar, children: [kid] }} today="2026-11-26" canEdit {...props} />);

  it('shows the next milestone on the card and the ones coming up for the family', () => {
    const html = render({});
    expect(html).toContain('Turns 18 in');
    expect(html).toContain('Coming up');
    expect(html).toContain('David graduates high school in');
  });

  it('draws the height history, flags the one to check and hides the detail rows it came from', () => {
    const html = render({ measurements: heights, onOpenMeasurements: () => {} });
    expect(html).toContain('<svg class="growth-chart"');
    expect(html).toContain('+2 1/2&quot; since');
    expect(html).toContain(`5&#x27; 10 9/8&quot; (`);
    expect(html).toContain('needs checking');
    expect(html).not.toContain('Height, Nov 23, 2026');
    expect(html).toContain('Ms. Lee');
    expect(html).toContain('>Heights<');
  });

  it('keeps the detail rows while they have no measurement, and offers to move them, to the owner only', () => {
    const html = render({ onOpenMeasurements: () => {} });
    expect(html).toContain('Height, Nov 23, 2026');
    expect(html).toContain('Move height notes');
    expect(render({ canEdit: false, onOpenMeasurements: () => {} })).not.toContain('Move height notes');
    const plain = renderToStaticMarkup(<FamilyTimePanel calendar={{ ...calendar, children: [{ ...kid, details: [] }] }} today="2026-11-26" canEdit onOpenMeasurements={() => {}} />);
    expect(plain).toContain('Add a height');
  });
});
