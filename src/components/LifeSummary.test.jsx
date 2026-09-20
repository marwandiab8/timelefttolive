import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import LifeSummary, { describeLifeSummary } from './LifeSummary.jsx';

const stats = {
  currentAge: 38,
  targetAge: 80,
  weeksLived: 1996,
  weeksRemaining: 2178,
  daysRemaining: 15244,
  percentageUsed: 47.8,
  percentageRemaining: 52.2
};

describe('describeLifeSummary', () => {
  it('leads with the weeks left and keeps every figure the old cards showed', () => {
    const summary = describeLifeSummary(stats);
    expect(summary.headline).toEqual({ number: '2,178', unit: 'weeks left' });
    expect(summary.sentence).toBe('You are 38, aiming for 80.');
    expect(summary.facts).toEqual([
      { label: 'Weeks lived', value: '1,996' },
      { label: 'Days remaining', value: '15,244' },
      { label: 'Life remaining', value: '52.2%' }
    ]);
    expect(summary.lived).toBe(47.8);
  });

  it('says "1 week left" in the singular', () => {
    expect(describeLifeSummary({ ...stats, weeksRemaining: 1 }).headline).toEqual({ number: '1', unit: 'week left' });
  });

  it('says so plainly when the target age has been reached', () => {
    const summary = describeLifeSummary({ ...stats, weeksRemaining: 0, daysRemaining: 0, percentageUsed: 100, percentageRemaining: 0 });
    expect(summary.headline).toEqual({ number: '0', unit: 'weeks left' });
    expect(summary.sentence).toBe('You have reached 80.');
    expect(summary.lived).toBe(100);
  });

  it('keeps the progress figure inside 0 to 100', () => {
    expect(describeLifeSummary({ ...stats, percentageUsed: 140 }).lived).toBe(100);
    expect(describeLifeSummary({ ...stats, percentageUsed: -3 }).lived).toBe(0);
    expect(describeLifeSummary({ ...stats, percentageUsed: undefined }).lived).toBe(0);
  });
});

describe('LifeSummary', () => {
  it('renders the headline, the sentence and a described progress bar', () => {
    const markup = renderToStaticMarkup(<LifeSummary stats={stats} />);
    expect(markup).toContain('2,178 weeks left');
    expect(markup).toContain('You are 38, aiming for 80.');
    expect(markup).toContain('aria-label="47.8% of the way to 80"');
    expect(markup).toContain('width:47.8%');
    expect(markup).toContain('Weeks lived');
    expect(markup).toContain('15,244');
  });
});
