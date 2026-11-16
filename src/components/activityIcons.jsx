// One monochrome, stroke-based icon set for the Activity dashboard.
// 24 x 24 grid, 2 unit safe margin, drawn with currentColor so the surrounding text colour themes it.
// Path data uses absolute commands only, so every coordinate stays readable and checkable.

const ICONS = {
  work: (
    <>
      <rect x="3" y="7" width="18" height="13" rx="2.5" />
      <path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4H13.5A1.5 1.5 0 0 1 15 5.5V7" />
      <path d="M3 13H21" />
      <path d="M12 11.5V14.5" />
    </>
  ),
  'gym-fitness': (
    <>
      <path d="M7 6V18" />
      <path d="M17 6V18" />
      <path d="M4 9V15" />
      <path d="M20 9V15" />
      <path d="M7 12H17" />
    </>
  ),
  sleep: (
    <>
      <path d="M20 14A8.5 8.5 0 1 1 10 4A10 10 0 0 0 20 14Z" />
      <path d="M19 3.5V6.5" />
      <path d="M17.5 5H20.5" />
    </>
  ),
  home: (
    <>
      <path d="M3 11.5L12 4L21 11.5" />
      <path d="M5.5 10V20H18.5V10" />
      <path d="M10 20V15H14V20" />
    </>
  ),
  transportation: (
    <>
      <path d="M5 16.5H3.5A1 1 0 0 1 2.5 15.5V12.8C2.5 12.3 2.7 11.8 3.1 11.4L5.6 8.2C6 7.5 6.6 7 7.5 7H15.5C16.2 7 16.8 7.3 17.2 7.8L19.5 11.3C20.5 11.6 21.5 12.1 21.5 13.5V15.5A1 1 0 0 1 20.5 16.5H19" />
      <path d="M9 16.5H15" />
      <path d="M3.1 11.5H19.5" />
      <circle cx="7" cy="16.5" r="2" />
      <circle cx="17" cy="16.5" r="2" />
    </>
  ),
  music: (
    <>
      <circle cx="8" cy="17.5" r="2.5" />
      <path d="M10.5 17.5V4.5" />
      <path d="M10.5 4.5C13 6 17 6.5 17 11" />
    </>
  ),
  meals: (
    <>
      <path d="M3.5 12H20.5" />
      <path d="M4.5 12C4.5 16.5 7.5 19.5 12 19.5C16.5 19.5 19.5 16.5 19.5 12" />
      <path d="M9 4C8 5.3 10 6.7 9 8" />
      <path d="M15 4C14 5.3 16 6.7 15 8" />
    </>
  ),
  places: (
    <>
      <path d="M12 21C12 21 5 15 5 10A7 7 0 0 1 19 10C19 15 12 21 12 21Z" />
      <circle cx="12" cy="10" r="2.5" />
    </>
  ),
  darts: (
    <>
      <circle cx="12" cy="12" r="9.5" />
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="2.8" />
      <circle cx="12" cy="12" r="0.9" fill="currentColor" />
    </>
  ),
  reading: (
    <>
      <path d="M12 6.5V19.5" />
      <path d="M12 6.5C10.5 5 7.5 4.5 3.5 5V18C7.5 17.5 10.5 18 12 19.5" />
      <path d="M12 6.5C13.5 5 16.5 4.5 20.5 5V18C16.5 17.5 13.5 18 12 19.5" />
    </>
  ),
  other: <circle cx="12" cy="12" r="2.2" fill="currentColor" />,
  spotify: (
    <>
      <path d="M4 14.5V12A8 8 0 0 1 20 12V14.5" />
      <path d="M4 14.5A1.5 1.5 0 0 1 5.5 13H7V19H5.5A1.5 1.5 0 0 1 4 17.5Z" />
      <path d="M20 14.5A1.5 1.5 0 0 0 18.5 13H17V19H18.5A1.5 1.5 0 0 0 20 17.5Z" />
    </>
  ),
  journal: (
    <>
      <path d="M15.5 4.5L19.5 8.5L9 19L4.5 19.5L5 15Z" />
      <path d="M13 7L17 11" />
      <path d="M13 21H21" />
    </>
  ),
  'work-reports': (
    <>
      <path d="M5.5 3H13.5L18.5 8V21H5.5Z" />
      <path d="M13.5 3V8H18.5" />
      <path d="M8.5 12H15.5" />
      <path d="M8.5 15H15.5" />
      <path d="M8.5 18H12.5" />
    </>
  ),
  achievements: (
    <path d="M12 3L14.82 8.62L21.04 9.56L16.56 13.98L17.58 20.18L12 17.3L6.42 20.18L7.44 13.98L2.96 9.56L9.18 8.62Z" />
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
      <path d="M8 3V7" />
      <path d="M16 3V7" />
      <path d="M3.5 10H20.5" />
      <circle cx="12" cy="15" r="1.3" fill="currentColor" />
    </>
  ),
  moments: (
    <path d="M12 3C12.6 8.4 15.6 11.4 21 12C15.6 12.6 12.6 15.6 12 21C11.4 15.6 8.4 12.6 3 12C8.4 11.4 11.4 8.4 12 3Z" />
  ),
  visit: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 20.5C4.5 16.5 8 14.5 12 14.5C16 14.5 19.5 16.5 19.5 20.5" />
    </>
  ),
  'grocery-shopping': (
    <>
      <path d="M3 4H5.2L7.5 15.5H18L20.5 7.5H6" />
      <circle cx="9" cy="20" r="1.4" fill="currentColor" />
      <circle cx="17" cy="20" r="1.4" fill="currentColor" />
    </>
  ),
  shopping: (
    <>
      <path d="M5.5 8H18.5L19.5 20.5H4.5Z" />
      <path d="M9 8V6A3 3 0 0 1 15 6V8" />
    </>
  ),
  'fueling-up': (
    <>
      <path d="M4.5 21V5.5A2 2 0 0 1 6.5 3.5H12.5A2 2 0 0 1 14.5 5.5V21" />
      <path d="M3 21H16" />
      <path d="M7.5 8H11.5" />
      <path d="M14.5 10H16.5A1.5 1.5 0 0 1 18 11.5V17A1.5 1.5 0 0 0 21 17V8.5L18.5 6" />
    </>
  ),
  'car-service': (
    <path d="M16.81 4.2A4.5 4.5 0 0 0 11.19 10.55L4.37 17.37A1.6 1.6 0 0 0 6.63 19.63L13.45 12.81A4.5 4.5 0 0 0 19.8 7.19L17.3 7L15.9 5.6Z" />
  ),
  'eating-out': (
    <>
      <path d="M5.5 3V8" />
      <path d="M8.5 3V8" />
      <path d="M11.5 3V8" />
      <path d="M5.5 8C5.5 10.2 7 11 8.5 11C10 11 11.5 10.2 11.5 8" />
      <path d="M8.5 11V21" />
      <path d="M17.5 21V3C15.5 4.5 14.5 8 15 13H17.5" />
    </>
  ),
  appointment: (
    <>
      <circle cx="12" cy="12" r="9.5" />
      <path d="M12 7.5V16.5" />
      <path d="M7.5 12H16.5" />
    </>
  ),
  errand: (
    <>
      <circle cx="12" cy="12" r="9.5" />
      <path d="M7.5 12.5L10.7 15.7L16.5 9" />
    </>
  ),
  worship: (
    <>
      <path d="M12 3C13.5 6 17.5 9 17.5 14A5.5 5.5 0 0 1 6.5 14C6.5 9 10.5 6 12 3Z" />
      <path d="M9 21.5H15" />
    </>
  ),
};

