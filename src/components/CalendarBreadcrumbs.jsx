export default function CalendarBreadcrumbs({ items }) {
  return (
    <nav className="breadcrumbs" aria-label="Calendar navigation">
      {items.map((item, index) => (
        <span key={`${item.label}-${index}`}>
          {index > 0 && <b>›</b>}
          <button className="text-button" type="button" onClick={item.onClick} disabled={!item.onClick}>
            {item.label}
          </button>
        </span>
      ))}
    </nav>
  );
}
