// The fields a main-calendar event is saved with. An ongoing event has no end yet: it is carried every day until it
// is stopped, and then keeps every day (everyDay), so stopping it never takes days away.
export function eventDocument(payload) {
  return {
    title: payload.title.trim(),
    description: payload.description || '',
    startDate: payload.startDate,
    endDate: payload.ongoing ? '' : payload.endDate,
    ongoing: Boolean(payload.ongoing),
    everyDay: Boolean(payload.ongoing || payload.everyDay),
    color: payload.color,
    relatedPeopleIds: payload.relatedPeopleIds || [],
    visibility: payload.visibility || 'viewers'
  };
}
