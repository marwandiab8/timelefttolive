import { describe, expect, it } from 'vitest';
import { childForForm, currentGrade, FINISHED_SCHOOL, gradeLabel, normalizeChild, schoolYearStart } from './childInfo.js';
import { parseDateId } from './dateUtils.js';

describe('school years and grades', () => {
  it('starts the school year in September', () => {
    expect(schoolYearStart(parseDateId('2026-08-31'))).toBe(2025);
    expect(schoolYearStart(parseDateId('2026-09-01'))).toBe(2026);
    expect(schoolYearStart(parseDateId('2027-06-30'))).toBe(2026);
  });

  it('moves a saved grade up one each September', () => {
    const child = { grade: '11', gradeSchoolYear: 2026 };
    expect(currentGrade(child, parseDateId('2026-11-02'))).toBe('11');
    expect(currentGrade(child, parseDateId('2027-08-31'))).toBe('11');
    expect(currentGrade(child, parseDateId('2027-09-01'))).toBe('12');
    expect(currentGrade(child, parseDateId('2028-09-01'))).toBe(FINISHED_SCHOOL);
    expect(currentGrade({ grade: 'SK', gradeSchoolYear: 2025 }, parseDateId('2026-09-15'))).toBe('1');
  });

  it('leaves a grade without its year, or no grade, as it is', () => {
    expect(currentGrade({ grade: '8' }, parseDateId('2030-01-01'))).toBe('8');
    expect(currentGrade({}, parseDateId('2030-01-01'))).toBe('');
    expect(currentGrade({ grade: FINISHED_SCHOOL, gradeSchoolYear: 2020 })).toBe(FINISHED_SCHOOL);
  });

  it('names grades the way they are said', () => {
    expect(gradeLabel('11')).toBe('Grade 11');
    expect(gradeLabel('JK')).toBe('JK');
    expect(gradeLabel(FINISHED_SCHOOL)).toBe('Finished high school');
    expect(gradeLabel('')).toBe('');
  });
});

describe('saving a child', () => {
  it('stamps the grade with this school year and drops empty details', () => {
    const saved = normalizeChild({
      id: 'a',
      name: ' David ',
      birthDate: '2010-06-28',
      grade: '11',
      school: ' Central ',
      details: [{ id: 'x', label: ' Teacher ', value: ' Ms. Lee ' }, { id: 'y', label: ' ', value: '' }, { id: 'z', label: '', value: 'Hockey Tuesdays' }]
    }, parseDateId('2026-11-02'));
    expect(saved).toEqual({
      id: 'a',
      name: 'David',
      birthDate: '2010-06-28',
      grade: '11',
      gradeSchoolYear: 2026,
      school: 'Central',
      details: [{ id: 'x', label: 'Teacher', value: 'Ms. Lee' }, { id: 'z', label: '', value: 'Hockey Tuesdays' }]
    });
  });

  it('keeps a child saved before grades existed valid', () => {
    expect(normalizeChild({ id: 'a', name: 'Old', birthDate: '2011-04-27' })).toMatchObject({ grade: '', gradeSchoolYear: null, school: '', details: [] });
    expect(normalizeChild({ id: 'a', name: 'Old', birthDate: '2011-04-27', grade: '13' }).grade).toBe('');
  });

  it('opens the form on this year\'s grade, so saving next year keeps it moving', () => {
    const form = childForForm({ id: 'a', name: 'D', birthDate: '2010-06-28', grade: '11', gradeSchoolYear: 2026 }, parseDateId('2027-10-01'));
    expect(form).toMatchObject({ grade: '12', school: '', details: [] });
    expect(normalizeChild(form, parseDateId('2027-10-01'))).toMatchObject({ grade: '12', gradeSchoolYear: 2027 });
  });
});
