// Deleted activities wait in lifeCalendars/{id}/lifeEventRecycleBin for 90 days (functions/src/activityEntries.js
// writes a copy on delete); this lists them for the "Recently deleted" panel, newest first.
import { collection, getDocs, limit, orderBy, query } from 'firebase/firestore';
import { db } from './firebase.js';

export async function listRecentlyDeleted(calendarId, max = 20) {
  if (!db || !calendarId) return [];
  const snapshot = await getDocs(query(collection(db, 'lifeCalendars', calendarId, 'lifeEventRecycleBin'), orderBy('recycledAt', 'desc'), limit(max)));
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}
