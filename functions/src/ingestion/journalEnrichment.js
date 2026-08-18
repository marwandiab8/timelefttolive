const { mapLegacyToLifeEvent } = require("./lifeEventFoundation");

const MIGRATION_NAME = "gridline-journal-canonical-enrichment";
const MIGRATION_VERSION = 1;

function cleanText(value, max = 12000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function cleanInline(value, max = 240) {
  return cleanText(value, max).replace(/\s+/g, " ");
}

function sourcePathForLegacy(legacy = {}) {
  const candidates = [
    legacy.sourceDocumentPath,
    legacy.sourceRecordId,
    legacy.sourceEventId
  ];
  return candidates.find((value) => /^(logEntries|media)\/[A-Za-z0-9_-]+$/.test(String(value || ""))) || "";
}

function sourceProjectId(source = {}) {
  return cleanText(source.projectId || source.projectSlug, 180);
}

function sourceTimestamp(source = {}) {
  return source.occurredAt || source.createdAt || source.capturedAt || source.takenAt || null;
}

function sentTimestamp(source = {}) {
  return source.sentAt || source.messageSentAt || source.sourceSentAt || source.addedAt || null;
}

function sourceNote(source = {}) {
  return cleanText(source.rawText || source.normalizedText || source.body || source.text || source.summaryText);
}

function sourceCaption(source = {}) {
  return cleanText(source.captionText || source.caption || source.description || source.aiSummary, 2000);
}

function sourceTitle(source, fallbackText, fallback = "Journal Entry") {
  const explicit = cleanInline(source?.title || source?.heading, 180);
  if (explicit && !/^journal entry$/i.test(explicit)) return explicit;
  const firstLine = cleanInline(String(fallbackText || "").split(/\r?\n/).find((line) => line.trim()), 180);
  return firstLine || fallback;
}

function isEligibleLegacyRecord(legacy = {}) {
  if (legacy.sourceApp !== "gridlineai") return false;
  // Older Gridline deliveries normalized journalEntry to `other`, so the
  // stable source collection is stronger than that lossy category value.
  const collection = sourcePathForLegacy(legacy).split("/")[0];
  return collection === "logEntries" || collection === "media";
}

function buildEnrichedLegacyRecord(legacy, source, options = {}) {
  const sourcePath = options.sourcePath || sourcePathForLegacy(legacy);
  const collection = sourcePath.split("/")[0];
  const projectId = sourceProjectId(source);
  const metadata = legacy?.metadata && typeof legacy.metadata === "object" && !Array.isArray(legacy.metadata)
    ? { ...legacy.metadata }
    : {};
  const occurredAt = sourceTimestamp(source);
  const sentAt = sentTimestamp(source);

  if (collection === "logEntries") {
    const note = sourceNote(source);
    const shortcutShadow = source.source === "ios_shortcuts" && Boolean(source.shortcutEventId);
    const linkedMediaIds = [...new Set([
      ...(Array.isArray(source.linkedMediaIds) ? source.linkedMediaIds : []),
      ...(Array.isArray(options.linkedMediaPaths) ? options.linkedMediaPaths : [])
    ].map((value) => cleanText(value, 1024)).filter(Boolean))];
    return {
      ...legacy,
      category: "journal",
      title: sourceTitle(source, note),
      summary: note,
      description: note,
      sourceProjectId: projectId || legacy.sourceProjectId || "",
      sourceDocumentPath: sourcePath,
      originalCreatedAt: occurredAt || legacy.originalCreatedAt || null,
      ...(sentAt ? { sentAt } : {}),
      metadata: {
        ...metadata,
        linkedMediaIds,
        ...(shortcutShadow ? {
          activityVisibility: "shortcut_shadow",
          shortcutEventId: cleanInline(source.shortcutEventId, 180)
        } : {})
      }
    };
  }

  const caption = sourceCaption(source);
  return {
    ...legacy,
    category: "image",
    title: cleanInline(source.title || source.fileName, 180) || "Photo",
    summary: caption,
    description: caption,
    sourceProjectId: projectId || legacy.sourceProjectId || "",
    sourceDocumentPath: sourcePath,
    sourceStoragePath: cleanText(source.storagePath, 1024),
    contentType: cleanInline(source.contentType || source.mimeType, 120),
    fileName: cleanInline(source.fileName, 180),
    originalCreatedAt: occurredAt || legacy.originalCreatedAt || null,
    ...(sentAt ? { sentAt } : {}),
    metadata: {
      ...metadata,
      linkedLogEntryId: cleanInline(source.linkedLogEntryId, 180)
    }
  };
}

function isLegacyGenerated(event = {}) {
  return String(event.legacySourceType || "").startsWith("legacy:")
    || String(event.metadata?.legacySourceType || "").startsWith("legacy:");
}

function sameValue(left, right) {
  return String(left || "") === String(right || "");
}

function identityMatches(existing, candidate) {
  return existing?.schemaVersion === candidate?.schemaVersion
    && sameValue(existing.integrationId, candidate.integrationId)
    && sameValue(existing.connectionId, candidate.connectionId)
    && sameValue(existing.calendarId, candidate.calendarId)
    && sameValue(existing.timeLeftUserId, candidate.timeLeftUserId)
    && sameValue(existing.sourceApp, candidate.sourceApp)
    && sameValue(existing.sourceProjectId, candidate.sourceProjectId)
    && sameValue(existing.sourceRecordId, candidate.sourceRecordId)
    && sameValue(existing.sourceEventId, candidate.sourceEventId);
}

function buildJournalEnrichmentCandidate(legacy, source, context, options = {}) {
  if (!isEligibleLegacyRecord(legacy)) return null;
  const enriched = buildEnrichedLegacyRecord(legacy, source, options);
  return mapLegacyToLifeEvent(enriched, context);
}

function evaluateJournalEnrichment({ canonicalId, existing, candidate, now = new Date() }) {
  if (!candidate) return { status: "skipped", reason: "not_eligible" };
  if (!existing) return { status: "skipped", reason: "canonical_missing" };
  if (canonicalId !== candidate.idempotencyKey) {
    return { status: "conflict", reason: "canonical_identity_mismatch" };
  }
  if (!isLegacyGenerated(existing)) {
    return { status: "conflict", reason: "canonical_not_legacy_generated" };
  }
  if (!identityMatches(existing, candidate)) {
    return { status: "conflict", reason: "canonical_source_identity_mismatch" };
  }
  if (existing.contentHash === candidate.contentHash) {
    return { status: "unchanged" };
  }
  const enrichmentMetadata = {
    name: MIGRATION_NAME,
    version: MIGRATION_VERSION,
    action: "journal-content-enriched",
    sourceRecordId: candidate.sourceRecordId || candidate.sourceEventId,
    enrichedAt: now
  };
  const migrationMetadata = existing.migrationMetadata && typeof existing.migrationMetadata === "object"
    ? { ...existing.migrationMetadata, journalEnrichment: enrichmentMetadata }
    : enrichmentMetadata;
  return {
    status: "repair",
    expectedContentHash: existing.contentHash,
    data: {
      ...candidate,
      id: canonicalId,
      createdAt: existing.createdAt,
      receivedAt: existing.receivedAt,
      ingestionStatus: existing.ingestionStatus,
      migrationMetadata,
      updatedAt: now
    }
  };
}

module.exports = {
  MIGRATION_NAME,
  MIGRATION_VERSION,
  buildEnrichedLegacyRecord,
  buildJournalEnrichmentCandidate,
  evaluateJournalEnrichment,
  identityMatches,
  isEligibleLegacyRecord,
  sourcePathForLegacy
};
