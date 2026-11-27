/**
 * The Sunday digest (see docs/weekly-digest.md): the week in numbers, time with the boys, targets met and missed, one
 * moment, next week's custody, plans and milestones. Pure, so the same code builds the in-app preview, the iPhone
 * notification and the email. The Cloud Function copies this file and its imports into functions/shared.
 */
import { getCustodyWeekStatus } from './custodyUtils.js';
import { addDays, formatDateId, parseDateId } from './dateUtils.js';
import { buildJournalEntries, buildPeriodAnalysis, getDateIdInTimezone, getEventTime, getPeriodBounds } from './lifeEventUtils.js';
import { describeWeekNumbers, summarizeWeek, weekDayIds } from './weeklyReview.js';
import { deadlineDate, describeDeadline, plansForWeek, sortPlans, upcomingWeeksWithKids } from './thingsToDo.js';
import { describeMilestone, getFamilyMilestones } from './childMilestones.js';
import { isJournalOrMediaLifeEvent } from './journalLifeEvents.js';

export const DIGEST_APP_URL = 'https://timelefttolive.web.app';
/** Events are loaded this far either side of the week, so a night or a visit that crosses midnight Sunday counts. */
export const DIGEST_PADDING_MS = 36 * 3600 * 1000;
const PLAN_HORIZON_DAYS = 56;
const MILESTONE_HORIZON_DAYS = 28;
const MOMENT_MAX = 280;
const PUSH_MAX = 178;

const monthDay = (dateId) => parseDateId(dateId).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const weekdayDate = (dateId) => parseDateId(dateId).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
const longDate = (dateId) => parseDateId(dateId).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const weekdayName = (dateId) => parseDateId(dateId).toLocaleDateString('en-US', { weekday: 'short' });
const plusDays = (dateId, days) => formatDateId(addDays(parseDateId(dateId), days));

/** The Monday-to-Sunday week the digest is about: this week on a Sunday, otherwise the week that ended last Sunday. */
export function digestWeek(todayId) {
  const today = parseDateId(todayId);
  const end = formatDateId(addDays(today, -today.getDay()));
  return { start: plusDays(end, -6), end };
}

/** The week's Activity bounds (Toronto) and the wider window to load events for. */
export function digestEventWindow(week) {
  const bounds = getPeriodBounds('week', week.end);
  return { bounds, start: new Date(bounds.start.getTime() - DIGEST_PADDING_MS), end: new Date(bounds.end.getTime() + DIGEST_PADDING_MS) };
}

/** "Mon to Wed", "Sun", "Mon to Tue and Sat to Sun": runs of days in a list of date ids that are in order. */
function describeDayRuns(dateIds) {
  const runs = [];
  dateIds.forEach((dateId) => {
    const last = runs[runs.length - 1];
    if (last && plusDays(last[last.length - 1], 1) === dateId) last.push(dateId);
    else runs.push([dateId]);
  });
  return runs.map((run) => (run.length === 1 ? weekdayName(run[0]) : `${weekdayName(run[0])} to ${weekdayName(run[run.length - 1])}`)).join(' and ');
}

/** Which days of `week` the boys are with you, in words; '' with no custody schedule. */
export function describeWeekWithKids(custodySchedule, week) {
  if (!custodySchedule?.enabled || !custodySchedule?.nextStartDate) return '';
  const days = weekDayIds(week);
  const withYou = days.filter((dateId) => (
    (!custodySchedule.since || dateId >= custodySchedule.since)
    && getCustodyWeekStatus(custodySchedule, parseDateId(dateId))?.withYou
  ));
  if (!withYou.length) return 'The boys are with their other parent next week.';
  if (withYou.length === days.length) return 'The boys are with you all next week.';
  return `The boys are with you ${describeDayRuns(withYou)} next week.`;
}

/** Open plans placed in next week's time with the kids, then ones whose deadline is within eight weeks. At most five. */
export function digestPlans(plans = [], calendar = {}, nextWeek, todayId) {
  const { open } = sortPlans(plans, calendar);
  const stretches = upcomingWeeksWithKids(calendar.custodySchedule, nextWeek.start, 2).filter((start) => start <= nextWeek.end);
  const planned = stretches.flatMap((start) => plansForWeek(open, start));
  const horizon = plusDays(todayId, PLAN_HORIZON_DAYS);
  const dueSoon = open.filter((plan) => {
    if (planned.includes(plan)) return false;
    const due = deadlineDate(plan, calendar);
    return due && due >= todayId && due <= horizon;
  });
  return [
    ...planned.map((plan) => ({ id: plan.id || '', title: plan.title, when: 'Planned for your time with them next week' })),
    ...dueSoon.map((plan) => ({ id: plan.id || '', title: plan.title, when: describeDeadline(plan, calendar, todayId, longDate) }))
  ].slice(0, 5);
}

