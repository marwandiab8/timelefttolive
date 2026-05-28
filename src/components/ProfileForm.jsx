import { useState } from 'react';
import { defaultSettings, saveCalendar } from '../hooks/useCalendar.js';
import { defaultCustodySchedule } from '../utils/custodyUtils.js';

const blankChild = () => ({ id: crypto.randomUUID(), name: '', birthDate: '' });

export default function ProfileForm({ user, calendar, onSaved }) {
  const [form, setForm] = useState({
    firstName: calendar?.firstName || '',
    lastName: calendar?.lastName || '',
    birthDate: calendar?.birthDate || '',
    targetAge: calendar?.targetAge || 90,
    spouse: calendar?.spouse || { name: '', birthDate: '' },
    children: calendar?.children?.length ? calendar.children : [],
    custodySchedule: { ...defaultCustodySchedule, ...(calendar?.custodySchedule || {}) },
    settings: { ...defaultSettings, ...(calendar?.settings || {}) }
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function updateChild(index, field, value) {
    setForm((current) => ({
      ...current,
      children: current.children.map((child, childIndex) => childIndex === index ? { ...child, [field]: value } : child)
    }));
  }

  function updateCustody(field, value) {
    setForm((current) => ({
      ...current,
      custodySchedule: { ...current.custodySchedule, [field]: value }
    }));
  }

  function toggleCustodyChild(childId) {
    setForm((current) => {
      const selected = current.custodySchedule.childIds || [];
      return {
        ...current,
        custodySchedule: {
          ...current.custodySchedule,
          childIds: selected.includes(childId)
            ? selected.filter((id) => id !== childId)
            : [...selected, childId]
        }
      };
    });
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    if (!form.birthDate) return setError('Birth date is required.');
    if (Number(form.targetAge) < 1 || Number(form.targetAge) > 130) return setError('Target age must be between 1 and 130.');
    if (form.children.some((child) => (child.name && !child.birthDate) || (!child.name && child.birthDate))) {
      return setError('Each child needs both a name and birth date.');
    }
    if (form.custodySchedule.enabled && !form.custodySchedule.nextStartDate) {
      return setError('Enter the start date of the next week you have the kids.');
    }
    if (form.custodySchedule.enabled && form.custodySchedule.childIds.length === 0) {
      return setError('Choose which children the parenting-time schedule applies to.');
    }
    if (form.custodySchedule.enabled && Number(form.custodySchedule.withParentWeeks) > Number(form.custodySchedule.cycleWeeks)) {
      return setError('Time with you per cycle cannot be greater than the full cycle length.');
    }
    setSaving(true);
    try {
      await saveCalendar(user.uid, calendar?.id, form);
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="form-grid" onSubmit={handleSubmit}>
      <label>First name<input value={form.firstName} onChange={(event) => updateField('firstName', event.target.value)} required /></label>
      <label>Last name<input value={form.lastName} onChange={(event) => updateField('lastName', event.target.value)} required /></label>
      <label>Date of birth<input value={form.birthDate} onChange={(event) => updateField('birthDate', event.target.value)} type="date" required /></label>
      <label>Target age<input value={form.targetAge} onChange={(event) => updateField('targetAge', event.target.value)} type="number" min="1" max="130" required /></label>

      <fieldset>
        <legend>Spouse</legend>
        <label>Name<input value={form.spouse.name} onChange={(event) => updateField('spouse', { ...form.spouse, name: event.target.value })} /></label>
        <label>Date of birth<input value={form.spouse.birthDate} onChange={(event) => updateField('spouse', { ...form.spouse, birthDate: event.target.value })} type="date" /></label>
      </fieldset>

      <fieldset className="wide">
        <legend>Children</legend>
        {form.children.map((child, index) => (
          <div className="inline-row" key={child.id}>
            <input value={child.name} onChange={(event) => updateChild(index, 'name', event.target.value)} placeholder="Name" />
            <input value={child.birthDate} onChange={(event) => updateChild(index, 'birthDate', event.target.value)} type="date" />
            <button type="button" className="ghost" onClick={() => updateField('children', form.children.filter((item) => item.id !== child.id))}>Remove</button>
          </div>
        ))}
        <button type="button" className="secondary" onClick={() => updateField('children', [...form.children, blankChild()])}>Add child</button>
      </fieldset>

      <fieldset className="wide parenting-grid">
        <legend>Time with my boys</legend>
        <label className="checkbox-row">
          <input
            checked={form.custodySchedule.enabled}
            onChange={(event) => updateCustody('enabled', event.target.checked)}
            type="checkbox"
          />
          Track every-other-week parenting time
        </label>
        <label>Next week with them starts
          <input
            value={form.custodySchedule.nextStartDate}
            onChange={(event) => updateCustody('nextStartDate', event.target.value)}
            type="date"
          />
        </label>
        <label>Every
          <input
            value={form.custodySchedule.cycleWeeks}
            onChange={(event) => updateCustody('cycleWeeks', event.target.value)}
            type="number"
            min="1"
            max="8"
          />
          weeks
        </label>
        <label>Time with me per cycle
          <input
            value={form.custodySchedule.withParentWeeks}
            onChange={(event) => updateCustody('withParentWeeks', event.target.value)}
            type="number"
            min="1"
            max="8"
          />
          week(s)
        </label>
        <label>Count until each child turns
          <input
            value={form.custodySchedule.countUntilChildAge}
            onChange={(event) => updateCustody('countUntilChildAge', event.target.value)}
            type="number"
            min="1"
            max="40"
          />
        </label>
        <div className="wide child-picker">
          {form.children.length === 0 && <p className="muted">Add children above before choosing who this applies to.</p>}
          {form.children.map((child) => (
            <label className="checkbox-row" key={child.id}>
              <input
                checked={(form.custodySchedule.childIds || []).includes(child.id)}
                onChange={() => toggleCustodyChild(child.id)}
                type="checkbox"
              />
              {child.name || 'Unnamed child'}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="wide color-grid">
        <legend>Colors</legend>
        {Object.entries(form.settings).map(([key, value]) => (
          <label key={key}>{key.replace(/([A-Z])/g, ' $1')}<input value={value} type="color" onChange={(event) => updateField('settings', { ...form.settings, [key]: event.target.value })} /></label>
        ))}
      </fieldset>

      {error && <p className="error wide">{error}</p>}
      <button className="primary wide" type="submit" disabled={saving}>{saving ? 'Saving...' : 'Save calendar'}</button>
    </form>
  );
}
