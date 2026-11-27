import { useEffect, useMemo, useState } from 'react';
import { eventDocument } from '../utils/calendarEvents.js';
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
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where
} from 'firebase/firestore';
import { db } from '../services/firebase.js';
import { addYears, formatDateId } from '../utils/dateUtils.js';
import { normalizeChild } from '../utils/childInfo.js';
import { defaultCustodySchedule } from '../utils/custodyUtils.js';
import { loadActivityJournalDetails } from '../services/activityJournal.js';

const defaultSettings = {
  pastColor: '#46505c',
  currentWeekColor: '#f4c542',
  futureColor: '#17222c',
  defaultEventColor: '#7c9cff'
};

export function normalizeCalendarPayload(payload, uid) {
  const birthDate = payload.birthDate;
  const targetAge = Number(payload.targetAge || 80);
  const children = (payload.children || [])
    .filter((child) => child.name?.trim() || child.birthDate)
    .map((child) => normalizeChild(child));
  const custodySchedule = {
    ...defaultCustodySchedule,
    ...(payload.custodySchedule || {}),
    cycleWeeks: Number(payload.custodySchedule?.cycleWeeks || defaultCustodySchedule.cycleWeeks),
    withParentWeeks: Number(payload.custodySchedule?.withParentWeeks || defaultCustodySchedule.withParentWeeks),
    countUntilChildAge: Number(payload.custodySchedule?.countUntilChildAge || defaultCustodySchedule.countUntilChildAge),
    childIds: (payload.custodySchedule?.childIds || []).filter((id) => children.some((child) => child.id === id))
  };

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
    children,
    custodySchedule,
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

export function useLifeEvents(calendarId, startDate, endDate, enabled = true) {
  const [lifeEvents, setLifeEvents] = useState([]);
  const [loading, setLoading] = useState(Boolean(calendarId && enabled));
  const [error, setError] = useState('');
  const startTime = startDate?.getTime();
  const endTime = endDate?.getTime();

  useEffect(() => {
    if (!calendarId || !enabled || !Number.isFinite(startTime) || !Number.isFinite(endTime)) {
      setLifeEvents([]);
      setLoading(false);
      setError('');
      return undefined;
    }

    setLoading(true);
    setError('');
    const lifeEventsQuery = query(
      collection(db, 'lifeCalendars', calendarId, 'lifeEvents'),
      where('occurredAt', '>=', Timestamp.fromMillis(startTime)),
      where('occurredAt', '<', Timestamp.fromMillis(endTime)),
      orderBy('occurredAt', 'asc')
    );

    return onSnapshot(lifeEventsQuery, (snapshot) => {
      setLifeEvents(snapshot.docs.map((eventDoc) => ({ id: eventDoc.id, ...eventDoc.data() })));
      setLoading(false);
      setError('');
    }, (err) => {
      setLifeEvents([]);
      setLoading(false);
      setError(err.message);
    });
  }, [calendarId, enabled, startTime, endTime]);

  return { lifeEvents, loading, error };
}

export function useAllLifeEvents(calendarId, enabled = true) {
  const [lifeEvents, setLifeEvents] = useState([]);
  const [loading, setLoading] = useState(Boolean(calendarId && enabled));
  const [error, setError] = useState('');

  useEffect(() => {
    if (!calendarId || !enabled) {
      setLifeEvents([]);
      setLoading(false);
      setError('');
      return undefined;
    }

    setLoading(true);
    setError('');
    const lifeEventsQuery = query(
      collection(db, 'lifeCalendars', calendarId, 'lifeEvents'),
      orderBy('occurredAt', 'asc')
    );

    return onSnapshot(lifeEventsQuery, (snapshot) => {
      setLifeEvents(snapshot.docs.map((eventDoc) => ({ id: eventDoc.id, ...eventDoc.data() })));
      setLoading(false);
      setError('');
    }, (err) => {
      setLifeEvents([]);
      setLoading(false);
      setError(err.message);
    });
  }, [calendarId, enabled]);

  return { lifeEvents, loading, error };
}

export function useConnectedSources(calendarId, enabled = true) {
  const [connections, setConnections] = useState([]);
  const [loading, setLoading] = useState(Boolean(calendarId && enabled));
  const [error, setError] = useState('');

  useEffect(() => {
    if (!calendarId || !enabled) {
      setConnections([]);
      setLoading(false);
      setError('');
      return undefined;
    }

    setLoading(true);
    setError('');
    return onSnapshot(collection(db, 'lifeCalendars', calendarId, 'sourceConnections'), (snapshot) => {
      setConnections(snapshot.docs.map((connectionDoc) => ({ id: connectionDoc.id, ...connectionDoc.data() })));
      setLoading(false);
      setError('');
    }, (err) => {
      setConnections([]);
      setLoading(false);
      setError(err.message);
    });
  }, [calendarId, enabled]);

  return { connections, loading, error };
}

export function useActivityJournalDetails(calendarId, lifeEvents, enabled = true) {
  const [details, setDetails] = useState([]);
  const [media, setMedia] = useState([]);
  const [unavailable, setUnavailable] = useState([]);
  const [partial, setPartial] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const eventKey = useMemo(() => (Array.isArray(lifeEvents) ? lifeEvents : [])
    .map((event) => event.id)
    .filter(Boolean)
    .sort()
    .join('|'), [lifeEvents]);

  useEffect(() => {
    if (!calendarId || !enabled) {
      setDetails([]);
      setMedia([]);
      setUnavailable([]);
      setPartial(false);
      setLoading(false);
      setError('');
      return undefined;
    }
    const controller = new AbortController();
    setLoading(true);
    setError('');
    loadActivityJournalDetails(calendarId, lifeEvents, controller.signal)
      .then((result) => {
        setDetails(result.details);
        setMedia(result.media);
        setUnavailable(result.unavailable);
        setPartial(result.partial);
        setLoading(false);
      })
      .catch((err) => {
        if (err.name === 'AbortError') return;
        setDetails([]);
        setMedia([]);
        setUnavailable([]);
        setPartial(false);
        setError(err.message);
        setLoading(false);
      });
    return () => controller.abort();
  }, [calendarId, enabled, eventKey]);

  return { details, media, unavailable, partial, loading, error };
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

export function useRangeEntries(calendarId, startDateId, endDateId, role) {
  const [entries, setEntries] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!calendarId || !startDateId || !endDateId) {
      setEntries([]);
      setError('');
      return undefined;
    }

    const entriesRef = collection(db, 'lifeCalendars', calendarId, 'dailyEntries');
    const rangeQuery = role === 'owner'
      ? query(entriesRef, where('dateId', '>=', startDateId), where('dateId', '<=', endDateId))
      : query(entriesRef, where('dateId', '>=', startDateId), where('dateId', '<=', endDateId), where('visibility', '==', 'viewers'));

    return onSnapshot(rangeQuery, (snapshot) => {
      setError('');
      setEntries(snapshot.docs.map((entryDoc) => ({ id: entryDoc.id, ...entryDoc.data() })));
    }, (err) => setError(err.message));
  }, [calendarId, startDateId, endDateId, role]);

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
  const data = { ...eventDocument(payload), updatedAt: serverTimestamp() };
  if (eventId) return updateDoc(doc(db, 'lifeCalendars', calendarId, 'events', eventId), data);
  return addDoc(collection(db, 'lifeCalendars', calendarId, 'events'), { ...data, createdAt: serverTimestamp() });
}

