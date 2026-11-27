import { useEffect, useMemo, useRef, useState } from 'react';
import { useDailyEntries } from '../hooks/useCalendar.js';
import { MIN_QUERY_LENGTH, buildSearchRecords, highlight, kindLabel, searchRecords } from '../utils/search.js';

const RESULT_LIMIT = 50;

function Marked({ text, terms }) {
  return highlight(text, terms).map((part, index) => (part.match ? <mark key={index}>{part.text}</mark> : part.text));
}

/**
 * The results for a query, each a button that opens where it came from. `onOpen(result)` returns false when there's
 * nowhere to go (a day outside the calendar's years), and the result is then shown without a button.
 */
export function SearchResults({ records, query, canOpen = () => true, onOpen }) {
  const { results, total, terms } = useMemo(() => searchRecords(records, query, { limit: RESULT_LIMIT }), [records, query]);
  const trimmed = query.trim();
  if (trimmed.length < MIN_QUERY_LENGTH) return <p className="muted search-hint">Search your day notes, events, weekly reviews, things to do and heights.</p>;
  if (!total) return <p className="muted search-hint" role="status">Nothing found for “{trimmed}”.</p>;
  return (
    <>
      <p className="muted search-count" role="status">
        {total === 1 ? '1 result' : `${total} results`}
        {total > results.length ? `, showing the newest ${results.length}. Add a word to narrow it.` : ''}
      </p>
      <ol className="search-results">
        {results.map((result) => {
          const body = (
            <>
              <span className="search-kind">{kindLabel(result.kind)}{result.when ? ` · ${result.when}` : ''}</span>
              <strong><Marked text={result.title} terms={terms} /></strong>
              {result.snippet && <span className="search-snippet"><Marked text={result.snippet} terms={terms} /></span>}
            </>
          );
          return (
            <li key={result.id} className={`search-${result.kind}`}>
              {onOpen && canOpen(result)
                ? <button type="button" className="search-result" onClick={() => onOpen(result)}>{body}</button>
                : <div className="search-result">{body}</div>}
            </li>
          );
        })}
      </ol>
    </>
  );
}

/**
 * Search across what's been written down. Everything is already small and readable in the browser, so it's searched
 * here rather than through an index; the day notes are only loaded while this is open.
 */
export default function SearchDialog({ calendar, role, events, reviews, plans, measurements, canOpen, onOpen, onClose }) {
  const [query, setQuery] = useState('');
  const inputRef = useRef(null);
  const entryState = useDailyEntries(calendar.id, role, true);
  const records = useMemo(() => buildSearchRecords({
    entries: entryState.entries,
    events,
    reviews,
    plans,
    measurements,
    children: calendar.children || []
  }), [entryState.entries, events, reviews, plans, measurements, calendar.children]);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (event) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop search-backdrop" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <section className="panel modal search-dialog" role="dialog" aria-modal="true" aria-labelledby="search-title">
        <header className="panel-header">
          <h2 id="search-title">Search</h2>
          <button className="ghost" type="button" onClick={onClose}>Close</button>
        </header>
        <form role="search" onSubmit={(event) => event.preventDefault()}>
          <input
            ref={inputRef}
            type="search"
            className="search-input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Pancakes, Muskoka, “first day of school”"
            aria-label="Search"
            enterKeyHint="search"
            autoComplete="off"
          />
        </form>
        {entryState.error && <p className="error">{entryState.error}</p>}
        {entryState.loading && query.trim().length >= MIN_QUERY_LENGTH && <p className="muted search-hint">Loading day notes…</p>}
        <SearchResults records={records} query={query} canOpen={canOpen} onOpen={onOpen} />
      </section>
    </div>
  );
}
