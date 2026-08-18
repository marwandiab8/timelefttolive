const MAX_DETAIL_EVENTS = 200;
const DETAIL_CONCURRENCY = 12;
const SOURCE_PROJECT_ID = "gridlineai";

class ActivityJournalError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function cleanText(value, max = 12000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function cleanInline(value, max = 240) {
  return cleanText(value, max).replace(/\s+/g, " ");
}

function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value.toDate === "function") {
    const date = value.toDate();
    return date instanceof Date && !Number.isNaN(date.getTime()) ? date : null;
  }
  if (Number.isFinite(value.seconds)) return new Date(value.seconds * 1000);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toIso(value) {
  return toDate(value)?.toISOString() || null;
}

function safeId(value) {
  const candidate = cleanText(value, 180);
  return /^[A-Za-z0-9_-]+$/.test(candidate) ? candidate : "";
}

function sourceDocumentPath(event) {
  const candidates = [
    event?.sourceRecordId,
    event?.sourceEventId,
    event?.metadata?.sourceDocumentPath,
  ];
  return candidates.find((value) => /^(logEntries|media)\/[A-Za-z0-9_-]+$/.test(String(value || ""))) || "";
}

function sourceProjectId(value) {
  return cleanText(value?.projectId || value?.projectSlug, 180);
}

function meaningfulLocation(source) {
  const candidates = [
    source?.locationName,
    source?.placeName,
    source?.location,
    source?.address,
  ];
  return candidates.find((value) => (
    typeof value === "string"
    && value.trim()
    && !/^\s*-?\d+(?:\.\d+)?\s*[,/]\s*-?\d+(?:\.\d+)?\s*$/.test(value)
  ))?.trim().slice(0, 240) || "";
}

function journalText(source) {
  return cleanText(
    source?.rawText
    || source?.normalizedText
    || source?.body
    || source?.text
    || source?.summaryText,
    12000
  );
}

function journalTitle(source, note) {
  const explicit = cleanInline(source?.title || source?.heading, 160);
  if (explicit && !/^journal entry$/i.test(explicit)) return explicit;
  const firstLine = cleanInline(String(note || "").split(/\r?\n/).find((line) => line.trim()), 160);
  return firstLine || "Journal entry";
}

function sourceOccurredAt(source) {
  return toIso(source?.occurredAt || source?.createdAt || source?.capturedAt || source?.takenAt);
}

function sourceSentAt(source) {
  return toIso(source?.sentAt || source?.messageSentAt || source?.sourceSentAt || source?.addedAt);
}

function mediaCaption(source) {
  return cleanText(source?.captionText || source?.caption || source?.description || source?.aiSummary, 2000);
}

function mediaDescriptor(mediaId, media, context = {}) {
  return {
    id: mediaId,
    lifeEventId: context.lifeEventId || "",
    journalLifeEventId: context.journalLifeEventId || "",
    title: cleanInline(media?.title || media?.fileName || "Photo", 180) || "Photo",
    caption: mediaCaption(media),
    contentType: cleanInline(media?.contentType || media?.mimeType, 120) || "application/octet-stream",
    createdAt: sourceOccurredAt(media),
    sourceSentAt: sourceSentAt(media),
    location: meaningfulLocation(media),
    projectId: sourceProjectId(media),
    associationTitle: cleanInline(context.associationTitle, 180),
  };
}

function journalDetail(lifeEventId, source, media = []) {
  const note = journalText(source);
  const shortcutShadow = source?.source === "ios_shortcuts" && Boolean(source?.shortcutEventId);
  return {
    lifeEventId,
    kind: "journal",
    shortcutShadow,
    shortcutEventId: shortcutShadow ? cleanInline(source.shortcutEventId, 180) : "",
    title: journalTitle(source, note),
    note,
    occurredAt: sourceOccurredAt(source),
    sourceSentAt: sourceSentAt(source),
    location: meaningfulLocation(source),
    projectId: sourceProjectId(source),
    dateId: cleanInline(source?.reportDateKey || source?.dateKey, 10),
    mediaIds: media.map((item) => item.id),
  };
}

