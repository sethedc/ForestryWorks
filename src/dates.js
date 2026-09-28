import { config } from './config.js';

/** YYYY-MM-DD in the configured timezone, which is what the date field stores. */
export function attemptDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: config.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(now);
}

/**
 * CURRENT_SEMESTER wins when set. Otherwise January through June is Spring and
 * July through December is Fall, matching the options on the Semester field.
 */
export function semesterFor(dateString) {
  if (config.currentSemester) return config.currentSemester;
  const [year, month] = String(dateString).split('-').map(Number);
  return `${month <= 6 ? 'Spring' : 'Fall'} ${year}`;
}
