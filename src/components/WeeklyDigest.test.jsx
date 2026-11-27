import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../hooks/useCalendar.js', () => ({
  useDigestSettings: () => ({ settings: { enabled: true, push: true, email: false, lastSentWeekEnd: '2026-11-29', lastResult: { push: { sent: 1, failed: 0 } } }, error: '' }),
  usePushDevices: () => ({ devices: [{ id: 'd1', platform: 'iPhone' }], error: '' })
}));
vi.mock('../services/weeklyDigest.js', () => ({
  enablePushOnThisDevice: vi.fn(),
  previewWeeklyDigest: () => new Promise(() => {}),
  pushAvailability: () => ({ ok: false, reason: 'On the iPhone, open Time Left from the home screen to turn notifications on.' }),
  removePushDevice: vi.fn(),
  saveDigestSettings: vi.fn(),
  sendTestDigest: vi.fn(),
  thisDeviceTokenId: () => ''
}));

const { default: WeeklyDigestPage, DigestPreview, describeSendResults } = await import('./WeeklyDigest.jsx');
const { buildWeeklyDigest } = await import('../utils/weeklyDigest.js');

describe('the digest page', () => {
  it('shows the switches, the devices and the last send, and why this browser cannot turn notifications on', () => {
    const html = renderToStaticMarkup(<WeeklyDigestPage calendar={{ id: 'c1' }} uid="u1" email="owner@example.test" onDone={() => {}} />);
    expect(html).toContain('Sunday digest');
    expect(html).toContain('Putting the week together');
    expect(html).toMatch(/<input type="checkbox" checked=""\/>Every Sunday at 7 pm/);
    expect(html).toMatch(/<input type="checkbox"\/>As an email to owner@example.test/);
    expect(html).toContain('<span>iPhone</span>');
    expect(html).toContain('open Time Left from the home screen');
    expect(html).toContain('Notification sent to 1 device.');
    expect(html).toContain('Send me a test now');
  });

  it('describes what a send did', () => {
    expect(describeSendResults({ push: { sent: 2, failed: 1 }, email: { sent: true } })).toBe('Notification sent to 2 devices (1 failed). Email sent.');
    expect(describeSendResults({ push: { sent: 0, error: 'No device has notifications turned on.' }, email: { sent: false, error: 'Nope.' } }))
      .toBe('Notification not sent: No device has notifications turned on. Email not sent: Nope.');
  });

  it('previews the digest as it goes out', () => {
    const digest = buildWeeklyDigest({
      calendar: { birthDate: '1975-02-24', custodySchedule: { enabled: true, nextStartDate: '2026-11-22', cycleWeeks: 2, withParentWeeks: 1, childIds: [] } },
      entries: [{ dateId: '2026-11-28', notes: 'Pancakes' }],
      todayId: '2026-11-29',
      now: new Date('2026-11-30T00:00:00Z')
    });
    const html = renderToStaticMarkup(<DigestPreview digest={digest} />);
    expect(html).toContain('<h2>Your week, Nov 23 to Nov 29</h2>');
    expect(html).toContain('6 days with the boys');
    expect(html).toContain('Pancakes');
    expect(html).toContain('The boys are with you Sun next week.');
    expect(html).toContain('On the lock screen: “6 days with the boys. Next week: with you Sun.”');
  });
});

describe('the notification service worker', () => {
  const source = readFileSync(new URL('../../public/firebase-messaging-sw.js', import.meta.url), 'utf8');

  function loadWorker() {
    const listeners = {};
    const shown = [];
    const opened = [];
    const self = {
      location: { origin: 'https://app.example' },
      addEventListener: (type, listener) => { listeners[type] = listener; },
      skipWaiting: () => {},
      registration: { showNotification: async (title, options) => shown.push({ title, options }) },
      clients: { claim: async () => {}, matchAll: async () => [], openWindow: async (url) => opened.push(url) }
    };
    new Function('self', source)(self);
    const fire = async (type, event) => {
      let work = Promise.resolve();
      listeners[type]({ ...event, waitUntil: (promise) => { work = promise; } });
      await work;
    };
    return { fire, shown, opened };
  }

  it('shows the digest from a data message and opens the digest on a tap', async () => {
    const worker = loadWorker();
    await worker.fire('push', { data: { json: () => ({ data: { title: 'Your week', body: '6 days with the boys.', url: 'https://app.example/#digest', tag: 'digest-2026-11-29' } }) } });
    expect(worker.shown).toEqual([{ title: 'Your week', options: expect.objectContaining({ body: '6 days with the boys.', tag: 'digest-2026-11-29', data: { url: 'https://app.example/#digest' } }) }]);
    await worker.fire('notificationclick', { notification: { close: () => {}, data: { url: 'https://app.example/#digest' } } });
    expect(worker.opened).toEqual(['https://app.example/#digest']);
  });

  it('still shows something for an empty push, and never opens another site', async () => {
    const worker = loadWorker();
    await worker.fire('push', { data: null });
    expect(worker.shown[0].title).toBe('Your week');
    await worker.fire('notificationclick', { notification: { close: () => {}, data: { url: 'https://evil.example/' } } });
    expect(worker.opened).toEqual([]);
  });
});
