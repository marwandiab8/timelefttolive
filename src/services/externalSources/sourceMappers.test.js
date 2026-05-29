import { describe, expect, it } from 'vitest';
import { mapAiGridlineRecord } from './aiGridlineMapper.js';
import { mapGymK2Record } from './gymK2Mapper.js';
import { normalizeExternalDailyItem, stableExternalItemId } from './sourceMappers.js';

describe('external source mappers', () => {
  it('maps aigridline media to a project picture on the correct day', () => {
    const item = mapAiGridlineRecord({
      id: 'media1',
      dateKey: '2028-07-25',
      storagePath: 'media/photo.jpg',
      contentType: 'image/jpeg',
      projectId: 'site-a'
    });
    expect(item.dateId).toBe('2028-07-25');
    expect(item.category).toBe('projectPicture');
    expect(item.sourceApp).toBe('aigridline');
  });

  it('maps GYM-K2 workouts and dedupes them', () => {
    const item = mapGymK2Record({
      id: 'w1',
      workoutDate: '2028-07-25',
      workoutName: 'Push day',
      sourceDocumentPath: 'workouts/w1'
    });
    expect(item.category).toBe('workout');
    expect(stableExternalItemId(item.dedupeKey)).toMatch(/^ext_/);
  });

  it('marks missing-date items for review', () => {
    const item = normalizeExternalDailyItem({
      sourceApp: 'manual',
      sourceDocumentPath: 'unknown/1'
    });
    expect(item.needsDateReview).toBe(true);
    expect(item.syncStatus).toBe('needsDateReview');
  });
});
