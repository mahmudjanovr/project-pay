/**
 * Financial Amount Parsing and Validation Utility for Project Pay.
 * Strict parser for UZS monetary amounts supporting plain digits, comma-separated thousands,
 * and space-separated thousands, while strictly rejecting decimals, zero, negatives, and malformed separators.
 */

import { formatUzbekSom } from './formatters.js';

// Regex for pure integer digits without separators (1 or more digits)
const PURE_DIGITS_REGEX = /^\d+$/;

// Regex for standard comma-grouped thousands: 1-3 digits followed by groups of exactly 3 digits
// e.g. 1,000; 120,000; 1,200,000
const COMMA_GROUPED_REGEX = /^[1-9]\d{0,2}(,\d{3})+$/;

// Regex for space-grouped thousands: 1-3 digits followed by groups of exactly 3 digits
// e.g. 1 000; 120 000; 1 200 000 (supports space, NBSP \u00A0, and narrow NBSP \u202F)
const SPACE_GROUPED_REGEX = /^[1-9]\d{0,2}([ \u00A0\u202F]\d{3})+$/;

/**
 * Result returned by monetary amount parsers.
 * @typedef {Object} ParseResult
 * @property {boolean} valid - Whether the amount is a valid safe integer within allowed bounds.
 * @property {number} [value] - Parsed integer value (if valid).
 * @property {string} [formatted] - Formatted Uzbek Som string (if valid).
 * @property {string} [error] - Localized Uzbek error message (if invalid).
 */

/**
 * Shared strict UZS integer parser supporting plain digits, comma-grouped thousands,
 * and space-grouped thousands without decimals or silent coercion.
 *
 * @param {string|number|null|undefined} input
 * @param {{ allowZero: boolean, emptyError: string, minError: string, decimalError: string, digitsOnlyError: string }} options
 * @returns {ParseResult}
 */
function parseUzsIntegerAmount(input, { allowZero, emptyError, minError, decimalError, digitsOnlyError }) {
  if (input === null || input === undefined) {
    return { valid: false, error: emptyError };
  }

  // Reject non-finite numbers or booleans before stringifying
  if (typeof input === 'boolean' || (typeof input === 'number' && !Number.isFinite(input))) {
    return { valid: false, error: digitsOnlyError };
  }

  // Convert input to string and trim leading/trailing whitespace
  const raw = String(input).trim();

  if (raw === '') {
    return { valid: false, error: emptyError };
  }

  // Reject negative numbers (and -0)
  if (raw.startsWith('-') || Object.is(input, -0)) {
    return { valid: false, error: minError };
  }

  // Reject explicit decimal point (tiyinlar)
  if (raw.includes('.')) {
    return { valid: false, error: decimalError };
  }

  let cleanDigits = '';

  if (PURE_DIGITS_REGEX.test(raw)) {
    if (raw === '0') {
      if (!allowZero) {
        return { valid: false, error: minError };
      }
      return {
        valid: true,
        value: 0,
        formatted: formatUzbekSom(0)
      };
    }
    if (/^0+$/.test(raw)) {
      return {
        valid: false,
        error: allowZero
          ? 'Summa noto\'g\'ri (bir nechta noldan iborat son kiritilgan).'
          : minError
      };
    }
    if (raw.length > 1 && raw.startsWith('0')) {
      return { valid: false, error: 'Summa noto\'g\'ri (noldan boshlanuvchi son kiritilgan).' };
    }
    cleanDigits = raw;
  } else if (COMMA_GROUPED_REGEX.test(raw)) {
    // Comma-separated thousands (e.g. 120,000; 450,000; 1,200,000)
    cleanDigits = raw.replace(/,/g, '');
  } else if (SPACE_GROUPED_REGEX.test(raw)) {
    // Space-separated thousands (e.g. 120 000; 450 000; 1 200 000)
    cleanDigits = raw.replace(/[ \u00A0\u202F]/g, '');
  } else {
    // Did not match valid formats. Determine specific user-friendly error message.
    if (raw.includes(',')) {
      return {
        valid: false,
        error: 'Noto\'g\'ri summa formati. Minglik ajratgichlardan to\'g\'ri foydalaning (masalan: 450000 yoki 450,000). Kasr sonlar qabul qilinmaydi.'
      };
    }
    if (/[ \u00A0\u202F]/.test(raw)) {
      return {
        valid: false,
        error: 'Noto\'g\'ri summa formati. Bo\'sh joy bilan minglik ajratgichlardan to\'g\'ri foydalaning (masalan: 450 000).'
      };
    }
    return {
      valid: false,
      error: digitsOnlyError
    };
  }

  // Validate safe integer upper bound: Number.MAX_SAFE_INTEGER is 9007199254740991 (16 digits)
  if (cleanDigits.length > 16 || BigInt(cleanDigits) > BigInt(Number.MAX_SAFE_INTEGER)) {
    return {
      valid: false,
      error: 'Kiritilgan summa ruxsat etilgan maksimal miqdordan oshib ketdi.'
    };
  }

  const numericValue = Number(cleanDigits);

  if (!Number.isSafeInteger(numericValue) || (allowZero ? numericValue < 0 : numericValue <= 0)) {
    return {
      valid: false,
      error: minError
    };
  }

  return {
    valid: true,
    value: numericValue,
    formatted: formatUzbekSom(numericValue)
  };
}

/**
 * Parses and validates an input string into a positive safe integer payment amount in UZS (> 0).
 *
 * Accepted formats:
 * - Pure integer: "120000", "120001", "450000"
 * - Comma-separated thousands: "120,000", "450,000", "1,200,000"
 * - Space-separated thousands: "120 000", "450 000", "1 200 000"
 *
 * @param {string|number|null|undefined} input
 * @returns {ParseResult}
 */
export function parsePaymentAmount(input) {
  return parseUzsIntegerAmount(input, {
    allowZero: false,
    emptyError: 'To\'lov summasini kiriting.',
    minError: 'To\'lov summasi 0 dan katta bo\'lishi shart.',
    decimalError: 'To\'lov summasi butun son bo\'lishi shart (tiyinlar qabul qilinmaydi).',
    digitsOnlyError: 'To\'lov summasi faqat raqamlardan iborat bo\'lishi shart.'
  });
}

/**
 * Parses and validates an input string into a non-negative safe integer monthly fee in UZS (>= 0).
 * Accepts 0 (for scholarship/free students) as well as plain, comma-grouped, and space-grouped integers.
 *
 * Accepted formats:
 * - Zero: "0"
 * - Pure integer: "120000", "120001", "450000"
 * - Comma-separated thousands: "120,000", "450,000", "1,200,000"
 * - Space-separated thousands: "120 000", "450 000", "1 200 000"
 *
 * @param {string|number|null|undefined} input
 * @returns {ParseResult}
 */
export function parseMonthlyFee(input) {
  return parseUzsIntegerAmount(input, {
    allowZero: true,
    emptyError: 'O\'quvchining oylik to\'lov summasini kiriting.',
    minError: 'Oylik to\'lov noldan kichik bo\'lmagan butun son bo\'lishi shart.',
    decimalError: 'Oylik to\'lov butun son bo\'lishi shart (tiyinlar qabul qilinmaydi).',
    digitsOnlyError: 'Oylik to\'lov summasi faqat raqamlardan iborat bo\'lishi shart.'
  });
}