const clip = (text, max = MOMENT_MAX) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);
// Quick capture writes "7:24 PM: the line"; the time isn't part of the moment.
const withoutTime = (line) => line.replace(/^\d{1,2}:\d{2}\s?[AP]M:\s*/i, '').trim();

/**
 * One moment from the week: the weekly review's, else the latest thing written down (a note, a journal entry).
 * Only ever shown in the app and the email, never in the notification, which can show on a locked phone.
 */
export function pickMoment({ week, reviews = [], entries = [], events = [] }) {
  const review = reviews
    .filter((item) => String(item.moment || '').trim() && item.weekStart <= week.end && item.weekEnd >= week.start)
    .sort((left, right) => String(right.weekEnd).localeCompare(String(left.weekEnd)))[0];
  if (review) return { text: clip(String(review.moment).trim()), from: 'From your weekly review' };
  const inWeek = (dateId) => dateId >= week.start && dateId <= week.end;
  const written = [
    ...entries.filter((entry) => inWeek(entry.dateId)).map((entry) => ({
      dateId: entry.dateId,
      text: String(entry.journalText || '').trim() || String(entry.notes || '').trim().split('\n').map(withoutTime).filter(Boolean).pop() || ''
    })),
    ...buildJournalEntries(events).filter((entry) => inWeek(entry.dateId)).map((entry) => ({ dateId: entry.dateId, text: entry.note }))
  ].filter((item) => item.text).sort((left, right) => right.dateId.localeCompare(left.dateId));
  return written[0] ? { text: clip(written[0].text), from: weekdayDate(written[0].dateId) } : null;
}

/**
 * Everything in one digest. `events` are the week's life events (with padding), `entries` its daily entries,
 * `reviews` the weekly reviews that touch it, `plans` all plans. `now` is when it is built.
 */
export function buildWeeklyDigest({ calendar = {}, events = [], entries = [], reviews = [], plans = [], todayId, now = new Date() }) {
  const week = digestWeek(todayId);
  const nextWeek = { start: plusDays(week.end, 1), end: plusDays(week.end, 7) };
  const { bounds } = digestEventWindow(week);
  const analysis = buildPeriodAnalysis(events, bounds, { includeActive: false, now });
  const journalDateIds = [
    ...entries.filter((entry) => String(entry.notes || entry.journalText || '').trim()).map((entry) => entry.dateId),
    ...events.filter(isJournalOrMediaLifeEvent).map((event) => getDateIdInTimezone(getEventTime(event), bounds.timezone))
  ];
  const numbers = summarizeWeek({ analysis, bounds, targets: calendar.activityTargets, custodySchedule: calendar.custodySchedule, week, journalDateIds });
  const milestoneHorizon = plusDays(todayId, MILESTONE_HORIZON_DAYS);
  const milestones = getFamilyMilestones(calendar.children || [], { now: parseDateId(todayId), custodySchedule: calendar.custodySchedule }, 3)
    .filter((milestone) => milestone.dateId <= milestoneHorizon)
    .map((milestone) => describeMilestone(milestone, { day: longDate }));
  const digest = {
    week,
    nextWeek,
    title: `Your week, ${monthDay(week.start)} to ${monthDay(week.end)}`,
    numbers,
    numberLines: describeWeekNumbers(numbers),
    targetsMet: numbers.targets.filter((target) => target.met).map(targetLine),
    targetsMissed: numbers.targets.filter((target) => !target.met).map(targetLine),
    moment: pickMoment({ week, reviews, entries, events }),
    nextWeekWithKids: describeWeekWithKids(calendar.custodySchedule, nextWeek),
    plans: digestPlans(plans, calendar, nextWeek, todayId),
    milestones
  };
  return { ...digest, push: digestPush(digest) };
}

/** "Sleep: 2h 16m over your 7h goal on average"; "3 of 3 gym visits this week" already says what it is. */
export function targetLine(target) {
  const word = String(target.label || '').split('/')[0].toLowerCase();
  return word && !String(target.text).toLowerCase().includes(word) ? `${target.label}: ${target.text}` : target.text;
}

const hoursOnly = (seconds) => {
  const hours = Math.round((Number(seconds) || 0) / 3600);
  return `${hours}h`;
};