function bearerToken(req) {
  const header = String(req.get ? req.get("authorization") : req.headers?.authorization || "");
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

async function authenticatedUid(req, auth) {
  const token = bearerToken(req);
  if (!token) throw new ActivityJournalError(401, "unauthenticated", "Sign in is required.");
  try {
    const decoded = await auth.verifyIdToken(token);
    if (!decoded?.uid) throw new Error("Missing uid.");
    return decoded.uid;
  } catch (_error) {
    throw new ActivityJournalError(401, "unauthenticated", "The sign-in session is not valid.");
  }
}

function assertAllowedProject(connection, projectId) {
  const allowed = Array.isArray(connection?.sourceProjectIds)
    ? connection.sourceProjectIds.map(String).filter(Boolean)
    : [];
  const firebaseAppId = /^1:\d+:(?:web|ios|android):/i.test(projectId);
  if (!projectId || firebaseAppId || !allowed.includes(projectId)) {
    throw new ActivityJournalError(403, "project_scope_denied", "This source project is not authorized.");
  }
}

async function authorizeLifeEvent({ timeDb, calendarId, lifeEventId, uid, cache = new Map() }) {
  const calendarKey = `calendar:${calendarId}`;
  let calendar = cache.get(calendarKey);
  if (!calendar) {
    const snapshot = await timeDb.collection("lifeCalendars").doc(calendarId).get();
    if (!snapshot.exists) throw new ActivityJournalError(404, "not_found", "Calendar not found.");
    calendar = snapshot.data() || {};
    if (calendar.ownerUid !== uid) throw new ActivityJournalError(403, "owner_required", "Calendar owner access is required.");
    cache.set(calendarKey, calendar);
  }

  const eventSnapshot = await timeDb.collection("lifeCalendars").doc(calendarId)
    .collection("lifeEvents").doc(lifeEventId).get();
  if (!eventSnapshot.exists) throw new ActivityJournalError(404, "not_found", "Life event not found.");
  const event = eventSnapshot.data() || {};
  if (event.calendarId !== calendarId || event.timeLeftUserId !== uid || event.sourceApp !== SOURCE_PROJECT_ID) {
    throw new ActivityJournalError(403, "event_scope_denied", "Life event ownership does not match.");
  }
  if (event.sourceFirebaseProjectId && event.sourceFirebaseProjectId !== SOURCE_PROJECT_ID) {
    throw new ActivityJournalError(403, "source_scope_denied", "Life event source does not match.");
  }

  const connectionId = safeId(event.connectionId);
  if (!connectionId) throw new ActivityJournalError(403, "connection_scope_denied", "Life event connection is not valid.");
  const connectionKey = `connection:${connectionId}`;
  let connection = cache.get(connectionKey);
  if (!connection) {
    const snapshot = await timeDb.collection("lifeCalendars").doc(calendarId)
      .collection("sourceConnections").doc(connectionId).get();
    if (!snapshot.exists) throw new ActivityJournalError(403, "connection_scope_denied", "Source connection not found.");
    connection = snapshot.data() || {};
    if (connection.sourceApp !== SOURCE_PROJECT_ID
      || (connection.sourceFirebaseProjectId && connection.sourceFirebaseProjectId !== SOURCE_PROJECT_ID)
      || (connection.timeLeftUserId && connection.timeLeftUserId !== uid)) {
      throw new ActivityJournalError(403, "connection_scope_denied", "Source connection ownership does not match.");
    }
    cache.set(connectionKey, connection);
  }
  assertAllowedProject(connection, cleanText(event.sourceProjectId, 180));
  return { event, connection };
}

function assertSourceProject(source, event, connection) {
  const actual = sourceProjectId(source);
  const expected = cleanText(event.sourceProjectId, 180);
  assertAllowedProject(connection, actual);
  if (actual !== expected) {
    throw new ActivityJournalError(403, "project_scope_denied", "Source record project does not match the Life event.");
  }
}

async function loadSourceRecord(sourceDb, event, connection) {
  const path = sourceDocumentPath(event);
  if (!path) throw new ActivityJournalError(404, "source_not_found", "The canonical source reference is not available.");
  const [collection, id] = path.split("/");
  const snapshot = await sourceDb.collection(collection).doc(id).get();
  if (!snapshot.exists) throw new ActivityJournalError(404, "source_not_found", "The source record is no longer available.");
  const source = snapshot.data() || {};
  assertSourceProject(source, event, connection);
  return { collection, id, source };
}

async function detailForEvent({ sourceDb, lifeEventId, event, connection }) {
  const record = await loadSourceRecord(sourceDb, event, connection);
  if (record.collection === "logEntries") {
    return {
      detail: journalDetail(lifeEventId, record.source),
      media: [],
      relation: {
        kind: "journal",
        projectId: sourceProjectId(record.source),
        sourceRecordId: record.id,
        linkedMediaPaths: [...new Set((Array.isArray(record.source.linkedMediaIds) ? record.source.linkedMediaIds : [])
          .map((value) => cleanText(value, 1024))
          .filter(Boolean))].slice(0, 20),
      },
    };
  }
  if (record.collection === "media") {
    return {
      detail: {
        lifeEventId,
        kind: "media",
        shortcutShadow: false,
        occurredAt: sourceOccurredAt(record.source),
        sourceSentAt: sourceSentAt(record.source),
        projectId: sourceProjectId(record.source),
        mediaIds: [record.id],
      },
      media: [mediaDescriptor(record.id, record.source, { lifeEventId })],
      relation: {
        kind: "media",
        projectId: sourceProjectId(record.source),
        sourceRecordId: record.id,
        linkedLogEntryId: cleanInline(record.source.linkedLogEntryId, 180),
        storagePath: cleanText(record.source.storagePath, 1024),
      },
    };
  }
  throw new ActivityJournalError(404, "source_not_found", "The source record type is not supported.");
}

function sendJson(res, status, body) {
  res.status(status).set("Cache-Control", "private, no-store").json(body);
}

function sendError(res, error) {
  const status = error instanceof ActivityJournalError ? error.status : 500;
  const code = error instanceof ActivityJournalError ? error.code : "server_error";
  sendJson(res, status, { ok: false, code, error: status >= 500 ? "Could not load activity details." : error.message });
}

function createJournalDetailsHandler({ timeDb, sourceDb, auth }) {
  return async (req, res) => {
    if (req.method !== "POST") {
      res.set("Allow", "POST");
      return sendJson(res, 405, { ok: false, code: "method_not_allowed", error: "Use POST." });
    }
    try {
      const uid = await authenticatedUid(req, auth);
      const calendarId = safeId(req.body?.calendarId);
      const lifeEventIds = [...new Set(Array.isArray(req.body?.lifeEventIds) ? req.body.lifeEventIds.map(safeId).filter(Boolean) : [])];
      if (!calendarId || !lifeEventIds.length || lifeEventIds.length > MAX_DETAIL_EVENTS) {
        throw new ActivityJournalError(400, "invalid_request", `Provide one to ${MAX_DETAIL_EVENTS} valid Life event IDs.`);
      }
      const cache = new Map();
      const details = [];
      const media = new Map();
      const unavailable = [];
      const loadDetail = async (lifeEventId) => {
        const { event, connection } = await authorizeLifeEvent({ timeDb, calendarId, lifeEventId, uid, cache });
        return { lifeEventId, ...(await detailForEvent({ sourceDb, lifeEventId, event, connection })) };
      };
      const loadSafely = async (lifeEventId) => {
        try {
          return await loadDetail(lifeEventId);
        } catch (error) {
          if (error instanceof ActivityJournalError && error.status === 404) {
            return { lifeEventId, unavailableCode: error.code };
          }
          throw error;
        }
      };
      // Resolve one item first so the owner calendar and common connection are
      // cached before the remaining exact source reads run concurrently.
      const results = [await loadSafely(lifeEventIds[0])];
      for (let index = 1; index < lifeEventIds.length; index += DETAIL_CONCURRENCY) {
        const chunk = lifeEventIds.slice(index, index + DETAIL_CONCURRENCY);
        const settled = await Promise.all(chunk.map(loadSafely));
        results.push(...settled);
      }
      // Correlate only source records that were individually authorized through
      // canonical Life events. This avoids collection queries in GridlineAI and
      // keeps the cross-project Firestore grant limited to exact document reads.
      const availableResults = results.filter((result) => !result.unavailableCode);
      const journalResults = availableResults.filter((result) => result.relation?.kind === "journal");
      const mediaResults = availableResults.filter((result) => result.relation?.kind === "media");
      for (const mediaResult of mediaResults) {
        const mediaRelation = mediaResult.relation;
        const journalResult = journalResults.find((candidate) => {
          const journalRelation = candidate.relation;
          if (journalRelation.projectId !== mediaRelation.projectId) return false;
          return mediaRelation.linkedLogEntryId === journalRelation.sourceRecordId
            || (mediaRelation.storagePath && journalRelation.linkedMediaPaths.includes(mediaRelation.storagePath));
        });
        if (!journalResult) continue;
        journalResult.detail.mediaIds = [...new Set([
          ...journalResult.detail.mediaIds,
          mediaRelation.sourceRecordId,
        ])];
        mediaResult.media = mediaResult.media.map((item) => ({
          ...item,
          journalLifeEventId: journalResult.lifeEventId,
          associationTitle: journalResult.detail.title,
        }));
      }
      for (const result of results) {
        if (result.unavailableCode) {
          unavailable.push({ lifeEventId: result.lifeEventId, code: result.unavailableCode });
          continue;
        }
        details.push(result.detail);
        result.media.forEach((item) => {
          const existing = media.get(item.id) || {};
          media.set(item.id, {
            ...existing,
            ...item,
            journalLifeEventId: item.journalLifeEventId || existing.journalLifeEventId || "",
            lifeEventId: item.lifeEventId || existing.lifeEventId || "",
            associationTitle: item.associationTitle || existing.associationTitle || "",
          });
        });
      }
      return sendJson(res, 200, { ok: true, details, media: [...media.values()], unavailable });
    } catch (error) {
      return sendError(res, error);
    }
  };
}

async function authorizedMedia({ timeDb, sourceDb, calendarId, lifeEventId, mediaId, uid }) {
  const { event, connection } = await authorizeLifeEvent({ timeDb, calendarId, lifeEventId, uid });
  const record = await loadSourceRecord(sourceDb, event, connection);
  const mediaSnapshot = await sourceDb.collection("media").doc(mediaId).get();
  if (!mediaSnapshot.exists) throw new ActivityJournalError(404, "media_not_found", "Photo not found.");
  const media = mediaSnapshot.data() || {};
  assertSourceProject(media, event, connection);
  if (record.collection === "media") {
    if (record.id !== mediaId) throw new ActivityJournalError(403, "media_scope_denied", "Photo is not attached to this Life event.");
  } else {
    const linkedPaths = Array.isArray(record.source.linkedMediaIds) ? record.source.linkedMediaIds.map(String) : [];
    const related = media.linkedLogEntryId === record.id
      || (media.storagePath && linkedPaths.includes(String(media.storagePath)));
    if (!related) throw new ActivityJournalError(403, "media_scope_denied", "Photo is not attached to this journal entry.");
  }
  const storagePath = cleanText(media.storagePath, 1024);
  const projectId = sourceProjectId(media);
  if (!storagePath || storagePath.includes("..") || !storagePath.startsWith(`projects/${projectId}/media/`)) {
    throw new ActivityJournalError(403, "media_scope_denied", "Photo Storage path is not valid.");
  }
  return { media, storagePath };
}

function createActivityMediaHandler({ timeDb, sourceDb, sourceBucket, auth }) {
  return async (req, res) => {
    if (req.method !== "GET") {
      res.set("Allow", "GET");
      return res.status(405).send("Method Not Allowed");
    }
    try {
      const uid = await authenticatedUid(req, auth);
      const calendarId = safeId(req.query?.calendarId);
      const lifeEventId = safeId(req.query?.lifeEventId);
      const mediaId = safeId(req.query?.mediaId);
      if (!calendarId || !lifeEventId || !mediaId) throw new ActivityJournalError(400, "invalid_request", "Photo reference is incomplete.");
      const { media, storagePath } = await authorizedMedia({ timeDb, sourceDb, calendarId, lifeEventId, mediaId, uid });
      const file = sourceBucket.file(storagePath);
      const [exists] = await file.exists();
      if (!exists) throw new ActivityJournalError(404, "media_not_found", "Photo file is unavailable.");
      const [fileMetadata] = await file.getMetadata();
      const contentType = cleanInline(fileMetadata?.contentType || media.contentType || media.mimeType, 120);
      if (!contentType.startsWith("image/")) throw new ActivityJournalError(415, "unsupported_media", "This attachment is not an image.");
      const byteSize = Number(fileMetadata?.size);
      if (Number.isFinite(byteSize) && byteSize > 20 * 1024 * 1024) {
        throw new ActivityJournalError(413, "media_too_large", "This photo is too large to preview.");
      }
      const [buffer] = await file.download();
      const fileName = cleanInline(media.fileName || storagePath.split("/").pop(), 180).replace(/["\\]/g, "") || "photo";
      return res.status(200)
        .set("Cache-Control", "private, no-store")
        .set("Content-Type", contentType)
        .set("Content-Disposition", `inline; filename="${fileName}"`)
        .set("X-Content-Type-Options", "nosniff")
        .send(buffer);
    } catch (error) {
      const status = error instanceof ActivityJournalError ? error.status : 500;
      return res.status(status).set("Cache-Control", "private, no-store").type("text/plain")
        .send(status >= 500 ? "Could not load photo." : error.message);
    }
  };
}

module.exports = {
  ActivityJournalError,
  authorizeLifeEvent,
  createActivityMediaHandler,
  createJournalDetailsHandler,
  journalDetail,
  journalText,
  journalTitle,
  mediaDescriptor,
  sourceDocumentPath,
  sourceOccurredAt,
};
