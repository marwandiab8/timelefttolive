import { GRADES, FINISHED_SCHOOL, schoolYearStart } from './childInfo.js';
import { getCustodyWeekStatus } from './custodyUtils.js';
import { addYears, daysBetween, formatDateId, parseDateId, toLocalDate } from './dateUtils.js';

// The milestones still ahead for each child, worked out from their birth date and grade: the 16th birthday (an
// Ontario G1 licence becomes possible), the end of Grade 8 and of Grade 12 (in June of that school year), and the
// 18th birthday. Birthdays have a day, so they say whose week they fall in; school endings are known to the month.

const SCHOOL_ENDS = [
  { grade: '8', key: 'grade8', what: 'finishes Grade 8' },
  { grade: '12', key: 'grade12', what: 'graduates high school' }
];

/** The school year (the year its September falls in) in which the child is in `grade`, or null. */
function schoolYearInGrade(child, grade, now) {
  if (!child?.grade || child.grade === FINISHED_SCHOOL) return null;
  const savedIndex = GRADES.indexOf(String(child.grade));
  const targetIndex = GRADES.indexOf(grade);
  if (savedIndex < 0 || targetIndex < 0) return null;
  const savedYear = Number(child.gradeSchoolYear || schoolYearStart(now));
  return savedYear + (targetIndex - savedIndex);
}

/**
 * Every milestone still ahead (on or after today) for one child, soonest first:
 * `{ childId, name, key, what, dateId, precision: 'day' | 'month', weeksAway, withYou }`.
 * `withYou` is true or false for a day on the schedule, null when unknown.
 */
export function getChildMilestones(child, { now = new Date(), custodySchedule = null } = {}) {
  if (!child?.birthDate) return [];
  const today = toLocalDate(now);
  const todayId = formatDateId(today);
  const name = child.name || 'Your child';
  const onSchedule = Boolean(custodySchedule?.enabled && (custodySchedule.childIds || []).includes(child.id));
  const milestones = [
    { key: 'g1', what: 'can get a G1 licence', dateId: formatDateId(addYears(child.birthDate, 16)), precision: 'day' },
    { key: 'eighteen', what: 'turns 18', dateId: formatDateId(addYears(child.birthDate, 18)), precision: 'day' }
  ];
  SCHOOL_ENDS.forEach((end) => {
    const year = schoolYearInGrade(child, end.grade, now);
    // The last day of school is late in June; the 30th keeps it in order and in the right month.
    if (year !== null) milestones.push({ key: end.key, what: end.what, dateId: `${year + 1}-06-30`, precision: 'month' });
  });
  return milestones
    .filter((milestone) => milestone.dateId >= todayId)
    .map((milestone) => {
      const status = onSchedule && milestone.precision === 'day' ? getCustodyWeekStatus(custodySchedule, parseDateId(milestone.dateId)) : null;
      return {
        childId: child.id,
        name,
        ...milestone,
        weeksAway: Math.floor(daysBetween(today, parseDateId(milestone.dateId)) / 7),
        withYou: status ? Boolean(status.withYou) : null
      };
    })
    .sort((left, right) => left.dateId.localeCompare(right.dateId) || left.key.localeCompare(right.key));
}

/** All the children's milestones together, soonest first, at most `limit`. */
export function getFamilyMilestones(children = [], options = {}, limit = 8) {
  return children.flatMap((child) => getChildMilestones(child, options))
    .sort((left, right) => left.dateId.localeCompare(right.dateId) || left.name.localeCompare(right.name))
    .slice(0, limit);
}

const dayLabel = (dateId) => parseDateId(dateId).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const monthLabel = (dateId) => parseDateId(dateId).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

/** "in 31 weeks", "this week", "next week". */
export function describeWeeksAway(weeks) {
  if (weeks <= 0) return 'this week';
  if (weeks === 1) return 'next week';
  return `in ${weeks.toLocaleString()} weeks`;
}

/** One line for a milestone, e.g. "David can get a G1 licence in 31 weeks (Jun 28, 2026), in your week." */
export function describeMilestone(milestone, { withName = true, day = dayLabel, month = monthLabel } = {}) {
  const when = milestone.precision === 'day' ? `${describeWeeksAway(milestone.weeksAway)} (${day(milestone.dateId)})` : `in ${month(milestone.dateId)}`;
  const week = milestone.withYou === null ? '' : milestone.withYou ? ', in your week' : ", in their other parent's week";
  const sentence = `${withName ? `${milestone.name} ` : ''}${milestone.what} ${when}${week}.`;
  return withName ? sentence : sentence[0].toUpperCase() + sentence.slice(1);
}
