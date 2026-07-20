const { FieldValue } = require("firebase-admin/firestore");
const { normalizeExternalItem } = require("./normalize");

function cleanUndefined(value) {
  if (Array.isArray(value)) return value.map(cleanUndefined);
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.fromEntries(Object.entries(value)
      .filter(([, child]) => child !== undefined)
      .map(([key, child]) => [key, cleanUndefined(child)]));
  }
  return value;
}

function isReport(item) {
  return ["constructionReport", "projectReport", "journal"].includes(item.category);
}

function isPicture(item) {
  return ["image", "projectPicture"].includes(item.category) || String(item.contentType || "").startsWith("image/");
}

function emptySummary() {
  return {
    totalCount: 0,
    reportCount: 0,
    pictureCount: 0,
    workoutCount: 0,
    progressCount: 0,
    dartsCount: 0,
    otherCount: 0,
    sourceApps: {
      "GYM-K2": 0,
      gridlineai: 0,
      aigridline: 0,
      MyDoubleProgress: 0,
      DartstRacker2026: 0
    },
    lastSyncedAt: FieldValue.serverTimestamp()
  };
}

async function recomputeDailyExternalSummary(db, calendarId, dateId) {
  const entryRef = db.collection("lifeCalendars").doc(calendarId).collection("dailyEntries").doc(dateId);
  const externalSnap = await entryRef.collection("externalItems").get();
  const summary = emptySummary();
  externalSnap.docs.forEach((docSnap) => {
    const item = docSnap.data();
    if (item.syncStatus && item.syncStatus !== "active") return;
    summary.totalCount += 1;
    if (isReport(item)) summary.reportCount += 1;
    else if (isPicture(item)) summary.pictureCount += 1;
    else if (item.category === "workout") summary.workoutCount += 1;
    else if (item.category === "progressRecord") summary.progressCount += 1;
    else if (item.category === "dartsRecord") summary.dartsCount += 1;
    else summary.otherCount += 1;
    if (Object.hasOwn(summary.sourceApps, item.sourceApp)) {
      summary.sourceApps[item.sourceApp] += 1;
    }
  });
  await entryRef.set({
    dateId,
    date: dateId,
    updatedAt: FieldValue.serverTimestamp(),
    externalSummary: summary
  }, { merge: true });
  return summary;
}

async function writeNeedsDateReview(db, rawItem, context, reason = "missingDate") {
  const item = normalizeExternalItem(rawItem, context);
  const reviewId = item.externalItemId;
  const reviewRef = db.collection("lifeCalendars").doc(context.calendarId).collection("externalNeedsDateReview").doc(reviewId);
  await reviewRef.set(cleanUndefined({
    ...item,
    reason,
    calendarId: context.calendarId,
    connectionId: context.connectionId,
    ownerUid: context.ownerUid,
    linkedAt: FieldValue.serverTimestamp(),
    syncedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  }), { merge: true });
  return { status: "needsDateReview", externalItemId: reviewId, reason };
}

async function upsertExternalItem(db, rawItem, context) {
  const item = normalizeExternalItem(rawItem, context);
  if (item.needsDateReview) {
    return writeNeedsDateReview(db, rawItem, context, "missingDate");
  }
  const calendarRef = db.collection("lifeCalendars").doc(context.calendarId);
  const entryRef = calendarRef.collection("dailyEntries").doc(item.dateId);
  const itemRef = entryRef.collection("externalItems").doc(item.externalItemId);
  const indexRef = calendarRef.collection("externalIndex").doc(item.externalItemId);
  let resultStatus = "created";
  let previousDateId = "";

  await db.runTransaction(async (transaction) => {
    const indexSnap = await transaction.get(indexRef);
    previousDateId = indexSnap.exists ? indexSnap.data().dateId : "";
    const existingRef = previousDateId
      ? calendarRef.collection("dailyEntries").doc(previousDateId).collection("externalItems").doc(item.externalItemId)
      : itemRef;
    const existingSnap = await transaction.get(existingRef);
    resultStatus = existingSnap.exists ? "updated" : "created";
    if (previousDateId && previousDateId !== item.dateId) {
      transaction.delete(existingRef);
      resultStatus = "moved";
    }
    transaction.set(entryRef, {
      dateId: item.dateId,
      date: item.dateId,
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    transaction.set(itemRef, cleanUndefined({
      ...item,
      calendarId: context.calendarId,
      ownerUid: context.ownerUid,
      connectionId: context.connectionId,
      linkedAt: existingSnap.exists ? existingSnap.data().linkedAt || FieldValue.serverTimestamp() : FieldValue.serverTimestamp(),
      syncedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    }), { merge: true });
    transaction.set(indexRef, cleanUndefined({
      externalItemId: item.externalItemId,
      dedupeKey: item.dedupeKey,
      dateId: item.dateId,
      externalItemPath: itemRef.path,
      sourceApp: item.sourceApp,
      category: item.category,
      sourceDocumentPath: item.sourceDocumentPath,
      sourceStoragePath: item.sourceStoragePath,
      updatedAt: FieldValue.serverTimestamp()
    }), { merge: true });
    transaction.set(context.connectionRef, {
      lastIngestedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
  });

  await recomputeDailyExternalSummary(db, context.calendarId, item.dateId);
  if (previousDateId && previousDateId !== item.dateId) {
    await recomputeDailyExternalSummary(db, context.calendarId, previousDateId);
  }
  return {
    status: resultStatus,
    externalItemId: item.externalItemId,
    dateId: item.dateId
  };
}

module.exports = {
  recomputeDailyExternalSummary,
  upsertExternalItem,
  writeNeedsDateReview
};