/** The notification: numbers only (no journal text, no names beyond "the boys"), short enough for a lock screen. */
export function digestPush(digest) {
  const { numbers } = digest;
  const parts = [];
  if (numbers.daysWithKids !== null && numbers.daysWithKids !== undefined) {
    parts.push(numbers.daysWithKids === 1 ? '1 day with the boys' : `${numbers.daysWithKids} days with the boys`);
  }
  if (numbers.trackedSeconds > 0) parts.push(`${hoursOnly(numbers.trackedSeconds)} tracked`);
  if (numbers.targets.length) parts.push(`${digest.targetsMet.length} of ${numbers.targets.length} targets met`);
  let body = parts.length ? `${parts.join(' · ')}.` : 'Your week is ready to look back on.';
  const next = digest.nextWeekWithKids.replace(/^The boys are /, 'Next week: ').replace(/ next week\.$/, '.');
  if (next && `${body} ${next}`.length <= PUSH_MAX) body = `${body} ${next}`;
  return { title: digest.title, body: clip(body, PUSH_MAX) };
}

/** The digest as plain text (the email's text part). */
export function digestText(digest, appUrl = DIGEST_APP_URL) {
  const lines = [digest.title, ''];
  digest.numberLines.forEach((line) => lines.push(`- ${line}`));
  if (digest.targetsMet.length) lines.push('', 'Targets met:', ...digest.targetsMet.map((text) => `- ${text}`));
  if (digest.targetsMissed.length) lines.push('', 'Targets missed:', ...digest.targetsMissed.map((text) => `- ${text}`));
  if (digest.moment) lines.push('', `One moment (${digest.moment.from}):`, digest.moment.text);
  const ahead = [digest.nextWeekWithKids, ...digest.plans.map((plan) => `${plan.title}: ${plan.when}`), ...digest.milestones].filter(Boolean);
  if (ahead.length) lines.push('', 'Next week:', ...ahead.map((line) => `- ${line}`));
  lines.push('', `Review the week: ${appUrl}/`, `This digest in the app: ${appUrl}/#digest`);
  return lines.join('\n');
}

const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

/** The digest as an email page: plain inline styles that email apps keep, in the app's colours. */
export function digestHtml(digest, appUrl = DIGEST_APP_URL) {
  const heading = (text) => `<h2 style="font:600 15px/1.3 Georgia,serif;color:#1d2a36;margin:22px 0 8px">${escapeHtml(text)}</h2>`;
  const list = (items) => `<ul style="margin:0;padding-left:20px">${items.map((item) => `<li style="margin:4px 0">${escapeHtml(item)}</li>`).join('')}</ul>`;
  const parts = [
    `<h1 style="font:600 22px/1.25 Georgia,serif;color:#1d2a36;margin:0 0 14px">${escapeHtml(digest.title)}</h1>`,
    list(digest.numberLines)
  ];
  if (digest.targetsMet.length) parts.push(heading('Targets met'), list(digest.targetsMet));
  if (digest.targetsMissed.length) parts.push(heading('Targets missed'), list(digest.targetsMissed));
  if (digest.moment) {
    parts.push(heading('One moment'), `<blockquote style="margin:0;padding:8px 14px;border-left:3px solid #c98a2b;color:#33414d">${escapeHtml(digest.moment.text)}<br><span style="font-size:13px;color:#5b6772">${escapeHtml(digest.moment.from)}</span></blockquote>`);
  }
  const ahead = [digest.nextWeekWithKids, ...digest.plans.map((plan) => `${plan.title}: ${plan.when}`), ...digest.milestones].filter(Boolean);
  if (ahead.length) parts.push(heading('Next week'), list(ahead));
  parts.push(`<p style="margin:24px 0 0"><a href="${escapeHtml(`${appUrl}/`)}" style="display:inline-block;background:#d99a2b;color:#1d2a36;text-decoration:none;font-weight:600;padding:9px 16px;border-radius:999px">Review the week</a></p>`);
  parts.push(`<p style="font-size:12px;color:#5b6772;margin:18px 0 0">Sent every Sunday at 7 pm by Time Left To Live. Turn it off in the app: <a href="${escapeHtml(`${appUrl}/#digest`)}" style="color:#5b6772">${escapeHtml(`${appUrl}/#digest`)}</a></p>`);
  return `<!doctype html><html><body style="margin:0;background:#f4efe6"><div style="max-width:560px;margin:0 auto;padding:24px 20px;font:15px/1.5 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1d2a36">${parts.join('')}</div></body></html>`;
}
