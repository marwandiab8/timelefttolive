const crypto = require("node:crypto");

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function buildDedupeKey(item = {}) {
  const sourceApp = item.sourceApp || "manual";
  const sourceFirebaseProjectId = item.sourceFirebaseProjectId || "unknown-project";
  if (item.sourceDocumentPath) {
    return [
      sourceApp,
      sourceFirebaseProjectId,
      item.sourceDocumentPath,
      item.sourceStoragePath || ""
    ].filter(Boolean).join(":");
  }
  if (item.sourceUrl) {
    return [sourceApp, sourceFirebaseProjectId, item.sourceUrl].join(":");
  }
  return [
    sourceApp,
    sourceFirebaseProjectId,
    item.sourceProjectId || "unknown-source-project",
    item.title || "untitled",
    item.dateId || "needs-date",
    item.originalCreatedAt || item.createdAt || ""
  ].join(":");
}

function externalItemIdForDedupeKey(dedupeKey) {
  return sha256(dedupeKey);
}

module.exports = {
  buildDedupeKey,
  externalItemIdForDedupeKey,
  sha256
};
