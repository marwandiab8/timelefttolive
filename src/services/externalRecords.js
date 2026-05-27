import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase.js';

export function createExternalRecordLink(calendarId, dateId, record) {
  return addDoc(collection(db, 'lifeCalendars', calendarId, 'dailyEntries', dateId, 'attachments'), {
    type: 'externalFirebaseRecord',
    title: record.title || 'External record',
    description: record.description || '',
    url: record.url || record.path || '',
    storagePath: '',
    sourceProjectId: record.sourceProjectId || '',
    sourceCollection: record.sourceCollection || '',
    sourceDocumentId: record.sourceDocumentId || '',
    visibility: record.visibility || 'ownerOnly',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
}
