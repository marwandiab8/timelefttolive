const assert = require("node:assert/strict");
const test = require("node:test");
const {
  buildEnrichedLegacyRecord,
  buildJournalEnrichmentCandidate,
  evaluateJournalEnrichment,
  isEligibleLegacyRecord
} = require("./journalEnrichment");

const context = {
  calendarId: "calendar-1",
  connectionId: "connection-1",
  integrationId: "integration-1",
  timeLeftUserId: "owner-1",
  connection: {
    sourceApp: "gridlineai",
    sourceFirebaseProjectId: "gridlineai",
    sourceProjectIds: ["home"]
  }
};

const legacy = {
  dateId: "2026-08-18",
  timezone: "America/Toronto",
  sourceApp: "gridlineai",
  sourceFirebaseProjectId: "gridlineai",
  sourceProjectId: "home",
  sourceDocumentPath: "logEntries/log-1",
  sourceDocumentId: "log-1",
  category: "journalEntry",
  title: "Journal Entry",
  metadata: { legacyMarker: true }
};

test("journal enrichment keeps multiline text and replaces the date-only noon sentinel with the source instant", () => {
  const candidate = buildJournalEnrichmentCandidate(legacy, {
    projectId: "home",
    rawText: "Morning notes\nSteel work continued.",
    createdAt: new Date("2026-08-18T12:42:00.000Z")
  }, context);
  assert.equal(candidate.title, "Morning notes");
  assert.equal(candidate.metadata.journal.text, "Morning notes\nSteel work continued.");
  assert.equal(candidate.occurredAt.toISOString(), "2026-08-18T12:42:00.000Z");
  assert.equal(candidate.startAt, null);
});

test("explicit Shortcut shadows are marked without dropping their stable identity", () => {
  const enriched = buildEnrichedLegacyRecord(legacy, {
    projectId: "home",
    rawText: "Arrived at work",
    source: "ios_shortcuts",
    shortcutEventId: "shortcut-1",
    createdAt: new Date("2026-08-18T10:57:00.000Z")
  });
  assert.equal(enriched.metadata.activityVisibility, "shortcut_shadow");
  assert.equal(enriched.metadata.shortcutEventId, "shortcut-1");
  assert.equal(enriched.sourceDocumentPath, legacy.sourceDocumentPath);
});

test("image enrichment stores only canonical media metadata, not a public URL", () => {
  const imageLegacy = {
    ...legacy,
    category: "image",
    sourceDocumentPath: "media/media-1"
  };
  const enriched = buildEnrichedLegacyRecord(imageLegacy, {
    projectId: "home",
    captionText: "Morning photo",
    storagePath: "projects/home/media/2026-08-18/message/photo.jpg",
    contentType: "image/jpeg",
    createdAt: new Date("2026-08-18T12:40:00.000Z")
  });
  assert.equal(enriched.description, "Morning photo");
  assert.equal(enriched.sourceStoragePath, "projects/home/media/2026-08-18/message/photo.jpg");
  assert.equal(Object.hasOwn(enriched, "fileUrl"), false);
});

test("repair is limited to the exact legacy-generated canonical identity", () => {
  const candidate = buildJournalEnrichmentCandidate(legacy, {
    projectId: "home",
    rawText: "Actual note",
    createdAt: new Date("2026-08-18T12:42:00.000Z")
  }, context);
  const existing = {
    ...candidate,
    contentHash: "stale-hash",
    legacySourceType: "legacy:gridlineai",
    createdAt: new Date("2026-08-18T13:00:00.000Z"),
    receivedAt: new Date("2026-08-18T13:00:00.000Z")
  };
  const result = evaluateJournalEnrichment({
    canonicalId: candidate.idempotencyKey,
    existing,
    candidate,
    now: new Date("2026-08-19T00:00:00.000Z")
  });
  assert.equal(result.status, "repair");
  assert.equal(result.data.id, candidate.idempotencyKey);
  assert.equal(result.data.createdAt, existing.createdAt);
  assert.equal(result.expectedContentHash, "stale-hash");

  const protectedResult = evaluateJournalEnrichment({
    canonicalId: candidate.idempotencyKey,
    existing: { ...existing, legacySourceType: "", metadata: {} },
    candidate
  });
  assert.deepEqual(protectedResult, { status: "conflict", reason: "canonical_not_legacy_generated" });
});

test("unrelated source paths and identity changes are rejected", () => {
  assert.equal(isEligibleLegacyRecord({ ...legacy, sourceDocumentPath: "projects/home/private" }), false);
  assert.equal(isEligibleLegacyRecord({ ...legacy, category: "other" }), true);
  const candidate = buildJournalEnrichmentCandidate(legacy, {
    projectId: "home",
    rawText: "Actual note",
    createdAt: new Date("2026-08-18T12:42:00.000Z")
  }, context);
  const result = evaluateJournalEnrichment({
    canonicalId: candidate.idempotencyKey,
    existing: {
      ...candidate,
      sourceProjectId: "docksteader",
      legacySourceType: "legacy:gridlineai"
    },
    candidate
  });
  assert.equal(result.status, "conflict");
  assert.equal(result.reason, "canonical_source_identity_mismatch");
});
