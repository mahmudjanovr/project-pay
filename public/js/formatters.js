

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
 * Formats a YYYY-MM month string into friendly Uzbek Latin month text (e.g. "Oktabr 2026").
 *
 * @param {string} monthStr - Expected format: "YYYY-MM"
 * @returns {string}
 */
export function formatFriendlyMonthUzbek(monthStr) {
  if (!monthStr || typeof monthStr !== 'string') {
    return '';
  }
  const trimmed = monthStr.trim();
  const parts = trimmed.split('-');
  if (parts.length === 2) {
    const year = parts[0];
    const monthIdx = parseInt(parts[1], 10) - 1;
    if (monthIdx >= 0 && monthIdx < 12) {
      return `${UZBEK_MONTH_NAMES[monthIdx]} ${year}`;
    }
  }
  return monthStr;
}

/**
 * Formats a calendar date (YYYY-MM-DD or ISO timestamp) into Uzbek Latin format (DD.MM.YYYY).
 *
 * @param {string} dateStr
 * @returns {string}
 */
export function formatDateUzbek(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') {
    return '—';
  }
  const clean = dateStr.trim().substring(0, 10);
  const matchIso = clean.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (matchIso) {
    const [, year, month, day] = matchIso;
    return `${day}.${month}.${year}`;
  }
  return dateStr;
}

/**
 * Parses user date input in DD.MM.YYYY (or DD/MM/YYYY, DD-MM-YYYY) or YYYY-MM-DD format.
 * Validates actual calendar boundaries (leap years, 30 vs 31 days).
 *
 * @param {string} inputStr
 * @returns {{ valid: true, isoDate: string, displayDate: string } | { valid: false, error: string }}
 */
export function parseDateInput(inputStr) {
  if (!inputStr || typeof inputStr !== 'string' || !inputStr.trim()) {
    return {
      valid: false,
      error: 'Iltimos, to\'lov sanasini kiriting (KK.OO.YYYY, masalan: 28.10.2026).'
    };
  }

  const str = inputStr.trim();

  let year, month, day;

  // Pattern 1: DD.MM.YYYY or DD/MM/YYYY or DD-MM-YYYY
  const matchUz = str.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (matchUz) {
    day = parseInt(matchUz[1], 10);
    month = parseInt(matchUz[2], 10);
    year = parseInt(matchUz[3], 10);
  } else {
    // Pattern 2: YYYY-MM-DD or YYYY.MM.DD or YYYY/MM/DD
    const matchIso = str.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/);
    if (matchIso) {
      year = parseInt(matchIso[1], 10);
      month = parseInt(matchIso[2], 10);
      day = parseInt(matchIso[3], 10);
    } else {
      return {
        valid: false,
        error: 'Iltimos, haqiqiy taqvim sanasini kiriting (KK.OO.YYYY yoki YYYY-MM-DD).'
      };
    }
  }

  if (month < 1 || month > 12 || day < 1 || year < 1900 || year > 2100) {
    return {
      valid: false,
      error: 'Iltimos, haqiqiy taqvim sanasini kiriting (KK.OO.YYYY yoki YYYY-MM-DD).'
    };
  }

  const isLeap = (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
  const monthDays = [31, isLeap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (day > monthDays[month - 1]) {
    return {
      valid: false,
      error: 'Iltimos, haqiqiy taqvim sanasini kiriting (KK.OO.YYYY yoki YYYY-MM-DD).'
    };
  }

  const pad = (n) => String(n).padStart(2, '0');
  const isoDate = `${year}-${pad(month)}-${pad(day)}`;
  const displayDate = `${pad(day)}.${pad(month)}.${year}`;

  return {
    valid: true,
    isoDate,
    displayDate
  };
}

/**
 * Parses user billing month input in YYYY-MM (or MM.YYYY, MM/YYYY) format.
 *
 * @param {string} inputStr
 * @returns {{ valid: true, month: string } | { valid: false, error: string }}
 */
export function parseBillingMonthInput(inputStr) {
  if (!inputStr || typeof inputStr !== 'string' || !inputStr.trim()) {
    return {
      valid: false,
      error: 'Iltimos, to\'lov hisoblangan oyni to\'g\'ri tanlang (YYYY-MM, masalan: 2026-10).'
    };
  }

  const str = inputStr.trim();

  // Pattern 1: YYYY-MM
  const matchIso = str.match(/^(\d{4})-(0[1-9]|1[0-2])$/);
  if (matchIso) {
    return { valid: true, month: str };
  }

  // Pattern 2: MM.YYYY or MM/YYYY
  const matchRev = str.match(/^(0[1-9]|1[0-2])[./](\d{4})$/);
  if (matchRev) {
    return { valid: true, month: `${matchRev[2]}-${matchRev[1]}` };
  }

  return {
    valid: false,
    error: 'Iltimos, to\'lov hisoblangan oyni to\'g\'ri tanlang (YYYY-MM, masalan: 2026-10).'
  };
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

