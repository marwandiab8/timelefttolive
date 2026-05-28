import { useEffect, useMemo, useState } from 'react';
import {
  addDoc,
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where
} from 'firebase/firestore';
import { db } from '../services/firebase.js';
import { addYears, formatDateId } from '../utils/dateUtils.js';

const defaultSettings = {
  pastColor: '#46505c',
  currentWeekColor: '#f4c542',
  futureColor: '#17222c',
  weekendColor: '#65d6ad',
  defaultEventColor: '#7c9cff'
};

export function normalizeCalendarPayload(payload, uid) {
  const birthDate = payload.birthDate;
  const targetAge = Number(payload.targetAge || 80);
  return {
    ownerUid: uid,
    firstName: payload.firstName.trim(),
    lastName: payload.lastName.trim(),
    birthDate,
    targetAge,
    targetEndDate: formatDateId(addYears(birthDate, targetAge)),
    spouse: {
      name: payload.spouse?.name?.trim() || '',
      birthDate: payload.spouse?.birthDate || ''
    },
    children: (payload.children || [])
      .filter((child) => child.name?.trim() || child.birthDate)
      .map((child) => ({
        id: child.id || crypto.randomUUID(),
        name: child.name.trim(),
        birthDate: child.birthDate
      })),
    settings: { ...defaultSettings, ...(payload.settings || {}) },
    updatedAt: serverTimestamp()
  };
}

export function useOwnedCalendar(uid) {
  const [calendar, setCalendar] = useState(null);
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState('owner');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!uid) return undefined;
    const ownedQuery = query(collection(db, 'lifeCalendars'), where('ownerUid', '==', uid), limit(1));

    return onSnapshot(ownedQuery, (snapshot) => {
      setError('');
      if (!snapshot.empty) {
        const item = snapshot.docs[0];
        setCalendar({ id: item.id, ...item.data() });
        setRole('owner');
        setLoading(false);
        return;
      }

      setCalendar(null);
      setLoading(false);
    }, (err) => {
      setError(err.message);
      setLoading(false);
    });
  }, [uid]);

  return { calendar, loading, role, error };
}

export function useViewerInvites(user, enabled = true) {
  const [invites, setInvites] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!enabled || !user?.email) {
      setInvites([]);
      setError('');
      return undefined;
    }
    const inviteQuery = query(collectionGroup(db, 'viewers'), where('email', '==', user.email.toLowerCase()), limit(10));
    return onSnapshot(
      inviteQuery,
      (snapshot) => {
        setError('');
        setInvites(snapshot.docs.map((inviteDoc) => ({
          id: inviteDoc.id,
          calendarId: inviteDoc.ref.parent.parent.id,
          ...inviteDoc.data()
        })));
      },
      (err) => setError(err.message)
    );
  }, [enabled, user?.email]);

  return { invites, error };
}

export function useSharedCalendar(calendarId, enabled) {
  const [calendar, setCalendar] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!calendarId || !enabled) return undefined;
    return onSnapshot(doc(db, 'lifeCalendars', calendarId), (snapshot) => {
      setError('');
      setCalendar(snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null);
    }, (err) => setError(err.message));
  }, [calendarId, enabled]);

  return { calendar, error };
}

export function useEvents(calendarId, role) {
  const [events, setEvents] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!calendarId) return undefined;
    const eventsRef = collection(db, 'lifeCalendars', calendarId, 'events');
    const eventsQuery = role === 'owner'
      ? query(eventsRef, orderBy('startDate', 'asc'))
      : query(eventsRef, where('visibility', '==', 'viewers'), orderBy('startDate', 'asc'));
    return onSnapshot(eventsQuery, (snapshot) => {
      setError('');
      setEvents(snapshot.docs.map((eventDoc) => ({ id: eventDoc.id, ...eventDoc.data() })));
    }, (err) => setError(err.message));
  }, [calendarId, role]);

  return { events, error };
}

export function useViewers(calendarId) {
  const [viewers, setViewers] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!calendarId) return undefined;
    return onSnapshot(collection(db, 'lifeCalendars', calendarId, 'viewers'), (snapshot) => {
      setError('');
      setViewers(snapshot.docs.map((viewerDoc) => ({ id: viewerDoc.id, ...viewerDoc.data() })));
    }, (err) => setError(err.message));
  }, [calendarId]);

  return { viewers, error };
}

