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
  .min(1, { message: 'Student name cannot be empty' })
  .max(200, { message: 'Student name cannot exceed 200 characters' });

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
  .trim()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, {
    message: 'Report month must be in exact YYYY-MM format with month between 01 and 12'
  });

/**
 * Validates billing month for payments:
 * - Must be a string.
 * - Must match exact YYYY-MM pattern with month in 01-12.
 */
export const billingMonthSchema = z.string({
  message: 'Billing month must be a string'
})
  .trim()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, {
    message: 'Billing month must be in exact YYYY-MM format with month between 01 and 12'
  });

export function validateBillingMonth(month) {
  return billingMonthSchema.parse(month);
}

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
 * Validates route parameter string ID (e.g. req.params.id) and converts to safe integer.
 */
export const routeIdSchema = z.string({
  message: 'Route parameter ID must be a string'
})
  .regex(/^[1-9]\d*$/, {
    message: 'Route parameter ID must be a positive integer'
  })
  .transform((val) => Number(val))
  .refine((val) => Number.isSafeInteger(val) && val > 0, {
    message: 'Route parameter ID must be a positive safe integer'
  });

/**
 * Parses and validates route parameter ID.
 *
 * @param {unknown} param
 * @returns {number}
 */
export function parseRouteId(param) {
  return routeIdSchema.parse(param);
}

/**
 * Validates group name:
 * - Must be a string.
 * - Whitespace is trimmed.
 * - Must not be empty after trimming.
 */
export const groupNameSchema = z.string({
  message: 'Group name must be a string'
})
  .trim()
  .min(1, { message: 'Group name cannot be empty' })
  .max(150, { message: 'Group name cannot exceed 150 characters' });

/**
 * Validates group ID:
 * - Must be a positive safe integer or null.
 */
export const groupIdSchema = idSchema.nullable();

/**
 * Schema for creating a group record.
 */
export const createGroupSchema = z.object({
  name: groupNameSchema
}).strict();

/**
 * Schema for updating a group record.
 */
export const updateGroupSchema = z.object({
  name: groupNameSchema
}).strict();

/**
 * Validates optional student phone number:
 * - Must be a string or null (no silent coercion from numbers/booleans).
 * - Trims surrounding whitespace.
 * - Normalizes empty/blank strings to null.
 * - Rejects overly long values (> 50 chars).
 */
export const studentPhoneSchema = z.string({
  message: 'Student phone must be a string'
})
  .trim()
  .max(50, { message: 'Student phone cannot exceed 50 characters' })
  .nullable()
  .transform((val) => (val === null || val === '' ? null : val));

/**
 * Validates optional student enrollment date (YYYY-MM or YYYY-MM-DD):
 */
export const enrollmentDateSchema = z.string({
  message: 'Enrollment date must be a string'
})
  .trim()
  .regex(/^\d{4}-(0[1-9]|1[0-2])(-([0-2][0-9]|3[01]))?$/, {
    message: 'Enrollment date must be in YYYY-MM or YYYY-MM-DD format'
  })
  .nullable()
  .transform((val) => (val === null || val === '' ? null : val));

/**
 * Schema for creating a student record.
 */
export const createStudentSchema = z.object({
  full_name: studentNameSchema,
  phone: studentPhoneSchema.optional(),
  monthly_fee: monthlyFeeSchema,
  group_id: groupIdSchema.optional(),
  enrollment_date: enrollmentDateSchema.optional()
}).strict();

/**
 * Schema for updating a student record partially.
 * Rejects empty updates and unrecognized keys.
 */
export const updateStudentSchema = z.object({
  full_name: studentNameSchema.optional(),
  phone: studentPhoneSchema.optional(),
  monthly_fee: monthlyFeeSchema.optional(),
  group_id: groupIdSchema.optional(),
  enrollment_date: enrollmentDateSchema.optional()
})
  .strict()
  .refine(
    (data) =>
      data.full_name !== undefined ||
      data.phone !== undefined ||
      data.monthly_fee !== undefined ||
      data.group_id !== undefined ||
      data.enrollment_date !== undefined,
    {
      message: 'At least one field (full_name, phone, monthly_fee, group_id, or enrollment_date) must be provided for update'
    }
  );

/**
 * Validates partial student update input fields.
 *
 * @param {unknown} input
 * @returns {{ full_name?: string, phone?: string|null, monthly_fee?: number, group_id?: number|null }}
 */
export function validateUpdateStudentInput(input) {
  return updateStudentSchema.parse(input);
}

/**
 * Validates group creation input fields.
 *
 * @param {unknown} input
 * @returns {{ name: string }}
 */
export function validateGroupInput(input) {
  return createGroupSchema.parse(input);
}

/**
 * Validates group update input fields.
 *
 * @param {unknown} input
 * @returns {{ name: string }}
 */
export function validateUpdateGroupInput(input) {
  return updateGroupSchema.parse(input);
}

/**
 * Validates group name value.
 *
 * @param {unknown} name
 * @returns {string}
 */
export function validateGroupName(name) {
  return groupNameSchema.parse(name);
}

/**
 * Validates payment status ('pending' or 'confirmed').
 */
export const paymentStatusSchema = z.enum(['pending', 'confirmed'], {
  message: "Payment status must be 'pending' or 'confirmed'"
});

/**
 * Validates payment method ('cash', 'bank_transfer', 'card', 'other').
 */
export const paymentMethodSchema = z.enum(['cash', 'bank_transfer', 'card', 'other'], {
  message: "Payment method must be 'cash', 'bank_transfer', 'card', or 'other'"
});

/**
 * Schema for creating a payment record.
 */
export const createPaymentSchema = z.object({
  student_id: idSchema,
  amount: paymentAmountSchema,
  payment_date: paymentDateSchema,
  billing_month: billingMonthSchema.optional(),
  payment_method: paymentMethodSchema.optional(),
  status: paymentStatusSchema.optional()
}).strict();

/**
 * Schema for assigning multiple existing students to a group.
 */
export const assignStudentsSchema = z.object({
  student_ids: z.array(idSchema).min(1, {
    message: "Kamida bitta o'quvchi tanlanishi lozim"
  })
}).strict();

/**
 * Validates report year (YYYY).
 */
export const reportYearSchema = z.string({
  message: 'Report year must be a string'
}).regex(/^\d{4}$/, {
  message: 'Report year must be in exact YYYY format'
});

export function validateAssignStudentsInput(input) {
  return assignStudentsSchema.parse(input);
}

export function validateReportYear(year) {
  return reportYearSchema.parse(year);
}

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
 * Validates and normalizes an optional student phone value.
 *
 * @param {unknown} phone
 * @returns {string | null}
 */
export function validateStudentPhone(phone) {
  return studentPhoneSchema.parse(phone);
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
