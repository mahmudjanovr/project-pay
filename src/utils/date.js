/**
 * Date utility functions for Ecomdev.
 * Enforces calendar validity, leap-year calculations, and report month boundary resolution.
 */

/**
 * Determines whether a given year is a leap year according to Gregorian calendar rules.
 * A year is a leap year if divisible by 4, except end-of-century years which must be divisible by 400.
 *
 * @param {number} year - The integer year to check.
 * @returns {boolean} True if leap year, false otherwise.
 */
export function isLeapYear(year) {
  if (!Number.isSafeInteger(year)) {
    return false;
  }
  return (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
}

/**
 * Returns the maximum number of days in a given month for a specified year.
 *
 * @param {number} year - The integer year.
 * @param {number} month - The 1-based month index (1 = Jan, 12 = Dec).
 * @returns {number} Days in month, or 0 if month is invalid.
 */
export function getDaysInMonth(year, month) {
  if (!Number.isSafeInteger(year) || !Number.isSafeInteger(month)) {
    return 0;
  }
  switch (month) {
    case 1: // January
    case 3: // March
    case 5: // May
    case 7: // July
    case 8: // August
    case 10: // October
    case 12: // December
      return 31;
    case 4: // April
    case 6: // June
    case 9: // September
    case 11: // November
      return 30;
    case 2: // February
      return isLeapYear(year) ? 29 : 28;
    default:
      return 0;
  }
}

/**
 * Strictly validates whether a string is a canonical ISO calendar date in YYYY-MM-DD format
 * with real calendar validity (rejecting impossible dates such as 2023-02-29 or 2024-04-31).
 *
 * @param {string} str - The date string to validate.
 * @returns {boolean} True if canonical and valid, false otherwise.
 */
export function isValidCalendarDate(str) {
  if (typeof str !== 'string') {
    return false;
  }
  // Require exact YYYY-MM-DD: exactly 4 digits, hyphen, 2-digit month 01-12, hyphen, 2-digit day 01-31
  const match = str.match(/^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/);
  if (!match) {
    return false;
  }
  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);

  const maxDays = getDaysInMonth(year, month);
  return day >= 1 && day <= maxDays;
}

/**
 * Strictly validates whether a string is a canonical report month in YYYY-MM format
 * where month is between 01 and 12.
 *
 * @param {string} str - The report month string.
 * @returns {boolean} True if valid, false otherwise.
 */
export function isValidReportMonth(str) {
  if (typeof str !== 'string') {
    return false;
  }
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(str);
}

/**
 * Calculates the exact half-open interval [startOfMonth, startOfNextMonth) for a given YYYY-MM report month.
 *
 * @param {string} reportMonth - Canonical YYYY-MM string.
 * @returns {{ startOfMonth: string, startOfNextMonth: string }}
 * @throws {Error} If reportMonth format is invalid.
 */
export function getMonthDateRange(reportMonth) {
  if (!isValidReportMonth(reportMonth)) {
    throw new Error(`Invalid report month: "${reportMonth}". Expected exact YYYY-MM format.`);
  }

  const [yearStr, monthStr] = reportMonth.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);

  const startOfMonth = `${reportMonth}-01`;
  const lastDay = String(getDaysInMonth(year, month)).padStart(2, '0');
  const endOfMonth = `${reportMonth}-${lastDay}`;

  let nextYear = year;
  let nextMonth = month + 1;
  if (nextMonth > 12) {
    nextMonth = 1;
    nextYear += 1;
  }

  const nextMonthPadded = String(nextMonth).padStart(2, '0');
  const startOfNextMonth = `${String(nextYear).padStart(4, '0')}-${nextMonthPadded}-01`;

  return { startOfMonth, endOfMonth, startOfNextMonth };
}

/**
 * Returns current timestamp as an ISO-8601 UTC string (e.g., 2026-10-26T11:15:00.000Z).
 *
 * @returns {string}
 */
export function getCurrentUtcIsoString() {
  return new Date().toISOString();
}

/**
 * Canonical SQL expression that resolves a student's effective enrollment month (YYYY-MM).
 * Strictly validates that enrollment_date is a real calendar date (YYYY-MM-DD or YYYY-MM),
 * safely falling back to created_at month for null, empty, malformed, or impossible dates.
 */
export const EFFECTIVE_ENROLLMENT_MONTH_SQL = `
  CASE
    WHEN s.enrollment_date GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'
     AND date(s.enrollment_date) IS NOT NULL
     AND date(s.enrollment_date) = s.enrollment_date
    THEN substr(s.enrollment_date, 1, 7)
    WHEN s.enrollment_date GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'
     AND date(s.enrollment_date || '-01') IS NOT NULL
     AND date(s.enrollment_date || '-01') = (s.enrollment_date || '-01')
    THEN s.enrollment_date
    ELSE substr(s.created_at, 1, 7)
  END
`.trim();
