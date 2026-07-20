function mapAiGridlineToTimeLeft(record = {}) {
  const contentType = record.contentType || record.mimeType || "";
  const collection = record.sourceCollection || record.collection || (record.storagePath || record.downloadURL ? "media" : "dailyReports");
  const category = collection === "media"
    ? (String(contentType).startsWith("image/") ? "projectPicture" : "file")
    : (collection === "logEntries" ? "journal" : "constructionReport");
  return {
    dateId: record.dateId || record.reportDateKey || record.dateKey,
    sourceApp: "aigridline",
    category,
    title: record.title || record.name || record.captionText || "aigridline item",
    summary: record.summary || record.notes || record.description || "",
    description: record.description || record.body || "",
    sourceFirebaseProjectId: record.sourceFirebaseProjectId,
    sourceProjectName: record.projectName || record.projectTitle || "",
    sourceProjectId: record.projectId || record.projectSlug || "",
    sourceCollection: collection,
    sourceDocumentId: record.id || record.documentId || "",
    sourceDocumentPath: record.sourceDocumentPath || record.path || "",
    sourceStoragePath: record.storagePath || "",
    sourceUrl: record.sourceUrl || "",
    fileUrl: record.downloadURL || record.fileUrl || "",
    thumbnailUrl: record.thumbnailUrl || record.thumbnailURL || "",
    contentType,
    fileName: record.fileName || record.name || "",
    fileSize: record.fileSize || record.size || null,
    originalCreatedAt: record.createdAt || null,
    originalUpdatedAt: record.updatedAt || null,
    capturedAt: record.capturedAt || record.date || null,
    visibility: record.visibility || "ownerOnly",
    metadata: record.metadata || {}
  };
}

module.exports = {
  mapAiGridlineToTimeLeft
};
