/**
 * Formatting and date utility functions for the Project Pay frontend.
 */

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

/**
 * Formats a monetary integer amount into Uzbek Som string format (e.g., "1 250 000 so'm").
 *
 * @param {number} amount
 * @returns {string}
 */
export function formatUzbekSom(amount) {
  if (typeof amount !== 'number' || !Number.isSafeInteger(amount)) {
    return '0 so\'m';
  }
  // Group thousands with spaces as per Uzbek accounting convention
  const formattedNumber = new Intl.NumberFormat('uz-UZ', {
    useGrouping: true
  }).format(amount);

  return `${formattedNumber} so'm`;
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

export { parsePaymentAmount } from './amountParser.js';