export function deleteEvent(calendarId, eventId) {
  return deleteDoc(doc(db, 'lifeCalendars', calendarId, 'events', eventId));
}

export function saveDailyEntry(calendarId, dateId, payload, uid = '') {
  return setDoc(doc(db, 'lifeCalendars', calendarId, 'dailyEntries', dateId), {
    dateId,
    date: dateId,
    journalText: payload.journalText || '',
    notes: payload.notes || '',
    tags: payload.tags || [],
    visibility: payload.visibility || 'ownerOnly',
    updatedAt: serverTimestamp(),
    updatedByUid: uid,
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

/** The owner's per-category targets for the Activity wheel (see utils/activityTargets.js). */
export function saveActivityTargets(calendarId, activityTargets) {
  return updateDoc(doc(db, 'lifeCalendars', calendarId), { activityTargets, updatedAt: serverTimestamp() });
}

/**
 * Weekly reviews keyed by week start (see utils/weeklyReview.js). The owner gets every review; a viewer only the ones
 * shared with viewers, which is all the rules let them read.
 */
export function useWeeklyReviews(calendarId, role) {
  const [reviews, setReviews] = useState({});
  const [loading, setLoading] = useState(Boolean(calendarId));
  const [error, setError] = useState('');

  useEffect(() => {
    if (!calendarId) {
      setReviews({});
      setLoading(false);
      return undefined;
    }
    const reviewsRef = collection(db, 'lifeCalendars', calendarId, 'weeklyReviews');
    const reviewsQuery = role === 'owner' ? reviewsRef : query(reviewsRef, where('visibility', '==', 'viewers'));
    return onSnapshot(reviewsQuery, (snapshot) => {
      setError('');
      setReviews(Object.fromEntries(snapshot.docs.map((reviewDoc) => [reviewDoc.id, { id: reviewDoc.id, ...reviewDoc.data() }])));
      setLoading(false);
    }, (err) => {
      setError(err.message);
      setLoading(false);
    });
  }, [calendarId, role]);

  return { reviews, loading, error };
}

/** Saves the review of one life-calendar week at `weeklyReviews/{weekStart}`; `review` is from buildReviewDocument. */
export function saveWeeklyReview(calendarId, review, existing = null) {
  return setDoc(doc(db, 'lifeCalendars', calendarId, 'weeklyReviews', review.weekStart), {
    ...review,
    createdAt: existing?.createdAt || serverTimestamp(),
    updatedAt: serverTimestamp()
  });
}

/**
 * The days that have a note or journal entry, as a Set of YYYY-MM-DD, for the dots on the life calendar. Only
 * subscribed while it is needed; a viewer gets only the days shared with viewers.
 */
export function useWrittenDates(calendarId, role, enabled = true) {
  const [dates, setDates] = useState(() => new Set());
  const [error, setError] = useState('');

  useEffect(() => {
    if (!calendarId || !enabled) {
      setDates(new Set());
      return undefined;
    }
    const entriesRef = collection(db, 'lifeCalendars', calendarId, 'dailyEntries');
    const entriesQuery = role === 'owner' ? entriesRef : query(entriesRef, where('visibility', '==', 'viewers'));
    return onSnapshot(entriesQuery, (snapshot) => {
      setError('');
      setDates(new Set(snapshot.docs
        .map((entryDoc) => entryDoc.data())
        .filter((entry) => String(entry.notes || entry.journalText || '').trim())
        .map((entry) => entry.dateId)
        .filter(Boolean)));
    }, (err) => setError(err.message));
  }, [calendarId, enabled, role]);

  return { dates, error };
}

/** The children's measurements (see utils/childMeasurements.js). A viewer gets only the ones shared with viewers. */
export function useChildMeasurements(calendarId, role) {
  const [measurements, setMeasurements] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!calendarId) {
      setMeasurements([]);
      return undefined;
    }
    const measurementsRef = collection(db, 'lifeCalendars', calendarId, 'childMeasurements');
    const measurementsQuery = role === 'owner' ? measurementsRef : query(measurementsRef, where('visibility', '==', 'viewers'));
    return onSnapshot(measurementsQuery, (snapshot) => {
      setError('');
      setMeasurements(snapshot.docs.map((measurementDoc) => ({ id: measurementDoc.id, ...measurementDoc.data() })));
    }, (err) => setError(err.message));
  }, [calendarId, role]);

  return { measurements, error };
}

