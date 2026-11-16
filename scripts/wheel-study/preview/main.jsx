// Interactive preview of the real LifeWheel with made-up data, outside Firebase. Built with
// vite.preview.config.js into ~/.cache/wheel-preview-app and served on 127.0.0.1 for screenshots.
import { StrictMode, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../../src/styles/activity-cycle.css';
import { LifeWheel, MiniWheel } from '../../../src/components/LifeWheel.jsx';
import { ActivityIcon } from '../../../src/components/activityIcons.jsx';
import { getCategoryDefinition, getPeriodBounds, formatDuration } from '../../../src/utils/lifeEventUtils.js';
import { exportWheelImage, renderWheelPng } from '../../../src/utils/wheelImage.js';

const H = 3600;
const bounds = getPeriodBounds('day', '2026-11-03');
const dayStart = bounds.start.getTime();
const hour = (h) => dayStart + h * H * 1000;

function session(id, category, from, to, extra = {}) {
  return { id, category, title: extra.title || category, startAt: new Date(hour(from)), endAt: new Date(hour(to)), durationSeconds: (to - from) * H, allocatedSeconds: (to - from) * H, fragments: [{ start: hour(from), end: hour(to) }], active: false, location: extra.location || '', ...extra };
}

const sessions = [
  session('sleep', 'Sleep', 0, 3.6, { nightStartAt: new Date(hour(-1.15)), attributedSeconds: 4.75 * H, allocatedSeconds: 4.75 * H, durationSeconds: 4.75 * H }),
  session('drive1', 'Transportation', 6.4, 6.9),
  session('work', 'Work', 6.9, 15.3, { location: 'Docksteader site' }),
  session('drive2', 'Transportation', 15.3, 15.7),
  session('gym', 'Gym/Fitness', 15.8, 17.1, { location: 'GoodLife' }),
  session('meal', 'Meals', 17.3, 18),
  session('home', 'Home', 18, 21.1, { active: true, endAt: new Date(hour(21.1)) }),
  session('darts', 'Darts', 19, 19.5),
  session('music', 'Music', 8, 9.2),
  session('places', 'Places', 21.2, 21.3)
];

function categoriesOf(list) {
  const map = new Map();
  list.forEach((item) => {
    const definition = getCategoryDefinition(item.category);
    const group = map.get(item.category) || { ...definition, label: item.category, seconds: 0, sessions: [], allSessions: [], nestedSessions: [] };
    group.seconds += item.allocatedSeconds;
    group.sessions.push(item);
    group.allSessions.push(item);
    map.set(item.category, group);
  });
  return [...map.values()].sort((a, b) => b.seconds - a.seconds);
}

const momentGroups = [
  { id: 'j1', pointCategory: 'Journal', category: 'Notes', title: 'Morning note', count: 1, firstAt: new Date(hour(7.2)) },
  { id: 's1', pointCategory: 'Spotify', category: 'Music', title: 'Song one', count: 2, firstAt: new Date(hour(8.1)) },
  { id: 's2', pointCategory: 'Spotify', category: 'Music', title: 'Song two', count: 1, firstAt: new Date(hour(8.4)) },
  { id: 'a1', pointCategory: 'Achievements', category: 'Achievements', title: 'Bench PR', count: 1, firstAt: new Date(hour(16.5)) },
  { id: 'c1', pointCategory: 'Calendar', category: 'Calendar', title: 'With Ashley', count: 1, firstAt: new Date(hour(12)) }
];
const pointCategories = [
  { label: 'Spotify', color: '#db75a6' }, { label: 'Journal', color: '#9a88d4' }, { label: 'Achievements', color: '#efb84e' }, { label: 'Calendar', color: '#e0565b' }
];

const dayAnalysis = (() => {
  const categories = categoriesOf(sessions);
  return { categories, sessionCategories: categories, pointCategories, momentGroups, allocatedSessions: sessions, timedSeconds: categories.reduce((t, c) => t + c.seconds, 0), activeCount: 1 };
})();
const weekSessions = sessions.map((item) => ({ ...item, allocatedSeconds: item.allocatedSeconds * 5.3 }));
const weekAnalysis = (() => { const categories = categoriesOf(weekSessions).filter((c) => c.label !== 'Places'); return { categories, sessionCategories: categories, pointCategories, momentGroups: [], allocatedSessions: [], timedSeconds: categories.reduce((t, c) => t + c.seconds, 0), activeCount: 0 }; })();
const beads = momentGroups.map((group) => ({ id: group.id, label: group.pointCategory, color: pointCategories.find((p) => p.label === group.pointCategory).color, at: group.firstAt, title: group.title, count: group.count, segmentLabel: group.category }));
const previous = new Map([['Work', 9.1 * H], ['Sleep', 7.2 * H], ['Home', 2 * H], ['Gym/Fitness', 0.9 * H], ['Transportation', 1.1 * H], ['Meals', 0.6 * H], ['Darts', 1.2 * H], ['Music', 0.4 * H]]);
const targets = new Map([['Sleep', { ringSeconds: 7 * H, met: false, text: '2h 15m under your 7h goal' }], ['Work', { ringSeconds: 9 * H, met: true, text: '36m under your 9h limit' }]]);

function App() {
  const [theme, setTheme] = useState(new URLSearchParams(location.search).get('theme') || 'dark');
  const [layout, setLayout] = useState('share');
  const [compare, setCompare] = useState('none');
  const [untracked, setUntracked] = useState(true);
  const [period, setPeriod] = useState('day');
  const [selected, setSelected] = useState(null);
  const [now] = useState(() => new Date(hour(21.1)));
  const [exported, setExported] = useState('');
  async function showExport() {
    const png = await renderWheelPng({ svg: document.querySelector('.life-wheel svg'), title: selected || 'Today', total: formatDuration(categoryAnalysis ? categoryAnalysis.totalSeconds : analysis.timedSeconds), subtitle: selected ? '1 session' : 'tracked time', caption: 'Tuesday, November 3, 2026 · 20h 57m · Work 8h 24m, Sleep 4h 45m, Home 3h 6m', theme, size: 1024 });
    setExported(URL.createObjectURL(png));
  }
  const analysis = period === 'day' ? dayAnalysis : weekAnalysis;
  const categoryAnalysis = useMemo(() => {
    const category = analysis.categories.find((c) => c.label === selected);
    return category ? { ...category, totalSeconds: category.seconds, sessionCount: category.sessions.length, activeSession: category.sessions.find((s) => s.active) || null } : null;
  }, [analysis, selected]);
  const svgRef = { current: null };
  return (
    <main className="activity-dashboard activity-cycle" data-theme={theme} style={{ '--activity-focus': categoryAnalysis?.color || '#65d6ad' }}>
      <section className={`cycle-hero ${selected ? 'has-selection' : ''}`}>
        <div className="cycle-wheel-stage">
          <div className="cycle-wheel-tools">
            <div className="cycle-segmented" role="group"><button type="button" className={period === 'day' ? 'selected' : ''} onClick={() => setPeriod('day')}>Day</button><button type="button" className={period === 'week' ? 'selected' : ''} onClick={() => setPeriod('week')}>Week</button></div>
            {period === 'day' && <div className="cycle-segmented" role="group"><button type="button" className={layout === 'share' ? 'selected' : ''} onClick={() => setLayout('share')}>Share</button><button type="button" className={layout === 'clock' ? 'selected' : ''} onClick={() => setLayout('clock')}>Clock</button></div>}
            <div className="cycle-segmented" role="group"><span>Compare</span><button type="button" className={compare === 'none' ? 'selected' : ''} onClick={() => setCompare('none')}>None</button><button type="button" className={compare === 'previous' ? 'selected' : ''} onClick={() => setCompare('previous')}>Previous</button><button type="button" disabled>Normal</button></div>
            <button type="button" className={`cycle-tool-toggle ${untracked ? 'selected' : ''}`} onClick={() => setUntracked((v) => !v)}>Untracked time</button>
            <button type="button" className="cycle-tool-action" onClick={() => exportWheelImage({ svg: document.querySelector('.life-wheel svg'), title: 'Today', total: formatDuration(analysis.timedSeconds), caption: 'Tuesday, November 3, 2026 · preview', theme, fileName: 'preview.png' })}>Save as image</button>
            <button type="button" className="cycle-tool-action" onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}>{theme === 'dark' ? 'Light' : 'Dark'}</button>
            <button type="button" className="cycle-tool-action" onClick={showExport}>Show export</button>
          </div>
          {exported && <img alt="Export preview" src={exported} style={{ position: 'fixed', right: 12, bottom: 12, width: 360, zIndex: 9, border: '1px solid #888', borderRadius: 12 }} onClick={() => setExported('')} />}
          <LifeWheel
            analysis={analysis}
            bounds={period === 'day' ? bounds : getPeriodBounds('week', '2026-11-03')}
            categoryAnalysis={categoryAnalysis}
            now={now}
            onSelect={(label) => setSelected((current) => (current === label ? null : label))}
            period={period}
            pointAnalysis={null}
            selectedLabel={selected}
            title={period === 'day' ? 'Today' : 'This Week'}
            theme={theme}
            layout={layout}
            compare={compare}
            compareSeconds={compare === 'previous' ? previous : null}
            showUntracked={untracked}
            beads={period === 'day' ? beads : []}
            targets={targets}
            targetText={categoryAnalysis ? targets.get(categoryAnalysis.label)?.text || '' : ''}
            svgRef={svgRef}
          />
        </div>
        <aside className="cycle-glance">
          <div className="cycle-glance-copy">
            <p className="cycle-eyebrow">At a glance</p>
            <h2>{selected ? <><ActivityIcon label={selected} size={34} /> {selected}</> : 'Today'}</h2>
            <p className="cycle-reflection">Work accounted for the largest share of tracked time at 8h 24m. 1 session is still in progress.</p>
            <ul className="cycle-facts">
              <li><ActivityIcon label="Darts" size={15} /><div><strong>Darts 4 days in a row</strong><span>Every day since Oct 31, 3h 10m in all</span></div></li>
              <li><ActivityIcon label="Gym/Fitness" size={15} /><div><strong>Third gym visit this week</strong><span>Also on Nov 1, Nov 2; 1h 18m today</span></div></li>
            </ul>
          </div>
          {period === 'week' && <div className="cycle-mini-wheels">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d, i) => <MiniWheel key={d} label={d} categories={i === 5 ? [] : dayAnalysis.categories} onClick={() => setPeriod('day')} />)}</div>}
          <div className="cycle-legend">
            {analysis.categories.map((category) => (
              <button className={selected === category.label ? 'selected' : ''} key={category.label} type="button" onClick={() => setSelected((current) => (current === category.label ? null : category.label))}>
                <i style={{ background: category.color }} /><span><ActivityIcon label={category.label} size={16} /> {category.label}</span><strong>{formatDuration(category.seconds)}</strong>
              </button>
            ))}
          </div>
        </aside>
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>);
