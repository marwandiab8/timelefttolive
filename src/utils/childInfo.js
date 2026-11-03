import { toLocalDate } from './dateUtils.js';

// Ontario grades. A child's grade is saved with the school year it was entered for (the year that school year's
// September fell in) and moves up one each September after that, so it doesn't go stale.
export const GRADES = ['JK', 'SK', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];
export const FINISHED_SCHOOL = 'finished';

export function schoolYearStart(now = new Date()) {
  const today = toLocalDate(now);
  return today.getMonth() >= 8 ? today.getFullYear() : today.getFullYear() - 1;
}

export function currentGrade(child, now = new Date()) {
  if (child?.grade === FINISHED_SCHOOL) return FINISHED_SCHOOL;
  const index = GRADES.indexOf(String(child?.grade || ''));
  if (index < 0) return '';
  const thisYear = schoolYearStart(now);
  const moved = index + Math.max(0, thisYear - Number(child.gradeSchoolYear || thisYear));
  return moved < GRADES.length ? GRADES[moved] : FINISHED_SCHOOL;
}

export function gradeLabel(grade) {
  if (grade === FINISHED_SCHOOL) return 'Finished high school';
  if (!grade || grade === 'JK' || grade === 'SK') return grade || '';
  return `Grade ${grade}`;
}

const blankDetail = () => ({ id: crypto.randomUUID(), label: '', value: '' });

export const blankChild = () => ({ id: crypto.randomUUID(), name: '', birthDate: '', grade: '', school: '', details: [] });

// The profile form edits this year's grade, so a saved grade that has moved up since shows as its current one.
export function childForForm(child, now = new Date()) {
  return {
    ...blankChild(),
    ...child,
    grade: currentGrade(child, now),
    school: child.school || '',
    details: (child.details || []).map((detail) => ({ ...blankDetail(), ...detail }))
  };
}

export function addChildDetail(child) {
  return { ...child, details: [...(child.details || []), blankDetail()] };
}

// What is saved for a child. The grade is stamped with this school year; empty details are dropped.
export function normalizeChild(child, now = new Date()) {
  const grade = child.grade === FINISHED_SCHOOL || GRADES.includes(child.grade) ? child.grade : '';
  return {
    id: child.id || crypto.randomUUID(),
    name: (child.name || '').trim(),
    birthDate: child.birthDate || '',
    grade,
    gradeSchoolYear: grade ? schoolYearStart(now) : null,
    school: (child.school || '').trim(),
    details: (child.details || [])
      .map((detail) => ({ id: detail.id || crypto.randomUUID(), label: (detail.label || '').trim(), value: (detail.value || '').trim() }))
      .filter((detail) => detail.label || detail.value)
  };
}