/** Saves a measurement from buildMeasurement ({ id, data }); the id is stable per child, kind and day. */
export function saveChildMeasurement(calendarId, measurement) {
  return setDoc(doc(db, 'lifeCalendars', calendarId, 'childMeasurements', measurement.id), {
    ...measurement.data,
    updatedAt: serverTimestamp()
  }, { merge: true });
}

export function deleteChildMeasurement(calendarId, measurementId) {
  return deleteDoc(doc(db, 'lifeCalendars', calendarId, 'childMeasurements', measurementId));
}

/** Removes some of one child's detail rows from the calendar profile, leaving everything else as it is. */
export function removeChildDetails(calendarId, children, childId, detailIds) {
  const remove = new Set(detailIds);
  return updateDoc(doc(db, 'lifeCalendars', calendarId), {
    children: (children || []).map((child) => (child.id === childId
      ? { ...child, details: (child.details || []).filter((detail) => !remove.has(detail.id)) }
      : child)),
    updatedAt: serverTimestamp()
  });
}

/**
 * Adds a line to a day's notes without touching what is already there (quick capture). A new day's entry is
 * owner-only unless `shareWithViewers`; an existing entry keeps its visibility.
 */
export function appendDailyNote(calendarId, dateId, text, { uid = '', shareWithViewers = false, now = new Date() } = {}) {
  const line = String(text || '').trim();
  if (!line) return Promise.resolve(false);
  const time = now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const entryRef = doc(db, 'lifeCalendars', calendarId, 'dailyEntries', dateId);
  return runTransaction(db, async (transaction) => {
    const current = await transaction.get(entryRef);
    const existing = current.exists() ? current.data() : null;
    const notes = [existing?.notes || '', `${time}: ${line}`].filter(Boolean).join('\n');
    transaction.set(entryRef, {
      dateId,
      date: dateId,
      notes,
      ...(existing ? {} : { journalText: '', tags: [], visibility: shareWithViewers ? 'viewers' : 'ownerOnly', createdAt: serverTimestamp() }),
      updatedAt: serverTimestamp(),
      updatedByUid: uid
    }, { merge: true });
    return true;
  });
}

