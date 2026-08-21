import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ActivityDashboard from '../components/ActivityDashboard.jsx';
import CalendarBreadcrumbs from '../components/CalendarBreadcrumbs.jsx';
import { DayDrilldownView, MonthDetailView, WeekDetailView, YearDetailView } from '../components/CalendarDrilldown.jsx';
import EventManager from '../components/EventManager.jsx';
import ExternalSourcesManager from '../components/ExternalSourcesManager.jsx';
import LifeHeatmap from '../components/LifeHeatmap.jsx';
import PrimaryViewSwitcher from '../components/PrimaryViewSwitcher.jsx';
import ProfileForm from '../components/ProfileForm.jsx';
import ViewerManager from '../components/ViewerManager.jsx';
import WeekDetailPanel from '../components/WeekDetailPanel.jsx';
import { useAuth } from '../hooks/useAuth.jsx';
import { acceptViewerInvite, useEvents, useOwnedCalendar, useSharedCalendar, useViewerInvites, useViewers } from '../hooks/useCalendar.js';
import { logOut } from '../services/firebase.js';
import { getLifeStats } from '../utils/dateUtils.js';
import { getCustodyStats } from '../utils/custodyUtils.js';
import { clampHeatmapZoom } from '../utils/heatmapViewport.js';
import { readCalendarTheme, toggleCalendarTheme, writeCalendarTheme } from '../utils/theme.js';

function readStoredZoom() {
  return clampHeatmapZoom(localStorage.getItem('lifeHeatmapZoom') || 1);
}

function readStoredFitMode() {
  const stored = localStorage.getItem('lifeHeatmapFitMode');
  return stored === 'manual' ? 'manual' : 'fit';
}

