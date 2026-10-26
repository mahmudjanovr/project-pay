/**
 * Validation utilities and Zod schemas for Project Pay.
 * Enforces strict financial and temporal data integrity rules.
 */

import { z } from 'zod';
import { isValidCalendarDate, isValidReportMonth } from '../utils/date.js';

/**
 * Validates and trims student name:
 * - Must be a string.
 * - Whitespace is trimmed.
 * - Must not be empty after trimming.
 */
export const studentNameSchema = z.string({
  message: 'Student name must be a string'
})
  .trim()
  .min(1, { message: 'Student name cannot be empty' });

/**
 * Validates monthly fee in Uzbek Som (UZS):
 * - Must be a number (no silent type coercion from string or boolean).
 * - Must be a safe integer (no fractional amounts, NaN, Infinity).
 * - Must be non-negative (0 is permitted for scholarship/free students; negative values rejected).
 * - Rejects -0.
 */
export const monthlyFeeSchema = z.number({
  message: 'Monthly fee must be a number'
})
  .refine((val) => Number.isSafeInteger(val), {
    message: 'Monthly fee must be a safe integer'
  })
  .refine((val) => val >= 0 && !Object.is(val, -0), {
    message: 'Monthly fee must be a non-negative integer'
  });

/**
 * Validates payment amount in Uzbek Som (UZS):
 * - Must be a number.
 * - Must be a safe integer.
 * - Must be strictly positive (> 0; zero and negative payments are rejected).
 */
export const paymentAmountSchema = z.number({
  message: 'Payment amount must be a number'
})
  .refine((val) => Number.isSafeInteger(val), {
    message: 'Payment amount must be a safe integer'
  })
  .refine((val) => val > 0, {
    message: 'Payment amount must be a positive integer'
  });

/**
 * Validates payment date:
 * - Must be a string.
 * - Must match exact YYYY-MM-DD pattern.
 * - Must be a valid calendar date (rejects invalid leap days like 2023-02-29 and out-of-range days like 2024-04-31).
 */
export const paymentDateSchema = z.string({
  message: 'Payment date must be a string'
})
  .regex(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'Payment date must be in exact YYYY-MM-DD format'
  })
  .refine(isValidCalendarDate, {
    message: 'Payment date must be a valid calendar date'
  });

/**
 * Validates report month:
 * - Must be a string.
 * - Must match exact YYYY-MM pattern with month in 01-12.
 */
export const reportMonthSchema = z.string({
  message: 'Report month must be a string'
})
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, {
    message: 'Report month must be in exact YYYY-MM format with month between 01 and 12'
  });

/**
 * Validates positive safe integer ID (e.g. student_id).
 */
export const idSchema = z.number({
  message: 'ID must be a number'
})
  .refine((val) => Number.isSafeInteger(val) && val > 0, {
    message: 'ID must be a positive safe integer'
  });

/**
 * Schema for creating a student record.
 */
export const createStudentSchema = z.object({
  full_name: studentNameSchema,
  monthly_fee: monthlyFeeSchema
}).strict();

/**
 * Schema for creating a payment record.
 */
export const createPaymentSchema = z.object({
  student_id: idSchema,
  amount: paymentAmountSchema,
  payment_date: paymentDateSchema
}).strict();

// Reusable validation helper functions

/**
 * Validates student input fields.
 * Returns trimmed full_name and integer monthly_fee.
 *
 * @param {unknown} input
 * @returns {{ full_name: string, monthly_fee: number }}
 */
export function validateStudentInput(input) {
  return createStudentSchema.parse(input);
}

/**
 * Validates payment input fields.
 *
 * @param {unknown} input
 * @returns {{ student_id: number, amount: number, payment_date: string }}
 */
export function validatePaymentInput(input) {
  return createPaymentSchema.parse(input);
}

/**
 * Validates a student full_name value.
 *
 * @param {unknown} name
 * @returns {string}
 */
export function validateStudentName(name) {
  return studentNameSchema.parse(name);
}

/**
 * Validates a monthly_fee value.
 *
 * @param {unknown} fee
 * @returns {number}
 */
export function validateMonthlyFee(fee) {
  return monthlyFeeSchema.parse(fee);
}

/**
 * Validates a payment amount value.
 *
 * @param {unknown} amount
 * @returns {number}
 */
export function validatePaymentAmount(amount) {
  return paymentAmountSchema.parse(amount);
}

/**
 * Validates a payment date string.
 *
 * @param {unknown} date
 * @returns {string}
 */
export function validatePaymentDate(date) {
  return paymentDateSchema.parse(date);
}

/**
 * Validates a report month string.
 *
 * @param {unknown} month
 * @returns {string}
 */
export function validateReportMonth(month) {
  return reportMonthSchema.parse(month);
}
