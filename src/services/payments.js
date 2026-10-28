/**
 * Payment service providing parameterized operations with application-level validation.
 */

import { validatePaymentInput, idSchema } from '../validators/index.js';
import { getCurrentUtcIsoString } from '../utils/date.js';
import { createReceiptForPayment, getReceiptByPaymentId } from './receipts.js';

function hasColumn(db, table, col) {
  try {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all();
    return cols.some((c) => c.name === col);
  } catch {
    return false;
  }
}

function hasTable(db, table) {
  try {
    const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table);
    return Boolean(row);
  } catch {
    return false;
  }
}

/**
 * Records a new payment using parameterized SQL.
 * Foreign-key constraint ensures student exists, otherwise throws constraint error.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {{ student_id: number, amount: number, payment_date: string, billing_month?: string, payment_method?: string, status?: 'pending'|'confirmed' }} data
 * @returns {Object}
 */
export function createPayment(db, data) {
  const validated = validatePaymentInput(data);
  const createdAt = getCurrentUtcIsoString();
  const paymentDate = validated.payment_date;
  const billingMonth = validated.billing_month || paymentDate.substring(0, 7);
  const paymentMethod = validated.payment_method || 'cash';
  const status = validated.status || 'confirmed';
  const confirmedAt = status === 'confirmed' ? createdAt : null;

  const supportsNewSchema = hasColumn(db, 'payments', 'billing_month');

  const runInsert = db.transaction(() => {
    let paymentId;
    if (supportsNewSchema) {
      const stmt = db.prepare(`
        INSERT INTO payments (student_id, amount, payment_date, billing_month, payment_method, status, confirmed_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const info = stmt.run(
        validated.student_id,
        validated.amount,
        paymentDate,
        billingMonth,
        paymentMethod,
        status,
        confirmedAt,
        createdAt
      );
      paymentId = Number(info.lastInsertRowid);
    } else {
      const stmt = db.prepare(
        'INSERT INTO payments (student_id, amount, payment_date, created_at) VALUES (?, ?, ?, ?)'
      );
      const info = stmt.run(validated.student_id, validated.amount, paymentDate, createdAt);
      paymentId = Number(info.lastInsertRowid);
    }

    let receipt = null;
    // If payment is confirmed and receipts table exists, create a persistent receipt
    if (status === 'confirmed' && hasTable(db, 'receipts')) {
      receipt = createReceiptForPayment(db, paymentId);
    }

    return {
      id: paymentId,
      student_id: validated.student_id,
      amount: validated.amount,
      payment_date: paymentDate,
      billing_month: billingMonth,
      payment_method: paymentMethod,
      status,
      confirmed_at: confirmedAt,
      created_at: createdAt,
      receipt_id: receipt ? receipt.id : null,
      receipt_number: receipt ? receipt.receipt_number : null
    };
  });

  return runInsert();
}

/**
 * Confirms a pending payment inside a transaction and issues a unique persistent receipt.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} paymentId
 * @returns {{ payment: Object, receipt: Object }}
 */
export function confirmPayment(db, paymentId) {
  const validId = idSchema.parse(paymentId);

  const runConfirm = db.transaction(() => {
    const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(validId);
    if (!payment) {
      const error = new Error(`Payment with ID ${validId} not found`);
      error.statusCode = 404;
      throw error;
    }

    if (payment.status === 'rejected') {
      const error = new Error(`Cannot confirm a rejected payment with ID ${validId}`);
      error.statusCode = 400;
      throw error;
    }

    const receipt = createReceiptForPayment(db, validId);
    const updatedPayment = db.prepare('SELECT * FROM payments WHERE id = ?').get(validId);

    return {
      payment: updatedPayment,
      receipt
    };
  });

  return runConfirm();
}

/**
 * Rejects a pending payment inside a transaction.
 * Confirmed payments with issued receipts cannot be rejected.
 * Idempotent: repeated calls on an already rejected payment return the payment.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} paymentId
 * @returns {Object}
 */
export function rejectPayment(db, paymentId) {
  const validId = idSchema.parse(paymentId);

  const runReject = db.transaction(() => {
    const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(validId);
    if (!payment) {
      const error = new Error(`Payment with ID ${validId} not found`);
      error.statusCode = 404;
      throw error;
    }

    if (payment.status === 'confirmed') {
      const error = new Error(`Cannot reject already confirmed payment with ID ${validId}`);
      error.statusCode = 400;
      throw error;
    }

    if (payment.status === 'rejected') {
      return payment;
    }

    db.prepare("UPDATE payments SET status = 'rejected' WHERE id = ?").run(validId);
    return db.prepare('SELECT * FROM payments WHERE id = ?').get(validId);
  });

  return runReject();
}

/**
 * Retrieves a payment by ID.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} paymentId
 * @returns {Object|null}
 */
export function getPaymentById(db, paymentId) {
  const validId = idSchema.parse(paymentId);
  const row = db.prepare(`
    SELECT p.*, r.id AS receipt_id, r.receipt_number
    FROM payments p
    LEFT JOIN receipts r ON r.payment_id = p.id
    WHERE p.id = ?
  `).get(validId);
  return row || null;
}

/**
 * Retrieves all payments for a specific student ordered by payment date and id.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} studentId
 * @returns {Array<Object>}
 */
export function getPaymentsByStudent(db, studentId) {
  const validStudentId = idSchema.parse(studentId);
  const supportsReceipts = hasTable(db, 'receipts');

  if (supportsReceipts) {
    const stmt = db.prepare(`
      SELECT p.*, r.id AS receipt_id, r.receipt_number
      FROM payments p
      LEFT JOIN receipts r ON r.payment_id = p.id
      WHERE p.student_id = ?
      ORDER BY p.payment_date ASC, p.id ASC
    `);
    return stmt.all(validStudentId);
  }

  const stmt = db.prepare(
    'SELECT id, student_id, amount, payment_date, created_at FROM payments WHERE student_id = ? ORDER BY payment_date ASC, id ASC'
  );
  return stmt.all(validStudentId);
}

/**
 * Retrieves all recorded payments.
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {Array<Object>}
 */
export function listPayments(db) {
  const supportsReceipts = hasTable(db, 'receipts');
  if (supportsReceipts) {
    const stmt = db.prepare(`
      SELECT p.*, r.id AS receipt_id, r.receipt_number
      FROM payments p
      LEFT JOIN receipts r ON r.payment_id = p.id
      ORDER BY p.payment_date ASC, p.id ASC
    `);
    return stmt.all();
  }

  const stmt = db.prepare(
    'SELECT id, student_id, amount, payment_date, created_at FROM payments ORDER BY payment_date ASC, id ASC'
  );
  return stmt.all();
}
