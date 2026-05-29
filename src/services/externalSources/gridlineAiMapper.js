import { normalizeExternalDailyItem } from './sourceMappers.js';

export function mapGridlineAiRecord(record = {}) {
  const isMedia = Boolean(record.storagePath || record.fileUrl || record.downloadURL);
  return normalizeExternalDailyItem({
    sourceApp: 'gridlineai',
    sourceFirebaseProjectId: 'gridlineai',
    category: isMedia ? 'projectPicture' : (record.reportType === 'journal' ? 'journal' : 'projectReport'),
    title: record.title || record.reportTitle || 'gridlineai record',
    summary: record.summary || record.notes || '',
    dateId: record.dateId || record.dateKey || record.reportDateKey,
    sourceProjectName: record.projectName || record.projectId || '',
    sourceProjectId: record.projectId || '',
    sourceCollection: record.sourceCollection || (isMedia ? 'media' : 'dailyReports'),
    sourceDocumentId: record.id || '',
    sourceDocumentPath: record.sourceDocumentPath || '',
    sourceStoragePath: record.storagePath || '',
    fileUrl: record.fileUrl || record.downloadURL || '',
    thumbnailUrl: record.thumbnailUrl || record.downloadURL || '',
    contentType: record.contentType || '',
    originalCreatedAt: record.createdAt || null,
    originalUpdatedAt: record.updatedAt || null,
    visibility: record.visibility || 'ownerOnly',
    metadata: record
  });
}
