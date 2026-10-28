

const UZBEK_MONTH_NAMES = [
  'Yanvar',
  'Fevral',
  'Mart',
  'Aprel',
  'May',
  'Iyun',
  'Iyul',
  'Avgust',
  'Sentabr',
  'Oktabr',
  'Noyabr',
  'Dekabr'
];

const UZBEK_NUMBER_FORMATTER = new Intl.NumberFormat('uz-UZ', {
  useGrouping: true
});

/**
 *
 * 
 *
 * @param {number|bigint} amount
 * @returns {string}
 */
export function formatUzbekSom(amount) {
  if (typeof amount === 'bigint') {
    return `${UZBEK_NUMBER_FORMATTER.format(amount)} so'm`;
  }
  if (typeof amount !== 'number' || !Number.isSafeInteger(amount)) {
    return '0 so\'m';
  }
  return `${UZBEK_NUMBER_FORMATTER.format(amount)} so'm`;
}

/**
 *
 *
 * @param {string} dateStr
 * @returns {boolean}
 */
export function isValidCalendarDateString(dateStr) {
  if (typeof dateStr !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return false;
  }
  const [yearStr, monthStr, dayStr] = dateStr.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  if (month < 1 || month > 12 || day < 1) {
    return false;
  }
  const isLeap = (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
  const monthDays = [31, isLeap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= monthDays[month - 1];
}

/**
 * Formats a YYYY-MM report month string into Uzbek Latin text (e.g., "2026-yil Oktabr").
 *
 * @param {string} monthStr - Expected format: "YYYY-MM"
 * @returns {string}
 */
export function formatMonthName(monthStr) {
  if (!monthStr || typeof monthStr !== 'string') {
    return '';
  }
  const parts = monthStr.split('-');
  if (parts.length !== 2) {
    return monthStr;
  }
  const year = parts[0];
  const monthIdx = parseInt(parts[1], 10) - 1;
  if (monthIdx >= 0 && monthIdx < 12) {
    return `${year}-yil ${UZBEK_MONTH_NAMES[monthIdx]}`;
  }
  return monthStr;
}

/**
 * Formats an ISO date string or YYYY-MM-DD string cleanly.
 *
 * @param {string} dateStr
 * @returns {string}
 */
export function formatDate(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') {
    return '—';
  }
  // If full timestamp, take the date portion
  return dateStr.substring(0, 10);
}

/**
 * Returns the current local calendar date in exact YYYY-MM-DD format.
 *
 * @returns {string}
 */
export function getCurrentLocalDateString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Returns the current local calendar month in exact YYYY-MM format.
 *
 * @returns {string}
 */
export function getCurrentLocalMonthString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

export { parsePaymentAmount, parseMonthlyFee } from './amountParser.js';

