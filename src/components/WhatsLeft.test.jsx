import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import WhatsLeft, { describeWhatsLeft } from './WhatsLeft.jsx';

describe('describeWhatsLeft', () => {
  it('names the target age and each count, in the singular when there is one', () => {
    expect(describeWhatsLeft({ targetAge: 90, weekends: 1999, summers: 1, christmases: 39, birthdays: 1 })).toEqual({
      label: 'Still ahead, before 90',
      facts: [
        { value: '1,999', label: 'weekends' },
        { value: '1', label: 'summer' },
        { value: '39', label: 'Christmases' },
        { value: '1', label: 'birthday' }
      ]
    });
  });
});

describe('WhatsLeft', () => {
  it('shows the counts for the calendar', () => {
    const html = renderToStaticMarkup(<WhatsLeft calendar={{ birthDate: '1975-02-24', targetAge: 90, targetEndDate: '2065-02-24' }} today="2026-11-02" />);
    expect(html).toContain('Still ahead, before 90');
    expect(html).toContain('<strong>38</strong><span>summers</span>');
  });
});