const LABELS_BY_KEY = {
  work: 'Work',
  'gym-fitness': 'Gym/Fitness',
  sleep: 'Sleep',
  home: 'Home',
  transportation: 'Transportation',
  music: 'Music',
  meals: 'Meals',
  places: 'Places',
  darts: 'Darts',
  reading: 'Reading',
  other: 'Other',
  spotify: 'Spotify',
  journal: 'Journal',
  'work-reports': 'Work Reports',
  achievements: 'Achievements',
  calendar: 'Calendar',
  moments: 'Moments',
  visit: 'Visit',
  'grocery-shopping': 'Grocery shopping',
  shopping: 'Shopping',
  'fueling-up': 'Fueling up',
  'car-service': 'Car service',
  'eating-out': 'Eating out',
  appointment: 'Appointment',
  errand: 'Errand',
  worship: 'Worship',
};

export const ACTIVITY_ICON_LABELS = Object.values(LABELS_BY_KEY);

function kebab(label) {
  return String(label ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Kebab key for a label (case-insensitive); unknown labels map to 'other'.
export function getActivityIconKey(label) {
  const key = kebab(label);
  return Object.hasOwn(ICONS, key) ? key : 'other';
}

// Inner SVG elements (React elements) for a key, for reuse by an image-export path.
export function renderActivityIconPaths(key) {
  return Object.hasOwn(ICONS, key) ? ICONS[key] : ICONS.other;
}

export function ActivityIcon({ label, size = 18, className = '', title }) {
  const key = getActivityIconKey(label);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : 'true'}
      role={title ? 'img' : undefined}
      className={`activity-icon ${className}`.trim()}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      {renderActivityIconPaths(key)}
    </svg>
  );
}
