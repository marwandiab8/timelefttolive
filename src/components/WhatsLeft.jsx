import { parseDateId } from '../utils/dateUtils.js';
import { getLifeAhead } from '../utils/whatsLeft.js';

const number = (value) => Number(value).toLocaleString();
const plural = (count, one, many) => (count === 1 ? one : many);

/** The words for what is still ahead, kept apart from the markup so they can be tested, like the life summary. */
export function describeWhatsLeft(ahead) {
  return {
    label: `Still ahead, before ${ahead.targetAge}`,
    facts: [
      { value: number(ahead.weekends), label: plural(ahead.weekends, 'weekend', 'weekends') },
      { value: number(ahead.summers), label: plural(ahead.summers, 'summer', 'summers') },
      { value: number(ahead.christmases), label: plural(ahead.christmases, 'Christmas', 'Christmases') },
      { value: number(ahead.birthdays), label: plural(ahead.birthdays, 'birthday', 'birthdays') }
    ]
  };
}

export default function WhatsLeft({ calendar, today }) {
  const { label, facts } = describeWhatsLeft(getLifeAhead(calendar, parseDateId(today)));
  return (
    <section className="whats-left" aria-label={label}>
      <p className="whats-left-label">{label}</p>
      <ul>
        {facts.map((fact) => (
          <li key={fact.label}>
            <strong>{fact.value}</strong>
            <span>{fact.label}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
