const assert = require("node:assert/strict");
const test = require("node:test");
const { buildDedupeKey, externalItemIdForDedupeKey } = require("./dedupe");
const { dateLikeToDateId, isValidDateId, resolveDateId } = require("./dateId");
const { normalizeCategory, normalizeExternalItem, normalizeSourceApp } = require("./normalize");
const { generateToken, tokenHash } = require("./tokens");

test("validates dateId without timezone shifting explicit date strings", () => {
  assert.equal(isValidDateId("2028-07-25"), true);
  assert.equal(isValidDateId("2028-02-31"), false);
  assert.equal(dateLikeToDateId("2028-07-25"), "2028-07-25");
  assert.equal(dateLikeToDateId("2028-07-25T23:30:00.000Z"), "2028-07-25");
});

test("resolves dates by ingestion priority", () => {
  const result = resolveDateId({
    createdAt: "2028-07-26T00:00:00.000Z",
    dateKey: "2028-07-25"
  });
  assert.equal(result.dateId, "2028-07-25");
  assert.equal(result.sourceField, "dateKey");
});

test("normalizes unknown category as other with originalCategory metadata", () => {
  const result = normalizeCategory("weirdThing", { a: 1 });
  assert.equal(result.category, "other");
  assert.equal(result.metadata.originalCategory, "weirdThing");
  assert.equal(result.metadata.a, 1);
});

test("validates source app values", () => {
  assert.equal(normalizeSourceApp("aigridline"), "aigridline");
  assert.equal(normalizeSourceApp("unknown"), "");
});

test("builds stable sha256 external item ids", () => {
  const key = buildDedupeKey({
    sourceApp: "aigridline",
    sourceFirebaseProjectId: "aigridline",
    sourceDocumentPath: "dailyReports/r1",
    sourceStoragePath: "media/p.jpg"
  });
  assert.equal(key, "aigridline:aigridline:dailyReports/r1:media/p.jpg");
  assert.equal(externalItemIdForDedupeKey(key), externalItemIdForDedupeKey(key));
  assert.equal(externalItemIdForDedupeKey(key).length, 64);
});

test("normalizes canonical external item", () => {
  const item = normalizeExternalItem({
    sourceApp: "GYM-K2",
    category: "workout",
    workoutDate: "2028-07-25",
    title: "Push day",
    sourceDocumentPath: "workouts/w1"
  }, {
    calendarId: "cal1",
    connectionId: "conn1",
    ownerUid: "owner1"
  });
  assert.equal(item.calendarId, "cal1");
  assert.equal(item.dateId, "2028-07-25");
  assert.equal(item.sourceApp, "GYM-K2");
  assert.equal(item.category, "workout");
  assert.equal(item.needsDateReview, false);
});

test("token generation hashes without exposing raw token", () => {
  const token = generateToken();
  assert.match(token, /^tltl_ingest_v1_/);
  assert.notEqual(tokenHash(token), token);
  assert.equal(tokenHash(token), tokenHash(token));
});
