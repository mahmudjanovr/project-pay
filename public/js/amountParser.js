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
// e.g. 1 000; 120 000; 1 200 000 (supports standard space and non-breaking space \u00A0)
const SPACE_GROUPED_REGEX = /^[1-9]\d{0,2}([ \u00A0]\d{3})+$/;

/**
 * Result returned by parsePaymentAmount.
 * @typedef {Object} ParseResult
 * @property {boolean} valid - Whether the amount is a valid positive safe integer.
 * @property {number} [value] - Parsed integer value (if valid).
 * @property {string} [formatted] - Formatted Uzbek Som string (if valid).
 * @property {string} [error] - Localized Uzbek error message (if invalid).
 */

/**
 * Parses and validates an input string into a positive safe integer in UZS.
 *
 * Accepted formats:
 * - Pure integer: "120000", "120001"
 * - Comma-separated thousands: "120,000", "1,200,000"
 * - Space-separated thousands: "120 000", "1 200 000"
 *
 * Rejection rules:
 * - Empty or whitespace-only inputs.
 * - Decimals with dot (e.g. "120.50", "120000.00").
 * - Decimals with comma or malformed separators (e.g. "120,50", "120,00", "120,5").
 * - Non-positive values ("0", "-500").
 * - Values exceeding Number.MAX_SAFE_INTEGER.
 * - Non-numeric characters or mixed separators ("120a", "120,000 000").
 *
 * @param {string|number|null|undefined} input
 * @returns {ParseResult}
 */
export function parsePaymentAmount(input) {
  if (input === null || input === undefined) {
    return { valid: false, error: 'To\'lov summasini kiriting.' };
  }

  // Convert input to string and trim leading/trailing whitespace
  const raw = String(input).trim();

  if (raw === '') {
    return { valid: false, error: 'To\'lov summasini kiriting.' };
  }

  // Reject negative numbers
  if (raw.startsWith('-')) {
    return { valid: false, error: 'To\'lov summasi 0 dan katta bo\'lishi shart.' };
  }

  // Reject explicit decimal point (tiyinlar)
  if (raw.includes('.')) {
    return { valid: false, error: 'To\'lov summasi butun son bo\'lishi shart (tiyinlar qabul qilinmaydi).' };
  }

  let cleanDigits = '';

  if (PURE_DIGITS_REGEX.test(raw)) {
    // Pure digits check
    if (raw === '0' || /^0+$/.test(raw)) {
      return { valid: false, error: 'To\'lov summasi 0 dan katta bo\'lishi shart.' };
    }
    if (raw.length > 1 && raw.startsWith('0')) {
      return { valid: false, error: 'To\'lov summasi noto\'g\'ri (noldan boshlanuvchi son kiritilgan).' };
    }
    cleanDigits = raw;
  } else if (COMMA_GROUPED_REGEX.test(raw)) {
    // Comma-separated thousands (e.g. 120,000 or 1,200,000)
    cleanDigits = raw.replace(/,/g, '');
  } else if (SPACE_GROUPED_REGEX.test(raw)) {
    // Space-separated thousands (e.g. 120 000 or 1 200 000)
    cleanDigits = raw.replace(/[ \u00A0]/g, '');
  } else {
    // Did not match valid formats. Determine specific user-friendly error message.
    if (raw.includes(',')) {
      return {
        valid: false,
        error: 'Noto\'g\'ri summa formati. Minglik ajratgichlardan to\'g\'ri foydalaning (masalan: 120000 yoki 120,000). Kasr sonlar qabul qilinmaydi.'
      };
    }
    if (/[ \u00A0]/.test(raw)) {
      return {
        valid: false,
        error: 'Noto\'g\'ri summa formati. Bo\'sh joy bilan minglik ajratgichlardan to\'g\'ri foydalaning (masalan: 120 000).'
      };
    }
    return {
      valid: false,
      error: 'To\'lov summasi faqat raqamlardan iborat bo\'lishi shart.'
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

  if (!Number.isSafeInteger(numericValue) || numericValue <= 0) {
    return {
      valid: false,
      error: 'To\'lov summasi 0 dan katta butun son bo\'lishi shart.'
    };
  }

  return {
    valid: true,
    value: numericValue,
    formatted: formatUzbekSom(numericValue)
  };
}
