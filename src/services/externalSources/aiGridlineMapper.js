import { normalizeExternalDailyItem } from './sourceMappers.js';

export function mapAiGridlineRecord(record = {}) {
  const isMedia = Boolean(record.storagePath || record.downloadURL || record.contentType);
  return normalizeExternalDailyItem({
    sourceApp: 'aigridline',
    sourceFirebaseProjectId: 'aigridline',
    category: isMedia ? 'projectPicture' : (record.reportType === 'journal' ? 'journal' : 'constructionReport'),
    title: record.title || record.reportTitle || record.captionText || 'aigridline record',
    summary: record.summary || record.body || record.captionText || '',
    description: record.description || record.notes || '',
    dateId: record.dateId || record.dateKey || record.reportDateKey,
    sourceProjectName: record.projectName || record.projectId || record.projectSlug || '',
    sourceProjectId: record.projectId || record.projectSlug || '',
    sourceCollection: record.sourceCollection || record.collection || (isMedia ? 'media' : 'dailyReports'),
    sourceDocumentId: record.id || record.sourceDocumentId || '',
    sourceDocumentPath: record.sourceDocumentPath || '',
    sourceStoragePath: record.storagePath || '',
    fileUrl: record.downloadURL || record.fileUrl || '',
    thumbnailUrl: record.thumbnailUrl || record.downloadURL || '',
    contentType: record.contentType || '',
    fileName: record.fileName || '',
    originalCreatedAt: record.createdAt || null,
    originalUpdatedAt: record.updatedAt || null,
    capturedAt: record.capturedAt || record.createdAt || null,
    visibility: record.visibility || 'ownerOnly',
    metadata: record
  });
}
