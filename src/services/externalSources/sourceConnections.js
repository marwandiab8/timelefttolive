import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc
} from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { db } from '../firebase.js';

export function useSourceConnections(calendarId) {
  const [connections, setConnections] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!calendarId) return undefined;
    return onSnapshot(query(collection(db, 'lifeCalendars', calendarId, 'sourceConnections')), (snapshot) => {
      setError('');
      setConnections(snapshot.docs.map((connectionDoc) => ({ id: connectionDoc.id, ...connectionDoc.data() })));
    }, (err) => setError(err.message));
  }, [calendarId]);

  return { connections, error };
}

export function createSourceConnection(calendarId, payload, uid) {
  return addDoc(collection(db, 'lifeCalendars', calendarId, 'sourceConnections'), {
    sourceApp: payload.sourceApp,
    sourceFirebaseProjectId: payload.sourceFirebaseProjectId || '',
    sourceOwnerUid: payload.sourceOwnerUid || '',
    sourceUserEmail: payload.sourceUserEmail || '',
    sourceProjectIds: payload.sourceProjectIds ? payload.sourceProjectIds.split(',').map((item) => item.trim()).filter(Boolean) : [],
    status: payload.status || 'active',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdByUid: uid,
    lastSyncedAt: null
  });
}

export function updateSourceConnectionStatus(calendarId, connectionId, status) {
  return updateDoc(doc(db, 'lifeCalendars', calendarId, 'sourceConnections', connectionId), {
    status,
    updatedAt: serverTimestamp()
  });
}

export function deleteSourceConnection(calendarId, connectionId) {
  return deleteDoc(doc(db, 'lifeCalendars', calendarId, 'sourceConnections', connectionId));
}
