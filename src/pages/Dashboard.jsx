import { useEffect, useMemo, useRef, useState } from 'react';
import CalendarBreadcrumbs from '../components/CalendarBreadcrumbs.jsx';
import { DayDrilldownView, MonthDetailView, WeekDetailView, YearDetailView } from '../components/CalendarDrilldown.jsx';
import EventManager from '../components/EventManager.jsx';
import LifeHeatmap from '../components/LifeHeatmap.jsx';
import ProfileForm from '../components/ProfileForm.jsx';
import ViewerManager from '../components/ViewerManager.jsx';
import WeekDetailPanel from '../components/WeekDetailPanel.jsx';
import { useAuth } from '../hooks/useAuth.jsx';
import { acceptViewerInvite, useEvents, useOwnedCalendar, useSharedCalendar, useViewerInvites, useViewers } from '../hooks/useCalendar.js';
import { logOut } from '../services/firebase.js';
import { getLifeStats } from '../utils/dateUtils.js';
import { getCustodyStats } from '../utils/custodyUtils.js';

export default function Dashboard() {
  const { user } = useAuth();
  const owned = useOwnedCalendar(user.uid);
  const inviteState = useViewerInvites(user, !owned.calendar);
  const invites = inviteState.invites;
  const acceptedInvite = invites.find((invite) => invite.status === 'accepted');
  const shared = useSharedCalendar(acceptedInvite?.calendarId, !owned.calendar && Boolean(acceptedInvite));
  const calendar = owned.calendar || shared.calendar;
  const loading = owned.loading || Boolean(!owned.calendar && acceptedInvite && !shared.calendar);
  const role = owned.calendar ? owned.role : 'viewer';
  const eventState = useEvents(calendar?.id, role);
  const viewerState = useViewers(role === 'owner' ? calendar?.id : null);
  const events = eventState.events;
  const viewers = viewerState.viewers;
  const [editingProfile, setEditingProfile] = useState(false);
  const [showEvents, setShowEvents] = useState(false);
  const [showViewers, setShowViewers] = useState(false);
  const [selectedWeek, setSelectedWeek] = useState(null);
  const [calendarView, setCalendarView] = useState({ view: 'life' });
  const [zoom, setZoom] = useState(() => Number(localStorage.getItem('lifeHeatmapZoom') || 1));
  const [fitMode, setFitMode] = useState(() => localStorage.getItem('lifeHeatmapFitMode') || 'width');
  const heatmapRef = useRef(null);
  const stats = useMemo(() => calendar ? getLifeStats(calendar.birthDate, calendar.targetAge) : null, [calendar]);
  const custodyStats = useMemo(() => calendar ? getCustodyStats(calendar) : null, [calendar]);
  const dataError = owned.error || inviteState.error || shared.error || eventState.error || viewerState.error;
  const pendingInvite = invites.find((invite) => invite.status === 'pending');
  const breadcrumbs = getBreadcrumbs(calendarView, setCalendarView);

  function updateZoom(value) {
    const nextZoom = Math.min(2.5, Math.max(0.45, value));
    setZoom(nextZoom);
    localStorage.setItem('lifeHeatmapZoom', String(nextZoom));
  }

  function updateFitMode(value) {
    setFitMode(value);
    localStorage.setItem('lifeHeatmapFitMode', value);
    if (value === 'whole') updateZoom(0.55);
    if (value === 'width') updateZoom(1);
  }

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if (event.key === '+' || event.key === '=') updateZoom(zoom + 0.15);
      if (event.key === '-') updateZoom(zoom - 0.15);
      if (event.key === '0') updateZoom(1);
      if (event.key.toLowerCase() === 'f') updateFitMode(fitMode === 'width' ? 'whole' : 'width');
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [zoom, fitMode]);

  if (loading) return <div className="app-shell centered">Loading calendar...</div>;

  if (!calendar || editingProfile) {
    return (
      <main className="app-shell">
        <header className="topbar">
          <div>
            <p className="eyebrow">Time Left To Live</p>
            <h1>{calendar ? 'Edit profile' : 'Create your life calendar'}</h1>
          </div>
          {calendar && <button className="secondary" type="button" onClick={() => setEditingProfile(false)}>Back</button>}
        </header>
        {!calendar && pendingInvite && (
          <section className="panel">
            <h2>Viewer invite</h2>
            <p className="muted">You have a pending calendar invite for {pendingInvite.email}.</p>
            <button className="primary" type="button" onClick={() => acceptViewerInvite(pendingInvite.calendarId, pendingInvite.id, user.uid)}>Accept invite</button>
          </section>
        )}
        <ProfileForm user={user} calendar={calendar} onSaved={() => setEditingProfile(false)} />
        {dataError && <p className="error">{dataError}</p>}
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">{role === 'owner' ? 'Owner dashboard' : 'Read-only viewer'}</p>
          <h1>{calendar.firstName} {calendar.lastName}</h1>
        </div>
        <div className="actions">
          {pendingInvite && <button className="secondary" type="button" onClick={() => acceptViewerInvite(pendingInvite.calendarId, pendingInvite.id, user.uid)}>Accept invite</button>}
          <button className="secondary" type="button" onClick={() => heatmapRef.current?.scrollToCurrentWeek()}>Today</button>
          {role === 'owner' && <button className="secondary" type="button" onClick={() => setShowEvents(true)}>Add event</button>}
          {role === 'owner' && <button className="secondary" type="button" onClick={() => setEditingProfile(true)}>Edit profile</button>}
          {role === 'owner' && <button className="secondary" type="button" onClick={() => setShowViewers(true)}>Manage viewers</button>}
          <button className="ghost" type="button" onClick={() => logOut()}>Sign out</button>
        </div>
      </header>

      <section className="summary-grid">
        <Summary label="Current age" value={stats.currentAge} />
        <Summary label="Target age" value={stats.targetAge} />
        <Summary label="Weeks lived" value={stats.weeksLived.toLocaleString()} />
        <Summary label="Weeks remaining" value={stats.weeksRemaining.toLocaleString()} />
        <Summary label="Days remaining" value={stats.daysRemaining.toLocaleString()} />
        <Summary label="Life remaining" value={`${stats.percentageRemaining.toFixed(1)}%`} />
      </section>
      {custodyStats && (
        <section className="family-time-panel">
          <div>
            <p className="eyebrow">Time with my boys</p>
            <h2>{custodyStats.weeksRemaining.toLocaleString()} weeks together</h2>
            <p className="muted">
              About {custodyStats.daysRemaining.toLocaleString()} days with {custodyStats.childNames.join(', ')}
              {' '}through {custodyStats.throughDate}, based on your every-other-week schedule.
            </p>
          </div>
          <button className="secondary" type="button" onClick={() => setEditingProfile(true)}>Edit schedule</button>
        </section>
      )}
      {dataError && <p className="error">{dataError}</p>}
      <CalendarBreadcrumbs items={breadcrumbs} />

      {calendarView.view === 'life' && (
        <LifeHeatmap
          ref={heatmapRef}
          calendar={calendar}
          events={events}
          onSelectWeek={(week) => setCalendarView({ view: 'week', age: week.age, weekStart: week.dateId })}
          onAgeClick={(age) => setCalendarView({ view: 'year', age })}
          zoom={zoom}
          fitMode={fitMode}
          onZoomChange={updateZoom}
          onFitModeChange={updateFitMode}
        />
      )}

      {calendarView.view === 'year' && (
        <YearDetailView calendar={calendar} age={calendarView.age} events={events} role={role} onNavigate={setCalendarView} />
      )}

      {calendarView.view === 'month' && (
        <MonthDetailView calendar={calendar} age={calendarView.age} monthId={calendarView.monthId} events={events} role={role} onNavigate={setCalendarView} />
      )}

      {calendarView.view === 'week' && (
        <WeekDetailView calendar={calendar} age={calendarView.age} monthId={calendarView.monthId} weekStart={calendarView.weekStart} events={events} role={role} onNavigate={setCalendarView} />
      )}

      {calendarView.view === 'day' && (
        <DayDrilldownView calendar={calendar} dateId={calendarView.dateId} events={events} role={role} />
      )}

      {selectedWeek && (
        <WeekDetailPanel
          calendar={calendar}
          week={selectedWeek}
          events={events}
          role={role}
          onClose={() => setSelectedWeek(null)}
        />
      )}
      {showEvents && <EventManager calendar={calendar} events={events} role={role} onClose={() => setShowEvents(false)} />}
      {showViewers && <ViewerManager calendarId={calendar.id} viewers={viewers} onClose={() => setShowViewers(false)} />}
    </main>
  );
}

function getBreadcrumbs(view, setCalendarView) {
  const items = [{ label: 'Life Overview', onClick: () => setCalendarView({ view: 'life' }) }];
  if (view.age !== undefined) items.push({ label: `Age ${view.age}`, onClick: () => setCalendarView({ view: 'year', age: view.age }) });
  if (view.monthId) items.push({ label: view.monthId, onClick: () => setCalendarView({ view: 'month', age: view.age, monthId: view.monthId }) });
  if (view.weekStart) items.push({ label: `Week of ${view.weekStart}`, onClick: () => setCalendarView({ view: 'week', age: view.age, monthId: view.monthId, weekStart: view.weekStart }) });
  if (view.dateId) items.push({ label: view.dateId, onClick: null });
  return items;
}

function Summary({ label, value }) {
  return (
    <article className="summary-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}
