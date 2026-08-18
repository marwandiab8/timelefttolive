const { EXTERNAL_CATEGORIES, SOURCE_APPS } = require("./constants");
const { buildDedupeKey, externalItemIdForDedupeKey } = require("./dedupe");
const { resolveDateId } = require("./dateId");

function normalizeSourceApp(value) {
  return SOURCE_APPS.includes(value) ? value : "";
}

function normalizeCategory(category, metadata = {}) {
  if (category === "journalEntry") return { category: "journal", metadata };
  if (EXTERNAL_CATEGORIES.includes(category)) return { category, metadata };
  return {
    category: "other",
    metadata: {
      ...metadata,
      ...(category ? { originalCategory: category } : {})
    }
  };
}

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeExternalItem(raw = {}, context = {}) {
  const sourceApp = normalizeSourceApp(raw.sourceApp);
  const { dateId, sourceField } = resolveDateId(raw);
  const categoryResult = normalizeCategory(raw.category, raw.metadata && typeof raw.metadata === "object" ? raw.metadata : {});
  const normalized = {
    calendarId: context.calendarId || raw.calendarId || "",
    dateId,
    connectionId: context.connectionId || raw.connectionId || "",
    sourceApp,
    category: categoryResult.category,
    title: cleanString(raw.title) || "External item",
    summary: cleanString(raw.summary),
    description: cleanString(raw.description),
    sourceFirebaseProjectId: cleanString(raw.sourceFirebaseProjectId),
    sourceProjectName: cleanString(raw.sourceProjectName),
    sourceProjectId: cleanString(raw.sourceProjectId),
    sourceCollection: cleanString(raw.sourceCollection),
    sourceDocumentId: cleanString(raw.sourceDocumentId),
    sourceDocumentPath: cleanString(raw.sourceDocumentPath),
    sourceStoragePath: cleanString(raw.sourceStoragePath),
    sourceUrl: cleanString(raw.sourceUrl),
    fileUrl: cleanString(raw.fileUrl),
    thumbnailUrl: cleanString(raw.thumbnailUrl),
    contentType: cleanString(raw.contentType),
    fileName: cleanString(raw.fileName),
    fileSize: Number.isFinite(Number(raw.fileSize)) ? Number(raw.fileSize) : null,
    originalCreatedAt: raw.originalCreatedAt || raw.createdAt || null,
    originalUpdatedAt: raw.originalUpdatedAt || raw.updatedAt || null,
    capturedAt: raw.capturedAt || null,
    visibility: raw.visibility === "viewers" ? "viewers" : "ownerOnly",
    ownerUid: context.ownerUid || raw.ownerUid || "",
    createdByUid: context.createdByUid || raw.createdByUid || `ingestion:${sourceApp || "unknown"}`,
    updatedByUid: context.updatedByUid || raw.updatedByUid || `ingestion:${sourceApp || "unknown"}`,
    syncStatus: raw.syncStatus || "active",
    metadata: {
      ...categoryResult.metadata,
      ...(sourceField ? { resolvedDateField: sourceField } : {})
    }
  };
  const dedupeKey = raw.dedupeKey || buildDedupeKey(normalized);
  return {
    ...normalized,
    dedupeKey,
    externalItemId: externalItemIdForDedupeKey(dedupeKey),
    needsDateReview: !dateId
  };
}

module.exports = {
  normalizeCategory,
  normalizeExternalItem,
  normalizeSourceApp
};
