import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import BrandLogo from '../components/BrandLogo.jsx';
import ActivityDashboard from '../components/ActivityDashboard.jsx';
import CalendarBreadcrumbs from '../components/CalendarBreadcrumbs.jsx';
import { DayDrilldownView, MonthDetailView, WeekDetailView, YearDetailView } from '../components/CalendarDrilldown.jsx';
import EmailVerificationNotice from '../components/EmailVerificationNotice.jsx';
import EventManager from '../components/EventManager.jsx';
import FamilyTimePanel from '../components/FamilyTimePanel.jsx';
import LifeSummary from '../components/LifeSummary.jsx';
import ExternalSourcesManager from '../components/ExternalSourcesManager.jsx';
import LifeHeatmap from '../components/LifeHeatmap.jsx';
import PrimaryViewSwitcher from '../components/PrimaryViewSwitcher.jsx';
import QuickCapture from '../components/QuickCapture.jsx';
import ProfileForm from '../components/ProfileForm.jsx';
import ViewerManager from '../components/ViewerManager.jsx';
import WeekDetailPanel from '../components/WeekDetailPanel.jsx';
import WhatsLeft from '../components/WhatsLeft.jsx';
import OnThisDay from '../components/OnThisDay.jsx';
import { WeeklyReviewCard, WeeklyReviewDialog } from '../components/WeeklyReview.jsx';
import WeeklyDigestPage from '../components/WeeklyDigest.jsx';
import { MeasurementsDialog } from '../components/ChildMeasurements.jsx';
import ThingsToDo, { PlanDialog } from '../components/ThingsToDo.jsx';
import { useAuth } from '../hooks/useAuth.jsx';
import { acceptViewerInvite, useEvents, useOwnedCalendar, useSharedCalendar, useViewerInvites, useViewers, useWeeklyReviews, useWrittenDates, useChildMeasurements, usePlans } from '../hooks/useCalendar.js';
import { logOut } from '../services/firebase.js';
import { useCurrentDay } from '../hooks/useCurrentDay.js';
import { formatDateId, getLifeStats, getTodayCalendarView, parseDateId, sameCalendarView, withOngoingEvents } from '../utils/dateUtils.js';
import { clampHeatmapZoom } from '../utils/heatmapViewport.js';
import { readCalendarTheme, toggleCalendarTheme, writeCalendarTheme } from '../utils/theme.js';
import { lifeWeekFor } from '../utils/weeklyReview.js';
import { normalizeLivedMode } from '../utils/livedWeeks.js';

function readStoredZoom() {
  return clampHeatmapZoom(localStorage.getItem('lifeHeatmapZoom') || 1);
}