/** Things to do before it's too late (see utils/thingsToDo.js). A viewer gets only the ones shared with viewers. */
export function usePlans(calendarId, role) {
  const [plans, setPlans] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!calendarId) {
      setPlans([]);
      return undefined;
    }
    const plansRef = collection(db, 'lifeCalendars', calendarId, 'plans');
    const plansQuery = role === 'owner' ? plansRef : query(plansRef, where('visibility', '==', 'viewers'));
    return onSnapshot(plansQuery, (snapshot) => {
      setError('');
      setPlans(snapshot.docs.map((planDoc) => ({ id: planDoc.id, ...planDoc.data() })));
    }, (err) => setError(err.message));
  }, [calendarId, role]);

  return { plans, error };
}

/** Saves a plan from buildPlan: a new one when `planId` is empty. */
export function savePlan(calendarId, planId, plan) {
  if (planId) {
    return setDoc(doc(db, 'lifeCalendars', calendarId, 'plans', planId), { ...plan, updatedAt: serverTimestamp() }, { merge: true });
  }
  return addDoc(collection(db, 'lifeCalendars', calendarId, 'plans'), { ...plan, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
}

export function deletePlan(calendarId, planId) {
  return deleteDoc(doc(db, 'lifeCalendars', calendarId, 'plans', planId));
}

/** The Sunday digest's switches and last send (owner only; see docs/weekly-digest.md). */
export function useDigestSettings(calendarId) {
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!calendarId) {
      setSettings(null);
      return undefined;
    }
    return onSnapshot(doc(db, 'lifeCalendars', calendarId, 'digestSettings', 'owner'), (snapshot) => {
      setError('');
      setSettings(snapshot.exists() ? snapshot.data() : {});
    }, (err) => setError(err.message));
  }, [calendarId]);

  return { settings, error };
}

/** Devices that get the digest notification (owner only). */
export function usePushDevices(calendarId) {
  const [devices, setDevices] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!calendarId) {
      setDevices([]);
      return undefined;
    }
    return onSnapshot(collection(db, 'lifeCalendars', calendarId, 'pushTokens'), (snapshot) => {
      setError('');
      setDevices(snapshot.docs.map((deviceDoc) => ({ id: deviceDoc.id, platform: deviceDoc.data().platform || 'Browser', createdAt: deviceDoc.data().createdAt || null })));
    }, (err) => setError(err.message));
  }, [calendarId]);

  return { devices, error };
}
