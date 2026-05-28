import { useMemo, useRef, useState } from 'react';
import EventManager from '../components/EventManager.jsx';
import LifeHeatmap from '../components/LifeHeatmap.jsx';
import ProfileForm from '../components/ProfileForm.jsx';
import ViewerManager from '../components/ViewerManager.jsx';
import WeekDetailPanel from '../components/WeekDetailPanel.jsx';
import { useAuth } from '../hooks/useAuth.jsx';
import { acceptViewerInvite, useEvents, useOwnedCalendar, useSharedCalendar, useViewerInvites, useViewers } from '../hooks/useCalendar.js';
import { logOut } from '../services/firebase.js';
import { getLifeStats } from '../utils/dateUtils.js';

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
  const heatmapRef = useRef(null);
  const stats = useMemo(() => calendar ? getLifeStats(calendar.birthDate, calendar.targetAge) : null, [calendar]);

  if (loading) return <div className="app-shell centered">Loading calendar...</div>;

  const dataError = owned.error || inviteState.error || shared.error || eventState.error || viewerState.error;

  if (!calendar || editingProfile) {
    const pendingInvite = invites.find((invite) => invite.status === 'pending');
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

  const pendingInvite = invites.find((invite) => invite.status === 'pending');

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
      {dataError && <p className="error">{dataError}</p>}

      <LifeHeatmap ref={heatmapRef} calendar={calendar} events={events} onSelectWeek={setSelectedWeek} />

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

function Summary({ label, value }) {
  return (
    <article className="summary-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}