// Which colouring the life calendar uses for lived weeks, remembered on this device.
function readStoredLivedMode() {
  try {
    return localStorage.getItem('lifeHeatmapLivedMode') || 'events';
  } catch {
    return 'events';
  }
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
  const [emailVerified, setEmailVerified] = useState(Boolean(user.emailVerified));
  const inviteState = useViewerInvites(user, !owned.calendar && emailVerified);
  const invites = inviteState.invites;
  const acceptedInvite = invites.find((invite) => invite.status === 'accepted');
  const shared = useSharedCalendar(acceptedInvite?.calendarId, !owned.calendar && Boolean(acceptedInvite));
  const calendar = owned.calendar || shared.calendar;
  const loading = owned.loading || Boolean(!owned.calendar && acceptedInvite && !shared.calendar);
  const role = owned.calendar ? owned.role : 'viewer';
  const eventState = useEvents(calendar?.id, role);
  // Recomputed at midnight, so the summary is right in a tab left open overnight, and an ongoing event reaches today.
  const currentDay = useCurrentDay();
  const viewerState = useViewers(role === 'owner' ? calendar?.id : null);
  const events = useMemo(() => withOngoingEvents(eventState.events, currentDay), [eventState.events, currentDay]);
  const viewers = viewerState.viewers;
  const reviewState = useWeeklyReviews(calendar?.id, role);
  const [reviewWeek, setReviewWeek] = useState(null);
  const measurementState = useChildMeasurements(calendar?.id, role);
  const [measuringChildId, setMeasuringChildId] = useState(null);
  const planState = usePlans(calendar?.id, role);
  // The plan being edited: null when closed, {} for a new one.
  const [editingPlan, setEditingPlan] = useState(null);
  const [storedLivedMode, setStoredLivedMode] = useState(readStoredLivedMode);
  const livedMode = normalizeLivedMode(storedLivedMode, { hasCustody: Boolean(calendar?.custodySchedule?.enabled && calendar?.custodySchedule?.nextStartDate) });
  const writtenState = useWrittenDates(calendar?.id, role, livedMode !== 'events');
  const updateLivedMode = useCallback((value) => {
    setStoredLivedMode(value);
    try {
      localStorage.setItem('lifeHeatmapLivedMode', value);
    } catch {
      // Not remembered in a private window; the choice still applies now.
    }
  }, []);
  const [editingProfile, setEditingProfile] = useState(false);
  const [showEvents, setShowEvents] = useState(false);
  const [showSources, setShowSources] = useState(false);
  const [showViewers, setShowViewers] = useState(false);
  const [primaryView, setPrimaryView] = useState(viewFromLocation);
  // Quick capture (#capture), opened from the home-screen shortcut.
  const [capturing, setCapturing] = useState(() => window.location.hash === '#capture');
  // The Sunday digest (#digest), opened from its notification, its email or the review card.
  const [digestOpen, setDigestOpen] = useState(() => window.location.hash === '#digest');
  const [activityMounted, setActivityMounted] = useState(() => viewFromLocation() === 'activity');
  const [selectedWeek, setSelectedWeek] = useState(null);
  // The calendar's level (life, age, month, week, day) is kept in the browser's history entry, so a reload stays put.
  const [calendarView, setCalendarView] = useState(() => window.history.state?.calendarView || { view: 'life' });
  const scrollIntentRef = useRef(null);
  const [zoom, setZoom] = useState(readStoredZoom);
  const [fitMode, setFitMode] = useState(readStoredFitMode);
  const [calendarTheme, setCalendarTheme] = useState(readCalendarTheme);
  const heatmapRef = useRef(null);
  const viewScrollPositions = useRef({ activity: { left: 0, top: 0 }, calendar: { left: 0, top: 0 } });
  const stats = useMemo(() => calendar ? getLifeStats(calendar.birthDate, calendar.targetAge, parseDateId(currentDay)) : null, [calendar, currentDay]);
  const dataError = owned.error || inviteState.error || shared.error || eventState.error || viewerState.error || reviewState.error || writtenState.error || measurementState.error || planState.error;
  const pendingInvite = invites.find((invite) => invite.status === 'pending');
  // Moving between the calendar's levels is a step in the browser's history, so Back (the browser's, or a phone's
  // swipe) goes up the way you came and Forward down again. Each step remembers where you were on it: the week you
  // opened in the life calendar, the scroll position on the others. A new level opens at its top.
  const navigateCalendar = useCallback((next, { focusWeek = null } = {}) => {
    if (sameCalendarView(next, calendarView)) {
      document.querySelector('.app-shell .breadcrumbs')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      return;
    }
    const here = window.history.state || {};
    const week = focusWeek || calendarView.weekStart || here.focusWeek || null;
    window.history.replaceState({ ...here, calendarView, scrollY: window.scrollY, focusWeek: week }, '');
    window.history.pushState({ calendarView: next, focusWeek: week }, '', `${window.location.pathname}${window.location.search}`);
    scrollIntentRef.current = next.view === 'life' ? { focusWeek: week } : { top: true };
    setCalendarView(next);
  }, [calendarView]);
  const breadcrumbs = getBreadcrumbs(calendarView, navigateCalendar);

  // Today goes to today at the level you're on: this week in the life calendar, else this year, month, week or day.
  // When you're already there, it shows it.
  function goToToday() {
    if (calendarView.view === 'life') {
      heatmapRef.current?.scrollToCurrentWeek();
      return;
    }
    const target = getTodayCalendarView(calendar.birthDate, calendar.targetAge, calendarView.view, parseDateId(currentDay));
    if (target && !sameCalendarView(target, calendarView)) {
      navigateCalendar(target);
      return;
    }
    document.querySelector('.app-shell .breadcrumbs')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    document.querySelectorAll('.detail-surface .today').forEach((element) => {
      element.classList.add('pulse');
      window.setTimeout(() => element.classList.remove('pulse'), 1400);
    });
  }

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
    function handleHistoryChange(event) {
      const requestedView = viewFromLocation();
      const nextView = requestedView === 'activity' && role === 'owner' ? 'activity' : 'calendar';
      viewScrollPositions.current[primaryView] = { left: window.scrollX, top: window.scrollY };
      if (nextView === 'activity') setActivityMounted(true);
      setPrimaryView(nextView);
      // Back or Forward to another level of the calendar: show it as you left it.
      const state = event.state || {};
      const nextCalendarView = state.calendarView || { view: 'life' };
      if (!sameCalendarView(nextCalendarView, calendarView)) {
        scrollIntentRef.current = { focusWeek: nextCalendarView.view === 'life' ? state.focusWeek : null, scrollY: state.scrollY };
        setCalendarView(nextCalendarView);
      }
    }
    window.addEventListener('popstate', handleHistoryChange);
    return () => window.removeEventListener('popstate', handleHistoryChange);
  }, [calendarView, primaryView, role]);

  // After moving to a level: its top, or where you were on it (the week you opened, highlighted, in the life calendar).
  // Tried again a moment later, as the life calendar lays itself out once it's on screen.
  useEffect(() => {
    const intent = scrollIntentRef.current;
    if (!intent) return undefined;
    scrollIntentRef.current = null;
    const show = (announce) => {
      if (calendarView.view === 'life' && intent.focusWeek && heatmapRef.current?.scrollToWeek(intent.focusWeek, { announce, block: 'center' })) return;
      if (Number.isFinite(intent.scrollY)) window.scrollTo({ left: 0, top: intent.scrollY, behavior: 'auto' });
      else document.querySelector('.app-shell .breadcrumbs')?.scrollIntoView({ block: 'start', behavior: 'auto' });
    };
    const frame = window.requestAnimationFrame(() => show(true));
    const settle = window.setTimeout(() => show(false), 160);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(settle);
    };
  }, [calendarView]);

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

  useEffect(() => {
    const onHash = () => {
      setCapturing(window.location.hash === '#capture');
      setDigestOpen(window.location.hash === '#digest');
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  if (loading) return <div className="app-shell centered">Loading calendar...</div>;

  if (capturing && calendar && role === 'owner') {
    return (
      <QuickCapture
        calendar={calendar}
        today={currentDay}
        uid={user.uid}
        theme={calendarTheme}
        onDone={() => {
          window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}`);
          setCapturing(false);
        }}
      />
    );
  }

  if (digestOpen && calendar && role === 'owner') {
    return (
      <WeeklyDigestPage
        calendar={calendar}
        uid={user.uid}
        email={user.email || ''}
        theme={calendarTheme}
        onDone={() => {
          window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}`);
          setDigestOpen(false);
        }}
      />
    );
  }

  if (!calendar || editingProfile) {
    return (
      <main className="app-shell" data-calendar-theme={calendarTheme}>
        <header className="topbar">
          <div>
            <p className="eyebrow brand-row"><BrandLogo size={28} />Time Left To Live</p>
            <h1>{calendar ? 'Edit profile' : 'Create your life calendar'}</h1>
          </div>
          {calendar && <button className="secondary" type="button" onClick={() => setEditingProfile(false)}>Back</button>}
        </header>
        {!calendar && !emailVerified && user.email && (
          <EmailVerificationNotice email={user.email} onVerified={() => setEmailVerified(true)} />
        )}
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
      <main className="app-shell" data-calendar-theme={calendarTheme} hidden={primaryView !== 'calendar'} style={calendarColorVariables(calendar.settings)}>
      <header className="topbar">
        <div className="calendar-heading">
          <p className="calendar-role brand-row"><BrandLogo size={28} />{role === 'owner' ? 'Owner dashboard' : 'Read-only viewer'}</p>
          <h1>{calendar.firstName} {calendar.lastName}</h1>
          {role === 'owner' && (
            <PrimaryViewSwitcher
              currentView="calendar"
              onActivity={showActivity}
            />
          )}
        </div>
        <div className="actions calendar-actions">
          {pendingInvite && <button className="secondary" type="button" onClick={() => acceptViewerInvite(pendingInvite.calendarId, pendingInvite.id, user.uid)}>Accept invite</button>}
          <button className="secondary" type="button" onClick={goToToday}>Today</button>
          {role === 'owner' && <button className="primary" type="button" onClick={() => setShowEvents(true)}>Add event</button>}
          <button className="quiet-button theme-toggle" type="button" aria-pressed={calendarTheme === 'light'} onClick={toggleCalendarBackground}>
            {calendarTheme === 'dark' ? 'Light background' : 'Dark background'}
          </button>
          {role === 'owner' && <button className="quiet-button" type="button" onClick={() => setShowSources(true)}>External sources</button>}
          {role === 'owner' && <button className="quiet-button" type="button" onClick={() => setEditingProfile(true)}>Edit profile</button>}
          {role === 'owner' && <button className="quiet-button" type="button" onClick={() => setShowViewers(true)}>Manage viewers</button>}
          <button className="quiet-button" type="button" onClick={() => logOut()}>Sign out</button>
        </div>
      </header>

      <LifeSummary stats={stats} />
      <WhatsLeft calendar={calendar} today={currentDay} />
      <OnThisDay
        calendar={calendar}
        today={currentDay}
        role={role}
        events={events}
        reviews={reviewState.reviews}
        onOpenDay={(dateId) => {
          const day = getTodayCalendarView(calendar.birthDate, calendar.targetAge, 'day', parseDateId(dateId));
          if (day) navigateCalendar(day);
        }}
      />
      {role === 'owner' && !reviewState.loading && (
        <WeeklyReviewCard calendar={calendar} today={currentDay} reviews={reviewState.reviews} onOpen={setReviewWeek} />
      )}
      {calendar.children?.length > 0 && (
        <FamilyTimePanel
          calendar={calendar}
          today={currentDay}
          canEdit={role === 'owner'}
          onEdit={() => setEditingProfile(true)}
          measurements={measurementState.measurements}
          onOpenMeasurements={role === 'owner' ? setMeasuringChildId : null}
          plans={planState.plans}
        />
      )}
      <ThingsToDo
        calendar={calendar}
        plans={planState.plans}
        today={currentDay}
        canEdit={role === 'owner'}
        onAdd={() => setEditingPlan({})}
        onEdit={setEditingPlan}
      />
      {dataError && <p className="error">{dataError}</p>}
      <CalendarBreadcrumbs items={breadcrumbs} />

      {calendarView.view === 'life' && (
        <LifeHeatmap
          ref={heatmapRef}
          calendar={calendar}
          events={events}
          onSelectWeek={(week) => navigateCalendar({ view: 'week', age: week.age, weekStart: week.dateId, weekEnd: formatDateId(week.end) }, { focusWeek: week.dateId })}
          onAgeClick={(age) => navigateCalendar({ view: 'year', age })}
          zoom={zoom}
          fitMode={fitMode}
          onZoomChange={updateZoom}
          onFitModeChange={updateFitMode}
          livedMode={livedMode}
          onLivedModeChange={updateLivedMode}
          reviews={reviewState.reviews}
          writtenDateIds={writtenState.dates}
        />
      )}

      {calendarView.view === 'year' && (
        <YearDetailView calendar={calendar} age={calendarView.age} events={events} role={role} onNavigate={navigateCalendar} />
      )}

      {calendarView.view === 'month' && (
        <MonthDetailView calendar={calendar} age={calendarView.age} monthId={calendarView.monthId} events={events} role={role} onNavigate={navigateCalendar} />
      )}

      {calendarView.view === 'week' && (
        <WeekDetailView
          calendar={calendar}
          age={calendarView.age}
          monthId={calendarView.monthId}
          weekStart={calendarView.weekStart}
          weekEnd={calendarView.weekEnd}
          events={events}
          role={role}
          onNavigate={navigateCalendar}
          review={reviewState.reviews[lifeWeekFor(calendar.birthDate, calendarView.weekStart)?.start] || null}
          onReview={role === 'owner' && calendarView.weekStart <= currentDay ? () => setReviewWeek(lifeWeekFor(calendar.birthDate, calendarView.weekStart)) : null}
        />
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
      {measuringChildId && calendar.children?.some((child) => child.id === measuringChildId) && (
        <MeasurementsDialog
          calendarId={calendar.id}
          child={calendar.children.find((child) => child.id === measuringChildId)}
          allChildren={calendar.children}
          measurements={measurementState.measurements}
          onClose={() => setMeasuringChildId(null)}
        />
      )}
      {editingPlan && (
        <PlanDialog key={editingPlan.id || 'new'} calendar={calendar} plan={editingPlan.id ? editingPlan : null} today={currentDay} onClose={() => setEditingPlan(null)} />
      )}
      {reviewWeek && (
        <WeeklyReviewDialog key={reviewWeek.start} calendar={calendar} week={reviewWeek} reviews={reviewState.reviews} onClose={() => setReviewWeek(null)} />
      )}
      {showEvents && <EventManager calendar={calendar} events={events} role={role} onClose={() => setShowEvents(false)} />}
      {showSources && <ExternalSourcesManager calendarId={calendar.id} onClose={() => setShowSources(false)} />}
      {showViewers && <ViewerManager calendarId={calendar.id} viewers={viewers} onClose={() => setShowViewers(false)} />}
      </main>
    </>
  );
}

function getBreadcrumbs(view, navigate) {
  const items = [{ label: 'Life Overview', onClick: () => navigate({ view: 'life' }) }];
  if (view.age !== undefined) items.push({ label: `Age ${view.age}`, onClick: () => navigate({ view: 'year', age: view.age }) });
  if (view.monthId) items.push({ label: view.monthId, onClick: () => navigate({ view: 'month', age: view.age, monthId: view.monthId }) });
  if (view.weekStart) items.push({ label: `Week of ${view.weekStart}`, onClick: () => navigate({ view: 'week', age: view.age, monthId: view.monthId, weekStart: view.weekStart, weekEnd: view.weekEnd }) });
  if (view.dateId) items.push({ label: view.dateId, onClick: null });
  return items;
}

// The summary bar and the grid share the calendar's own past, current and
// future colours, so the two read as one encoding.
function calendarColorVariables(settings = {}) {
  return {
    '--life-past': settings.pastColor || '#46505c',
    '--life-now': settings.currentWeekColor || '#f4c542',
    '--life-future': settings.futureColor || '#17222c'
  };
}
