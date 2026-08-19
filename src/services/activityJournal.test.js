import { describe, expect, it } from 'vitest';
import { isJournalOrMediaLifeEvent } from './activityJournal.js';

const journal = {
  sourceApp: 'gridlineai',
  sourceFirebaseProjectId: 'gridlineai',
  sourceProjectId: 'home',
  eventType: 'journal',
  title: 'Journal Entry'
};

describe('private activity journal candidate selection', () => {
  it('includes only supported GridlineAI journal and media canonicals', () => {
    expect(isJournalOrMediaLifeEvent(journal)).toBe(true);
    expect(isJournalOrMediaLifeEvent({ ...journal, eventType: 'image', title: 'Photo' })).toBe(true);
    expect(isJournalOrMediaLifeEvent({ ...journal, sourceApp: 'spotify' })).toBe(false);
    expect(isJournalOrMediaLifeEvent({ ...journal, eventType: 'work', title: 'Arrived at work' })).toBe(false);
  });

  it('rejects legacy Firebase app IDs without weakening the resolver', () => {
    expect(isJournalOrMediaLifeEvent({
      ...journal,
      sourceFirebaseProjectId: '1:118761010772:web:example'
    })).toBe(false);
    expect(isJournalOrMediaLifeEvent({
      ...journal,
      sourceProjectId: '1:118761010772:web:example'
    })).toBe(false);
  });
});
