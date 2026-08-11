/**
 * weeks.js — ET-anchored Monday-based week utilities.
 * All week boundaries are Monday 00:00 ET – Sunday 23:59:59 ET.
 */
const TZ = 'America/New_York';

/** Returns a Date representing Monday 00:00 ET for the week containing `date`. */
export function mondayOf(date) {
  const etStr = date.toLocaleDateString('en-CA', { timeZone: TZ }); // YYYY-MM-DD
  const [y, m, d] = etStr.split('-').map(Number);
  // day-of-week in ET (0=Sun, 1=Mon, ... 6=Sat)
  const dow = new Date(`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}T12:00:00`).getDay();
  const offsetToMonday = (dow === 0) ? -6 : (1 - dow); // if Sunday, go back 6; else go back to Monday
  const monday = new Date(`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}T00:00:00`);
  monday.setDate(monday.getDate() + offsetToMonday);
  return monday;
}

/** Returns { start, end } ISO strings for the Mon–Sun week starting at `monday`. */
export function weekBounds(monday) {
  const start = new Date(monday);
  const end = new Date(monday);
  end.setDate(end.getDate() + 7);
  return { start: start.toISOString(), end: end.toISOString() };
}

/** Returns array of Monday Date objects from floorMonday to currentMonday, ascending. */
export function listWeeks(floorMonday, currentMonday) {
  const weeks = [];
  const cur = new Date(floorMonday);
  while (cur <= currentMonday) {
    weeks.push(new Date(cur));
    cur.setDate(cur.getDate() + 7);
  }
  return weeks;
}

/** Short label for X-axis ticks, e.g. "Jun 8". */
export function formatWeekLabel(monday) {
  return new Date(monday).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: TZ });
}

/** Full label for tooltips, e.g. "Jun 8 – 14, 2026". */
export function formatWeekRange(monday) {
  const start = new Date(monday);
  const end = new Date(monday);
  end.setDate(end.getDate() + 6);
  const s = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: TZ });
  const e = end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: TZ });
  return `${s} – ${e}`;
}
