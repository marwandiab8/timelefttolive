function cleanToken(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

/** A GridlineAI journal entry, note or photo (not an activity). Pure, so the weekly digest can use it on the server. */
export function isJournalOrMediaLifeEvent(event) {
  if (event?.sourceApp !== 'gridlineai') return false;
  if (event?.sourceFirebaseProjectId && event.sourceFirebaseProjectId !== 'gridlineai') return false;
  if (/^1:\d+:(?:web|ios|android):/i.test(String(event?.sourceProjectId || ''))) return false;
  const combined = [event?.eventType, event?.activityFamily, event?.categoryId, event?.title]
    .map(cleanToken)
    .join('_');
  return /(journal|note|memo|image|photo|picture|attachment|media)/.test(combined);
}
