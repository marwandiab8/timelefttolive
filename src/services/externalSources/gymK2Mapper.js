import { normalizeExternalDailyItem } from './sourceMappers.js';

export function mapGymK2Record(record = {}) {
  return normalizeExternalDailyItem({
    sourceApp: 'GYM-K2',
    sourceFirebaseProjectId: 'gym-k2',
    category: 'workout',
    title: record.title || record.workoutName || record.type || 'Workout',
    summary: record.summary || record.notes || '',
    dateId: record.dateId || record.workoutDate,
    sourceCollection: record.sourceCollection || 'workouts',
    sourceDocumentId: record.id || '',
    sourceDocumentPath: record.sourceDocumentPath || '',
    fileUrl: record.fileUrl || record.photoUrl || '',
    thumbnailUrl: record.thumbnailUrl || record.photoUrl || '',
    originalCreatedAt: record.createdAt || null,
    originalUpdatedAt: record.updatedAt || null,
    visibility: record.visibility || 'ownerOnly',
    metadata: record
  });
}
