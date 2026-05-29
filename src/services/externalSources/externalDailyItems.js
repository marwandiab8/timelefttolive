import {
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDoc,
  increment,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where
} from 'firebase/firestore';
import { useEffect, useMemo, useState } from 'react';
import { db } from '../firebase.js';
import { normalizeExternalDailyItem, stableExternalItemId } from './sourceMappers.js';

export function externalItemDocRef(calendarId, dateId, externalItemId) {
  return doc(db, 'lifeCalendars', calendarId, 'dailyEntries', dateId, 'externalItems', externalItemId);
}

function summaryIncrementFor(item, amount) {
  const updates = {
    'externalSummary.totalCount': increment(amount),
    'externalSummary.lastSyncedAt': serverTimestamp()
  };
  if (['constructionReport', 'projectReport', 'journal'].includes(item.category)) updates['externalSummary.reportCount'] = increment(amount);
  if (['projectPicture', 'image'].includes(item.category)) updates['externalSummary.pictureCount'] = increment(amount);
  if (item.category === 'workout') updates['externalSummary.workoutCount'] = increment(amount);
  if (item.category === 'progressRecord') updates['externalSummary.progressCount'] = increment(amount);
  if (item.category === 'dartsRecord') updates['externalSummary.dartsCount'] = increment(amount);
  updates[`externalSummary.sourceApps.${item.sourceApp}`] = increment(amount);
  return updates;
}

export async function upsertExternalDailyItem(input, uid = '') {
  const item = normalizeExternalDailyItem({ ...input, createdByUid: uid, updatedByUid: uid });
  if (!item.calendarId || item.needsDateReview) {
    throw new Error('External item needs a valid calendarId and dateId before it can be linked to a day.');
  }
  const externalItemId = stableExternalItemId(item.dedupeKey);
  const itemRef = externalItemDocRef(item.calendarId, item.dateId, externalItemId);
  const existing = await getDoc(itemRef);
  const entryRef = doc(db, 'lifeCalendars', item.calendarId, 'dailyEntries', item.dateId);
  await setDoc(entryRef, {
    dateId: item.dateId,
    date: item.dateId,
    visibility: 'ownerOnly',
    updatedAt: serverTimestamp(),
    ...(existing.exists() ? { 'externalSummary.lastSyncedAt': serverTimestamp() } : summaryIncrementFor(item, 1))
  }, { merge: true });
  await setDoc(itemRef, {
    ...item,
    linkedAt: serverTimestamp(),
    syncedAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }, { merge: true });
  return externalItemId;
}

export function useDayExternalItems(calendarId, dateId, role) {
  const externalQuery = useMemo(() => {
    if (!calendarId || !dateId) return null;
    const itemsRef = collection(db, 'lifeCalendars', calendarId, 'dailyEntries', dateId, 'externalItems');
    return role === 'owner' ? query(itemsRef) : query(itemsRef, where('visibility', '==', 'viewers'));
  }, [calendarId, dateId, role]);
  return useExternalItemsQuery(externalQuery);
}

export function useRangeExternalItems(calendarId, startDateId, endDateId, role, ownerUid = '') {
  const externalQuery = useMemo(() => {
    if (!calendarId || !startDateId || !endDateId) return null;
    const itemsRef = collectionGroup(db, 'externalItems');
    const constraints = [
      where('calendarId', '==', calendarId),
      where('dateId', '>=', startDateId),
      where('dateId', '<=', endDateId),
      orderBy('dateId', 'asc')
    ];
    if (role === 'owner' && ownerUid) constraints.unshift(where('ownerUid', '==', ownerUid));
    if (role !== 'owner') constraints.push(where('visibility', '==', 'viewers'));
    return query(itemsRef, ...constraints);
  }, [calendarId, startDateId, endDateId, role, ownerUid]);
  return useExternalItemsQuery(externalQuery);
}

function useExternalItemsQuery(externalQuery) {
  const [items, setItems] = useState([]);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!externalQuery) {
      setItems([]);
      setError('');
      return undefined;
    }
    return onSnapshot(externalQuery, (snapshot) => {
      setError('');
      setItems(snapshot.docs.map((itemDoc) => ({ id: itemDoc.id, ...itemDoc.data() })));
    }, (err) => setError(err.message));
  }, [externalQuery]);
  return { items, error };
}

export function updateExternalItemVisibility(calendarId, dateId, externalItemId, visibility, uid = '') {
  return updateDoc(externalItemDocRef(calendarId, dateId, externalItemId), {
    visibility,
    updatedByUid: uid,
    updatedAt: serverTimestamp()
  });
}

export function moveExternalItemDate(calendarId, currentDateId, externalItem, nextDateId, uid = '') {
  const nextId = externalItem.id;
  const nextRef = externalItemDocRef(calendarId, nextDateId, nextId);
  return Promise.all([
    setDoc(nextRef, {
      ...externalItem,
      dateId: nextDateId,
      updatedByUid: uid,
      updatedAt: serverTimestamp()
    }, { merge: true }),
    deleteDoc(externalItemDocRef(calendarId, currentDateId, nextId))
  ]);
}

export function unlinkExternalItem(calendarId, dateId, externalItemId) {
  return deleteDoc(externalItemDocRef(calendarId, dateId, externalItemId));
}
