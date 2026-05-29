import { isValidDateId, timestampToDateId } from '../../utils/dateUtils.js';
import { SOURCE_APPS } from './types.js';

export function resolveExternalDateId(record = {}) {
  const explicit = [
    record.dateId,
    record.reportDate,
    record.reportDateKey,
    record.dateKey,
    record.journalDate,
    record.workoutDate,
    record.progressDate,
    record.dartDate,
    record.createdForDate
  ].find(Boolean);
  if (explicit && isValidDateId(String(explicit))) return String(explicit);

  return timestampToDateId(record.capturedAt)
    || timestampToDateId(record.originalCreatedAt)
    || timestampToDateId(record.fileMetadataDate)
    || timestampToDateId(record.uploadedAt)
    || timestampToDateId(record.createdAt)
    || '';
}

export function buildDedupeKey(item) {
  const sourceApp = item.sourceApp || 'manual';
  const sourceFirebaseProjectId = item.sourceFirebaseProjectId || '';
  const sourceDocumentPath = item.sourceDocumentPath || `${item.sourceCollection || ''}/${item.sourceDocumentId || ''}`;
  const sourceStoragePath = item.sourceStoragePath || '';
  return [sourceApp, sourceFirebaseProjectId, sourceDocumentPath, sourceStoragePath].filter(Boolean).join(':');
}

export function stableExternalItemId(dedupeKey) {
  let hash = 0;
  for (let index = 0; index < dedupeKey.length; index += 1) {
    hash = ((hash << 5) - hash + dedupeKey.charCodeAt(index)) | 0;
  }
  return `ext_${Math.abs(hash)}_${dedupeKey.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 80)}`;
}

export function normalizeExternalDailyItem(input = {}) {
  const sourceApp = SOURCE_APPS.includes(input.sourceApp) ? input.sourceApp : 'manual';
  const dateId = isValidDateId(input.dateId) ? input.dateId : resolveExternalDateId(input);
  const needsDateReview = !dateId;
  const category = input.category || 'other';
  const sourceDocumentPath = input.sourceDocumentPath
    || [input.sourceCollection, input.sourceDocumentId].filter(Boolean).join('/');
  const dedupeKey = input.dedupeKey || buildDedupeKey({ ...input, sourceApp, sourceDocumentPath });

  return {
    calendarId: input.calendarId || '',
    dateId: dateId || 'needsDateReview',
    sourceApp,
    category,
    title: input.title || 'External item',
    summary: input.summary || '',
    description: input.description || '',
    sourceFirebaseProjectId: input.sourceFirebaseProjectId || '',
    sourceProjectName: input.sourceProjectName || '',
    sourceProjectId: input.sourceProjectId || '',
    sourceCollection: input.sourceCollection || '',
    sourceDocumentId: input.sourceDocumentId || '',
    sourceDocumentPath,
    sourceStoragePath: input.sourceStoragePath || '',
    sourceUrl: input.sourceUrl || '',
    fileUrl: input.fileUrl || '',
    thumbnailUrl: input.thumbnailUrl || '',
    contentType: input.contentType || '',
    fileName: input.fileName || '',
    fileSize: Number(input.fileSize || 0),
    originalCreatedAt: input.originalCreatedAt || null,
    originalUpdatedAt: input.originalUpdatedAt || null,
    capturedAt: input.capturedAt || null,
    visibility: input.visibility === 'viewers' ? 'viewers' : 'ownerOnly',
    ownerUid: input.ownerUid || '',
    createdByUid: input.createdByUid || input.ownerUid || '',
    updatedByUid: input.updatedByUid || input.ownerUid || '',
    dedupeKey,
    syncStatus: needsDateReview ? 'needsDateReview' : (input.syncStatus || 'active'),
    needsDateReview,
    metadata: input.metadata || {}
  };
}
