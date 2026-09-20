const number = (value) => Number(value).toLocaleString();

/**
 * The words for the calendar's summary, kept apart from the markup so the
 * singular, plural and "already there" cases can be tested.
 */
export function describeLifeSummary(stats) {
  const weeks = Math.max(0, Number(stats.weeksRemaining) || 0);
  const reached = weeks === 0;
  return {
    headline: reached
      ? { number: '0', unit: 'weeks left' }
      : { number: number(weeks), unit: weeks === 1 ? 'week left' : 'weeks left' },
    sentence: reached
      ? `You have reached ${stats.targetAge}.`
      : `You are ${stats.currentAge}, aiming for ${stats.targetAge}.`,
    lived: Math.min(100, Math.max(0, Number(stats.percentageUsed) || 0)),
    facts: [
      { label: 'Weeks lived', value: number(stats.weeksLived) },
      { label: 'Days remaining', value: number(stats.daysRemaining) },
      { label: 'Life remaining', value: `${Number(stats.percentageRemaining).toFixed(1)}%` }
    ]
  };
}

export default function LifeSummary({ stats }) {
  const { headline, sentence, lived, facts } = describeLifeSummary(stats);
  return (
    <section className="life-summary" aria-label="Life summary">
      <h2 className="life-summary-headline">{headline.number} {headline.unit}</h2>
      <p className="life-summary-sentence">{sentence}</p>
      <div
        className="life-summary-bar"
        role="img"
        aria-label={`${lived.toFixed(1)}% of the way to ${stats.targetAge}`}
      >
        <span style={{ width: `${lived}%` }} />
      </div>
      <dl className="life-summary-facts">
        {facts.map((fact) => (
          <div key={fact.label}>
            <dt>{fact.label}</dt>
            <dd>{fact.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