function viewFromLocation() {
  return window.location.hash === '#activity' ? 'activity' : 'calendar';
}

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
  const [showSources, setShowSources] = useState(false);
  const [showViewers, setShowViewers] = useState(false);
  const [primaryView, setPrimaryView] = useState(viewFromLocation);
  const [activityMounted, setActivityMounted] = useState(() => viewFromLocation() === 'activity');
  const [selectedWeek, setSelectedWeek] = useState(null);
  const [calendarView, setCalendarView] = useState({ view: 'life' });
  const [zoom, setZoom] = useState(readStoredZoom);
  const [fitMode, setFitMode] = useState(readStoredFitMode);
  const [calendarTheme, setCalendarTheme] = useState(readCalendarTheme);
  const heatmapRef = useRef(null);
  const viewScrollPositions = useRef({ activity: { left: 0, top: 0 }, calendar: { left: 0, top: 0 } });
  const stats = useMemo(() => calendar ? getLifeStats(calendar.birthDate, calendar.targetAge) : null, [calendar]);
  const custodyStats = useMemo(() => calendar ? getCustodyStats(calendar) : null, [calendar]);
  const dataError = owned.error || inviteState.error || shared.error || eventState.error || viewerState.error;
  const pendingInvite = invites.find((invite) => invite.status === 'pending');
  const breadcrumbs = getBreadcrumbs(calendarView, setCalendarView);

  useEffect(() => {
    if (primaryView === 'calendar') {
      document.documentElement.dataset.calendarTheme = calendarTheme;
    } else {
      delete document.documentElement.dataset.calendarTheme;
    }
    return () => delete document.documentElement.dataset.calendarTheme;
  }, [calendarTheme, primaryView]);

  const updateZoom = useCallback((value, { preserveFitMode = false } = {}) => {
    const nextZoom = clampHeatmapZoom(value);
    setZoom(nextZoom);
    localStorage.setItem('lifeHeatmapZoom', String(nextZoom));
    if (!preserveFitMode) {
      setFitMode('manual');
      localStorage.setItem('lifeHeatmapFitMode', 'manual');
    }
  }, []);

  const updateFitMode = useCallback((value) => {
    setFitMode(value);
    localStorage.setItem('lifeHeatmapFitMode', value);
  }, []);

  const showActivity = useCallback(() => {
    if (role !== 'owner' || primaryView === 'activity') return;
    viewScrollPositions.current.calendar = { left: window.scrollX, top: window.scrollY };
    setActivityMounted(true);
    window.history.pushState(
      { ...(window.history.state || {}), timeLeftView: 'activity' },
      '',
      `${window.location.pathname}${window.location.search}#activity`
    );
    setPrimaryView('activity');
  }, [primaryView, role]);

  const showCalendar = useCallback(() => {
    if (primaryView === 'calendar') return;
    viewScrollPositions.current.activity = { left: window.scrollX, top: window.scrollY };
    if (window.location.hash === '#activity' && window.history.state?.timeLeftView === 'activity') {
      window.history.back();
      return;
    }
    const nextState = { ...(window.history.state || {}) };
    delete nextState.timeLeftView;
    window.history.replaceState(nextState, '', `${window.location.pathname}${window.location.search}`);
    setPrimaryView('calendar');
  }, [primaryView]);

  function toggleCalendarBackground() {
    setCalendarTheme((current) => writeCalendarTheme(toggleCalendarTheme(current)));
  }

  useEffect(() => {
    function handleHistoryChange() {
      const requestedView = viewFromLocation();
      const nextView = requestedView === 'activity' && role === 'owner' ? 'activity' : 'calendar';
      viewScrollPositions.current[primaryView] = { left: window.scrollX, top: window.scrollY };
      if (nextView === 'activity') setActivityMounted(true);
      setPrimaryView(nextView);
    }
    window.addEventListener('popstate', handleHistoryChange);
    return () => window.removeEventListener('popstate', handleHistoryChange);
  }, [primaryView, role]);

  useEffect(() => {
    if (role === 'owner' || primaryView !== 'activity') return;
    const nextState = { ...(window.history.state || {}) };
    delete nextState.timeLeftView;
    window.history.replaceState(nextState, '', `${window.location.pathname}${window.location.search}`);
    setPrimaryView('calendar');
  }, [primaryView, role]);

  useEffect(() => {
    const position = viewScrollPositions.current[primaryView];
    window.scrollTo({ left: position.left, top: position.top, behavior: 'auto' });
    let secondFrame;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        window.scrollTo({ left: position.left, top: position.top, behavior: 'auto' });
      });
    });
    const settleTimer = window.setTimeout(() => {
      window.scrollTo({ left: position.left, top: position.top, behavior: 'auto' });
    }, 120);
    return () => {
      window.cancelAnimationFrame(firstFrame);
      if (secondFrame) window.cancelAnimationFrame(secondFrame);
      window.clearTimeout(settleTimer);
    };
  }, [primaryView]);

  useEffect(() => {
    function handleKeyDown(event) {
      if (primaryView !== 'calendar' || calendarView.view !== 'life') return;
      if (
        event.target instanceof HTMLInputElement
        || event.target instanceof HTMLTextAreaElement
        || event.target instanceof HTMLSelectElement
        || event.target?.isContentEditable
      ) return;
      if (event.key === '+' || event.key === '=') {
        event.preventDefault();
        heatmapRef.current?.zoomBy(1);
      }
      if (event.key === '-') {
        event.preventDefault();
        heatmapRef.current?.zoomBy(-1);
      }
      if (event.key === '0') {
        event.preventDefault();
        heatmapRef.current?.resetZoom();
      }
      if (event.key.toLowerCase() === 'f') {
        event.preventDefault();
        heatmapRef.current?.fitCalendar();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [calendarView.view, primaryView]);

  if (loading) return <div className="app-shell centered">Loading calendar...</div>;

  if (!calendar || editingProfile) {
    return (
      <main className="app-shell" data-calendar-theme={calendarTheme}>
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
    <>
      {role === 'owner' && activityMounted && (
        <ActivityDashboard
          active={primaryView === 'activity'}
          calendar={calendar}
          onBack={showCalendar}
        />
      )}
      <main className="app-shell" data-calendar-theme={calendarTheme} hidden={primaryView !== 'calendar'}>
      <header className="topbar">
        <div className="calendar-heading">
          <p className="eyebrow">{role === 'owner' ? 'Owner dashboard' : 'Read-only viewer'}</p>
          <h1>{calendar.firstName} {calendar.lastName}</h1>
          {role === 'owner' && (
            <PrimaryViewSwitcher
              currentView="calendar"
              onActivity={showActivity}
            />
          )}
        </div>
        <div className="actions">
          {pendingInvite && <button className="secondary" type="button" onClick={() => acceptViewerInvite(pendingInvite.calendarId, pendingInvite.id, user.uid)}>Accept invite</button>}
          <button className="secondary" type="button" onClick={() => heatmapRef.current?.scrollToCurrentWeek()}>Today</button>
          <button className="secondary theme-toggle" type="button" aria-pressed={calendarTheme === 'light'} onClick={toggleCalendarBackground}>
            {calendarTheme === 'dark' ? 'Light background' : 'Dark background'}
          </button>
          {role === 'owner' && <button className="secondary" type="button" onClick={() => setShowEvents(true)}>Add event</button>}
          {role === 'owner' && <button className="secondary" type="button" onClick={() => setShowSources(true)}>External sources</button>}
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
      {showSources && <ExternalSourcesManager calendarId={calendar.id} onClose={() => setShowSources(false)} />}
      {showViewers && <ViewerManager calendarId={calendar.id} viewers={viewers} onClose={() => setShowViewers(false)} />}
      </main>
    </>
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
