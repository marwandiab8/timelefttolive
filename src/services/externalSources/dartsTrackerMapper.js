import { normalizeExternalDailyItem } from './sourceMappers.js';

export function mapDartsTrackerRecord(record = {}) {
  return normalizeExternalDailyItem({
    sourceApp: 'DartstRacker2026',
    sourceFirebaseProjectId: 'dartstracker2026',
    category: 'dartsRecord',
    title: record.title || 'Darts record',
    summary: record.summary || record.notes || '',
    dateId: record.dateId || record.dartDate,
    sourceCollection: record.sourceCollection || 'dailyDarts',
    sourceDocumentId: record.id || '',
    sourceDocumentPath: record.sourceDocumentPath || '',
    originalCreatedAt: record.createdAt || null,
    originalUpdatedAt: record.updatedAt || null,
    visibility: record.visibility || 'ownerOnly',
    metadata: record
  });
}
