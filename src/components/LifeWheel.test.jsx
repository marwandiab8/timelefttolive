import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { getCategoryDefinition, getPeriodBounds } from '../utils/lifeEventUtils.js';
import { LifeWheel, MiniWheel, buildClockFragments } from './LifeWheel.jsx';

const H = 3600;
const categories = [['Work', 8 * H], ['Sleep', 7 * H], ['Transportation', 54 * 60], ['Places', 6 * 60]]
  .map(([label, seconds]) => ({ ...getCategoryDefinition(label), label, seconds, sessions: [], allSessions: [] }));
const analysis = {
  categories,
  sessionCategories: categories,
  pointCategories: [],
  momentGroups: [],
  allocatedSessions: [],
  timedSeconds: categories.reduce((total, category) => total + category.seconds, 0),
  activeCount: 0
};
const bounds = getPeriodBounds('day', '2026-11-03');
const render = (props = {}) => renderToStaticMarkup(
  <LifeWheel analysis={analysis} bounds={bounds} categoryAnalysis={null} now={new Date('2026-11-03T17:00:00Z')} onSelect={vi.fn()} period="day" pointAnalysis={null} selectedLabel={null} title="Today" {...props} />
);

describe('LifeWheel material', () => {
  it('falls back to flat fills on the server, so a page without scripts still shows the wheel', () => {
    const markup = render();
    expect(markup).toContain('data-material="plain"');
    expect(markup).not.toContain('<defs>');
    categories.forEach((category) => expect(markup).toContain(`fill="${category.color}"`));
  });

  it('builds the crystal material from the category colours: one body gradient per slice, a shared highlight, a seat and a lens', () => {
    const markup = render({ material: 'crystal' });
    expect(markup).toContain('data-material="crystal"');
    expect(markup.match(/<radialGradient id="lw[^"]*-body-\d+"/g)).toHaveLength(categories.length);
    expect(markup).toMatch(/<path class="life-wheel-segment[^"]*" d="[^"]+" fill="url\(#lw[^"]*-body-0\)"/);
    expect(markup).toContain('-spec"');
    expect(markup).toContain('feDropShadow');
    expect(markup).toContain('class="life-wheel-seat"');
    expect(markup).toContain('class="life-wheel-hub"');
    expect(markup).toContain('/brand/k2-logo-watermark.png');
    expect(markup).not.toMatch(/NaN|undefined/);
  });

  it('gives dark ink to the yellow slice and white to the blue one', () => {
    const markup = render({ material: 'crystal' });
    const labels = markup.match(/<g class="life-wheel-labels"[\s\S]*?<\/g><\/g>/)[0];
    expect(labels).toContain('color:#17252d');
    expect(labels).toContain('color:#ffffff');
  });

  it('marks a slice drawn at the minimum with a dashed edge, and only that one', () => {
    const markup = render({ material: 'crystal' });
    expect(markup.match(/stroke-dasharray="0.6 0.7"/g)).toHaveLength(1);
    expect(markup).toMatch(/aria-label="Places, 6m, 0\.6% of tracked time"/);
  });

  it('exposes every slice as a pressed or unpressed button with its share, and lets arrows move between them', () => {
    const markup = render({ selectedLabel: 'Sleep', categoryAnalysis: { ...categories[1], sessionCount: 1, totalSeconds: 7 * H, sessions: [], activeSession: null } });
    expect(markup).toMatch(/role="button" tabindex="0" aria-pressed="false" aria-label="Work, 8h, 50% of tracked time"/);
    expect(markup).toMatch(/aria-pressed="true" aria-label="Sleep, 7h/);
    // One slice carries the roving tabindex; the hub's own tabindex (it clears the selection) is separate.
    const ring = markup.match(/<g class="life-wheel-ring"[\s\S]*?<\/g><\/g>/)[0];
    expect(ring.match(/tabindex="0"/g)).toHaveLength(1);
  });
});

describe('LifeWheel hub', () => {
  it('becomes a button that shows every activity again while one is selected', () => {
    const selected = render({ selectedLabel: 'Work', categoryAnalysis: { ...categories[0], sessionCount: 1, totalSeconds: 8 * H, sessions: [], activeSession: null } });
    expect(selected).toMatch(/class="life-wheel-center clearable" aria-live="polite" role="button" tabindex="0" title="Show all activities"/);
    expect(render()).toMatch(/class="life-wheel-center " aria-live="polite">/);
  });
});

describe('LifeWheel instruments', () => {
  it('adds the frosted untracked remainder of a day when asked, and never makes it a button', () => {
    const markup = render({ showUntracked: true });
    expect(markup).toContain('aria-label="Untracked time, 8h"');
    expect(markup).toMatch(/<g class="life-wheel-slice untracked" data-label="Untracked" aria-label=/);
    expect(markup).not.toMatch(/role="button"[^>]*aria-label="Untracked/);
    expect(render()).not.toContain('Untracked time');
  });

  it('draws the comparison ring from the previous period, longer where you did more then', () => {
    const compareSeconds = new Map([['Work', 10 * H], ['Sleep', 5 * H]]);
    const markup = render({ compare: 'previous', compareSeconds });
    const compareGroup = markup.match(/<g class="life-wheel-compare"[\s\S]*?<\/g>/)[0];
    expect(compareGroup.match(/<path /g)).toHaveLength(2);
    expect(compareGroup).toContain(`stroke="${categories[0].color}"`);
    expect(render({ compare: 'none', compareSeconds })).not.toContain('life-wheel-compare');
  });

  it('places moments as beads with a count when they cluster', () => {
    const beads = [
      { id: 'a', label: 'Journal', color: '#9a88d4', at: new Date('2026-11-03T13:00:00Z'), title: 'Morning note', count: 1, segmentLabel: 'Notes' },
      { id: 'b', label: 'Spotify', color: '#db75a6', at: new Date('2026-11-03T14:00:00Z'), title: 'Song', count: 2, segmentLabel: 'Music' },
      { id: 'c', label: 'Spotify', color: '#db75a6', at: new Date('2026-11-03T14:10:00Z'), title: 'Song 2', count: 1, segmentLabel: 'Music' }
    ];
    // Share layout: moments with no slice of their own sit on the untracked segment, spread out.
    const shared = render({ beads, showUntracked: true }).match(/<g class="life-wheel-beads">[\s\S]*?<\/g><\/g>/)[0];
    expect(shared).toContain('aria-label="Journal"');
    expect(shared.match(/<g class="life-wheel-bead /g)).toHaveLength(3);
    // Clock layout: at their time of day, and the two plays ten minutes apart merge with a count.
    const clocked = render({ beads, layout: 'clock' }).match(/<g class="life-wheel-beads">[\s\S]*?<\/g><\/g>/)[0];
    expect(clocked).toContain('aria-label="Spotify, 3 moments"');
    expect(clocked).toContain('>3</text>');
  });

  it('draws a target mark on the slice, white when met and amber when missed', () => {
    const targets = new Map([['Sleep', { ringSeconds: 7.5 * H, met: false, text: '30m under your 7h 30m goal' }], ['Work', { ringSeconds: 9 * H, met: true }]]);
    const markup = render({ targets });
    const marks = markup.match(/<g class="life-wheel-targets"[\s\S]*?<\/g>/)[0];
    expect(marks.match(/<line /g)).toHaveLength(2);
    expect(marks).toContain('stroke="#f2b84b"');
    expect(marks).toContain('stroke="#ffffff"');
    expect(render({ targets, selectedLabel: 'Sleep', categoryAnalysis: { ...categories[1], sessionCount: 1, totalSeconds: 7 * H, sessions: [], activeSession: null }, targetText: '30m under your 7h 30m goal' })).toContain('30m under your 7h 30m goal');
  });

  it('lays a day out as a clock: fragments at their real hours, the night from bedtime, hour ticks and labels', () => {
    const dayStart = bounds.start.getTime();
    const hour = (h) => dayStart + h * H * 1000;
    const clockAnalysis = {
      ...analysis,
      allocatedSessions: [
        { id: 's1', category: 'Sleep', startAt: new Date(hour(0)), nightStartAt: new Date(hour(-1.15)), endAt: new Date(hour(3.6)), attributedSeconds: 4.75 * H, fragments: [{ start: hour(0), end: hour(3.6) }], title: 'Sleep' },
        { id: 'w1', category: 'Work', startAt: new Date(hour(9)), endAt: new Date(hour(17)), fragments: [{ start: hour(9), end: hour(17) }], title: 'Work', location: 'Site' },
        { id: 'm1', category: 'Music', startAt: new Date(hour(10)), endAt: new Date(hour(11)), fragments: [{ start: hour(10), end: hour(11) }], title: 'Spotify' }
      ]
    };
    const { fragments, overlays } = buildClockFragments(clockAnalysis, bounds);
    expect(fragments.map((fragment) => fragment.label)).toEqual(['Sleep', 'Work']);
    expect(fragments[0].start).toBe(hour(-1.15));
    expect(overlays).toHaveLength(1);

    const markup = render({ analysis: clockAnalysis, layout: 'clock', material: 'crystal' });
    expect(markup).toContain('layout-clock');
    expect(markup).toContain('>Noon</text>');
    expect(markup.match(/<line /g).length).toBeGreaterThanOrEqual(24);
    expect(markup).toContain('class="life-wheel-overlay"');
    expect(markup).toMatch(/aria-label="Sleep, 4h 45m/);
    expect(markup).not.toMatch(/NaN/);
    // The share layout ignores the clock request on anything but a day.
    expect(render({ analysis: clockAnalysis, layout: 'clock', period: 'week', bounds: getPeriodBounds('week', '2026-11-03') })).toContain('layout-share');
  });

  it('shows the live pulse and counts sessions in progress in the hub', () => {
    const live = { ...analysis, activeCount: 1, sessionCategories: [{ ...categories[0], allSessions: [{ active: true }] }] };
    const markup = render({ analysis: live, material: 'crystal' });
    expect(markup).toContain('class="life-wheel-live"');
    expect(markup).toContain('1 in progress');
    expect(markup).toContain('life-wheel-pulse');
  });
});

describe('MiniWheel', () => {
  it('renders a small plain wheel with its total in the accessible name', () => {
    const markup = renderToStaticMarkup(<MiniWheel categories={categories} label="Mon" onClick={vi.fn()} />);
    expect(markup).toContain('aria-label="Mon: 16h"');
    expect(markup.match(/<path /g)).toHaveLength(categories.length);
    expect(renderToStaticMarkup(<MiniWheel categories={[]} label="Tue" onClick={vi.fn()} />)).toContain('Tue: Nothing tracked');
  });
});
