import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_ICON_LABELS,
  ActivityIcon,
  getActivityIconKey,
  renderActivityIconPaths,
} from './activityIcons.jsx';

const render = (props) => renderToStaticMarkup(<ActivityIcon {...props} />);

function numbersIn(markup) {
  const values = [];
  for (const [, name, value] of markup.matchAll(/\s(d|cx|cy|x|y|x1|y1|x2|y2|points)="([^"]*)"/g)) {
    for (const n of value.match(/-?\d*\.?\d+/g) || []) values.push({ name, n: Number(n) });
  }
  return values;
}

describe('ActivityIcon', () => {
  it('supports 26 distinct labels', () => {
    expect(ACTIVITY_ICON_LABELS).toHaveLength(26);
    const markups = new Set(ACTIVITY_ICON_LABELS.map((label) => render({ label })));
    expect(markups.size).toBe(26);
  });

  it.each(ACTIVITY_ICON_LABELS)('%s renders a stroke svg on the 24 grid', (label) => {
    const html = render({ label });
    expect(html).toContain('<svg');
    expect(html).toContain('viewBox="0 0 24 24"');
    expect(html).toContain('stroke="currentColor"');
    expect(html).toContain('fill="none"');
    expect(html).toContain('stroke-width="1.9"');
    expect(html).toContain('stroke-linecap="round"');
    expect(html).toContain('stroke-linejoin="round"');
    expect(html).toContain('class="activity-icon"');
  });

  it.each(ACTIVITY_ICON_LABELS)('%s keeps every coordinate inside 0..24', (label) => {
    const values = numbersIn(render({ label }));
    expect(values.length).toBeGreaterThan(0);
    for (const { name, n } of values) {
      expect(n, `${label} ${name}`).toBeGreaterThanOrEqual(0);
      expect(n, `${label} ${name}`).toBeLessThanOrEqual(24);
    }
  });

  it('renders the Other dot for an unknown label', () => {
    const html = render({ label: 'Totally unknown' });
    expect(html).toContain('<circle');
    expect(html).toContain('fill="currentColor"');
    expect(html).toBe(render({ label: 'Other' }));
  });

  it('matches labels case-insensitively', () => {
    expect(render({ label: 'GYM/FITNESS' })).toBe(render({ label: 'Gym/Fitness' }));
  });

  it('builds kebab keys and falls back to other', () => {
    expect(getActivityIconKey('Gym/Fitness')).toBe('gym-fitness');
    expect(getActivityIconKey('gym/fitness')).toBe('gym-fitness');
    expect(getActivityIconKey('Grocery shopping')).toBe('grocery-shopping');
    expect(getActivityIconKey('nope')).toBe('other');
    expect(getActivityIconKey(undefined)).toBe('other');
  });

  it('returns React elements for a key', () => {
    const el = renderActivityIconPaths('work');
    expect(typeof el).toBe('object');
    expect(renderToStaticMarkup(<svg>{el}</svg>)).toContain('<rect');
  });

  it('adds a title and role only when a title is given', () => {
    const titled = render({ label: 'Work', title: 'Work' });
    expect(titled).toContain('<title>Work</title>');
    expect(titled).toContain('role="img"');
    expect(titled).not.toContain('aria-hidden');
    const plain = render({ label: 'Work', size: 40, className: 'big' });
    expect(plain).toContain('aria-hidden="true"');
    expect(plain).not.toContain('<title>');
    expect(plain).toContain('width="40"');
    expect(plain).toContain('class="activity-icon big"');
  });
});
