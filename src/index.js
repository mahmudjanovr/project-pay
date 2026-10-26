/**
 * Project Pay — Backend API & Business Foundation
 * Main entry point re-exporting connection, initialization, schemas, services, and Express app.
 */

export { createDatabase } from './db/connection.js';
export { initDatabase } from './db/init.js';
export { migrations } from './db/schema.js';

export {
  studentNameSchema,
  studentPhoneSchema,
  monthlyFeeSchema,
  paymentAmountSchema,
  paymentDateSchema,
  reportMonthSchema,
  groupNameSchema,
  groupIdSchema,
  idSchema,
  routeIdSchema,
  createGroupSchema,
  updateGroupSchema,
  createStudentSchema,
  updateStudentSchema,
  createPaymentSchema,
  parseRouteId,
  validateGroupInput,
  validateUpdateGroupInput,
  validateGroupName,
  validateStudentInput,
  validateUpdateStudentInput,
  validatePaymentInput,
  validateStudentName,
  validateStudentPhone,
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
  updateStudent,
  deleteStudent
} from './services/students.js';

export {
  createGroup,
  getGroupById,
  listGroups,
  updateGroup,
  deleteGroup,
  getStudentsByGroupId
} from './services/groups.js';

export {
  createPayment,
  getPaymentsByStudent,
  listPayments
} from './services/payments.js';

export {
  getMonthlyDebtors,
  MONTHLY_DEBTORS_QUERY
} from './services/debtors.js';

export { createApp } from './app.js';
export { startServer, PORT, DB_PATH } from './server.js';
export { createStudentRouter } from './routes/students.js';
export { createGroupRouter } from './routes/groups.js';
export { createPaymentRouter } from './routes/payments.js';
export { createReportRouter, createDebtorsHandler } from './routes/reports.js';

