/**
 * Project Pay — Phase 1: Database Foundation and Business Rules
 * Main entry point re-exporting connection, initialization, schemas, and services.
 */

export { createDatabase } from './db/connection.js';
export { initDatabase } from './db/init.js';
export { migrations } from './db/schema.js';

export {
  studentNameSchema,
  monthlyFeeSchema,
  paymentAmountSchema,
  paymentDateSchema,
  reportMonthSchema,
  createStudentSchema,
  createPaymentSchema,
  validateStudentInput,
  validatePaymentInput,
  validateStudentName,
  validateMonthlyFee,
  validatePaymentAmount,
  validatePaymentDate,
  validateReportMonth
} from './validators/index.js';

export {
  isLeapYear,
  getDaysInMonth,
  isValidCalendarDate,
  isValidReportMonth,
  getMonthDateRange,
  getCurrentUtcIsoString
} from './utils/date.js';

export {
  createStudent,
  getStudentById,
  listStudents,
  deleteStudent
} from './services/students.js';

export {
  createPayment,
  getPaymentsByStudent,
  listPayments
} from './services/payments.js';

export {
  getMonthlyDebtors,
  MONTHLY_DEBTORS_QUERY
} from './services/debtors.js';
