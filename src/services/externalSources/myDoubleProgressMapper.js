import { normalizeExternalDailyItem } from './sourceMappers.js';

export function mapMyDoubleProgressRecord(record = {}) {
  return normalizeExternalDailyItem({
    sourceApp: 'MyDoubleProgress',
    sourceFirebaseProjectId: 'mydoublesprogress',
    category: 'progressRecord',
    title: record.title || 'Daily progress',
    summary: record.summary || record.notes || '',
    dateId: record.dateId || record.progressDate,
    sourceCollection: record.sourceCollection || 'dailyProgress',
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
