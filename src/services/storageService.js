import { addDoc, collection, deleteDoc, doc, serverTimestamp } from 'firebase/firestore';
import { deleteObject, getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { db, storage } from './firebase.js';

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = ['image/', 'application/pdf', 'text/plain'];

export function validateUpload(file) {
  if (!file) throw new Error('Choose a file first.');
  if (file.size > MAX_UPLOAD_BYTES) throw new Error('Files must be 10MB or smaller.');
  if (!ALLOWED_TYPES.some((type) => file.type.startsWith(type) || file.type === type)) {
    throw new Error('Only images, PDFs, and text files are allowed.');
  }
}

export async function uploadDailyAttachment(calendarId, dateId, file, metadata) {
  validateUpload(file);
  const safeName = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '-')}`;
  const storagePath = `lifeCalendars/${calendarId}/dailyEntries/${dateId}/${safeName}`;
  const fileRef = ref(storage, storagePath);
  await uploadBytes(fileRef, file, { contentType: file.type });
  const url = await getDownloadURL(fileRef);
  const type = file.type.startsWith('image/') ? 'image' : 'file';
  return addDoc(collection(db, 'lifeCalendars', calendarId, 'dailyEntries', dateId, 'attachments'), {
    type,
    title: metadata.title || file.name,
    description: metadata.description || '',
    url,
    storagePath,
    visibility: metadata.visibility || 'viewers',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
}

export function addLinkAttachment(calendarId, dateId, payload) {
  return addDoc(collection(db, 'lifeCalendars', calendarId, 'dailyEntries', dateId, 'attachments'), {
    type: 'link',
    title: payload.title.trim(),
    description: payload.description || '',
    url: payload.url.trim(),
    storagePath: '',
    visibility: payload.visibility || 'viewers',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
}

export async function deleteAttachment(calendarId, dateId, attachment) {
  if (attachment.storagePath) {
    await deleteObject(ref(storage, attachment.storagePath));
  }
  return deleteDoc(doc(db, 'lifeCalendars', calendarId, 'dailyEntries', dateId, 'attachments', attachment.id));
}