export function useWeekEntries(calendarId, dateIds, role) {
  const [entries, setEntries] = useState({});
  const [error, setError] = useState('');
  const key = useMemo(() => dateIds.join('|'), [dateIds]);

  useEffect(() => {
    if (!calendarId || dateIds.length === 0) return undefined;
    if (role !== 'owner') {
      const entriesQuery = query(
        collection(db, 'lifeCalendars', calendarId, 'dailyEntries'),
        where('dateId', 'in', dateIds),
        where('visibility', '==', 'viewers')
      );
      return onSnapshot(entriesQuery, (snapshot) => {
        setError('');
        const nextEntries = {};
        dateIds.forEach((dateId) => {
          nextEntries[dateId] = null;
        });
        snapshot.docs.forEach((entryDoc) => {
          nextEntries[entryDoc.id] = { id: entryDoc.id, ...entryDoc.data() };
        });
        setEntries(nextEntries);
      }, (err) => setError(err.message));
    }

    const unsubscribers = dateIds.map((dateId) => onSnapshot(
      doc(db, 'lifeCalendars', calendarId, 'dailyEntries', dateId),
      (entryDoc) => {
        setError('');
        const entry = entryDoc.exists() ? { id: entryDoc.id, ...entryDoc.data() } : null;
        setEntries((current) => ({
          ...current,
          [dateId]: entry && (role === 'owner' || entry.visibility === 'viewers') ? entry : null
        }));
      },
      (err) => setError(err.message)
    ));
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [calendarId, key, role]);

  return { entries, error };
}

export function useWeekAttachments(calendarId, dateIds, role) {
  const [attachments, setAttachments] = useState({});
  const [error, setError] = useState('');
  const key = useMemo(() => dateIds.join('|'), [dateIds]);

  useEffect(() => {
    if (!calendarId || dateIds.length === 0) return undefined;
    const unsubscribers = dateIds.map((dateId) => {
      const attachmentsRef = collection(db, 'lifeCalendars', calendarId, 'dailyEntries', dateId, 'attachments');
      const attachmentsQuery = role === 'owner' ? attachmentsRef : query(attachmentsRef, where('visibility', '==', 'viewers'));
      return onSnapshot(
        attachmentsQuery,
        (snapshot) => {
          setError('');
          setAttachments((current) => ({
            ...current,
            [dateId]: snapshot.docs
              .map((attachmentDoc) => ({ id: attachmentDoc.id, ...attachmentDoc.data() }))
          }));
        },
        (err) => setError(err.message)
      );
    });
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [calendarId, key, role]);

  return { attachments, error };
}

export async function saveCalendar(uid, existingId, payload) {
  const data = normalizeCalendarPayload(payload, uid);
  if (existingId) {
    await updateDoc(doc(db, 'lifeCalendars', existingId), data);
    return existingId;
  }
  const created = await addDoc(collection(db, 'lifeCalendars'), {
    ...data,
    createdAt: serverTimestamp()
  });
  return created.id;
}

export function saveEvent(calendarId, eventId, payload) {
  const data = {
    title: payload.title.trim(),
    description: payload.description || '',
    startDate: payload.startDate,
    endDate: payload.endDate,
    color: payload.color,
    relatedPeopleIds: payload.relatedPeopleIds || [],
    visibility: payload.visibility || 'viewers',
    updatedAt: serverTimestamp()
  };
  if (eventId) return updateDoc(doc(db, 'lifeCalendars', calendarId, 'events', eventId), data);
  return addDoc(collection(db, 'lifeCalendars', calendarId, 'events'), { ...data, createdAt: serverTimestamp() });
}

export function deleteEvent(calendarId, eventId) {
  return deleteDoc(doc(db, 'lifeCalendars', calendarId, 'events', eventId));
}

export function saveDailyEntry(calendarId, dateId, payload) {
  return setDoc(doc(db, 'lifeCalendars', calendarId, 'dailyEntries', dateId), {
    dateId,
    date: dateId,
    journalText: payload.journalText || '',
    tags: payload.tags || [],
    visibility: payload.visibility || 'viewers',
    updatedAt: serverTimestamp(),
    createdAt: serverTimestamp()
  }, { merge: true });
}

export function inviteViewer(calendarId, email) {
  const viewerId = email.trim().toLowerCase();
  return setDoc(doc(db, 'lifeCalendars', calendarId, 'viewers', viewerId), {
    uid: '',
    email: email.trim().toLowerCase(),
    role: 'viewer',
    invitedAt: serverTimestamp(),
    acceptedAt: null,
    status: 'pending'
  }, { merge: true });
}

export function acceptViewerInvite(calendarId, viewerDocId, uid) {
  return updateDoc(doc(db, 'lifeCalendars', calendarId, 'viewers', viewerDocId), {
    uid,
    status: 'accepted',
    acceptedAt: serverTimestamp()
  });
}

export { defaultSettings };
