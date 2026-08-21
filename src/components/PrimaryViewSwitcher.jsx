export default function PrimaryViewSwitcher({ currentView, onActivity, onCalendar }) {
  return (
    <nav className="primary-view-switcher" aria-label="Main view">
      <button
        aria-current={currentView === 'calendar' ? 'page' : undefined}
        className={currentView === 'calendar' ? 'selected' : ''}
        type="button"
        onClick={onCalendar}
      >
        {currentView === 'activity' && <span aria-hidden="true">←</span>} Calendar
      </button>
      <button
        aria-current={currentView === 'activity' ? 'page' : undefined}
        className={currentView === 'activity' ? 'selected' : ''}
        type="button"
        onClick={onActivity}
      >
        Activity
      </button>
    </nav>
  );
}
