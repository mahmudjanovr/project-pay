/**
 * Receipt generation and persistence service for Ecomdev.
 * Manages unique, stable receipt records and PDF generation using PDFKit.
 */

import PDFDocument from 'pdfkit';
import { getCurrentUtcIsoString } from '../utils/date.js';
import { formatUzbekSom, formatMonthName, formatDate } from '../../public/js/formatters.js';

const receiptStmtCache = new WeakMap();

function getReceiptStmts(db) {
  let stmts = receiptStmtCache.get(db);
  if (!stmts) {
    stmts = {
      getByPaymentId: db.prepare(`
        SELECT r.*, s.full_name AS student_name, s.phone AS student_phone, g.name AS group_name,
               p.payment_date, p.payment_method, p.status AS payment_status, p.confirmed_at
        FROM receipts r
        JOIN payments p ON p.id = r.payment_id
        JOIN students s ON s.id = r.student_id
        LEFT JOIN groups g ON g.id = s.group_id
        WHERE r.payment_id = ?
      `),
      getById: db.prepare(`
        SELECT r.*, s.full_name AS student_name, s.phone AS student_phone, g.name AS group_name,
               p.payment_date, p.payment_method, p.status AS payment_status, p.confirmed_at
        FROM receipts r
        JOIN payments p ON p.id = r.payment_id
        JOIN students s ON s.id = r.student_id
        LEFT JOIN groups g ON g.id = s.group_id
        WHERE r.id = ?
      `),
      getByStudent: db.prepare(`
        SELECT r.*, p.payment_date, p.payment_method, p.status AS payment_status, p.confirmed_at
        FROM receipts r
        JOIN payments p ON p.id = r.payment_id
        WHERE r.student_id = ?
        ORDER BY r.id DESC
      `),
      insert: db.prepare(`
        INSERT INTO receipts (receipt_number, payment_id, student_id, amount, billing_month, issued_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
    };
    receiptStmtCache.set(db, stmts);
  }
  return stmts;
}

/**
 * Generates a unique, stable receipt number for a billing month:
 * Format: REC-YYYYMM-00001
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} billingMonth - Format: YYYY-MM
 * @returns {string}
 */
export function generateReceiptNumber(db, billingMonth) {
  const cleanMonth = (billingMonth || '2026-01').replace('-', '');
  const prefix = `REC-${cleanMonth}-`;

  const latest = db.prepare(`
    SELECT receipt_number FROM receipts
    WHERE receipt_number LIKE ?
    ORDER BY id DESC LIMIT 1
  `).get(`${prefix}%`);

  let nextSeq = 1;
  if (latest && latest.receipt_number) {
    const parts = latest.receipt_number.split('-');
    const lastNum = parseInt(parts[parts.length - 1], 10);
    if (!Number.isNaN(lastNum)) {
      nextSeq = lastNum + 1;
    }
  }

  return `${prefix}${String(nextSeq).padStart(5, '0')}`;
}

/**
 * Creates or retrieves a persistent receipt for a confirmed payment.
 * Transactional and idempotent: repeated calls return the existing receipt.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} paymentId
 * @returns {Object} The persistent receipt record.
 */
export function createReceiptForPayment(db, paymentId) {
  const { getByPaymentId, insert } = getReceiptStmts(db);

  const runCreate = db.transaction(() => {
    // Check if receipt already exists for this payment (idempotent / duplicate protection)
    const existing = getByPaymentId.get(paymentId);
    if (existing) {
      return existing;
    }

    // Load payment
    const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId);
    if (!payment) {
      const error = new Error(`Payment with ID ${paymentId} not found`);
      error.statusCode = 404;
      throw error;
    }

    if (payment.status === 'rejected') {
      const error = new Error(`Cannot issue receipt for rejected payment with ID ${paymentId}`);
      error.statusCode = 400;
      throw error;
    }

    const issuedAt = getCurrentUtcIsoString();
    const billingMonth = payment.billing_month || payment.payment_date.substring(0, 7);

    // If payment is pending, confirm it now
    if (payment.status !== 'confirmed') {
      db.prepare(`
        UPDATE payments
        SET status = 'confirmed', confirmed_at = ?
        WHERE id = ?
      `).run(issuedAt, paymentId);
    }

    const receiptNumber = generateReceiptNumber(db, billingMonth);

    const info = insert.run(
      receiptNumber,
      payment.id,
      payment.student_id,
      payment.amount,
      billingMonth,
      issuedAt
    );

    return getByPaymentId.get(paymentId);
  });

  return runCreate();
}

/**
 * Retrieves a receipt by its ID.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} receiptId
 * @returns {Object|null}
 */
export function getReceiptById(db, receiptId) {
  const { getById } = getReceiptStmts(db);
  return getById.get(receiptId) || null;
}

/**
 * Retrieves a receipt by payment ID.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} paymentId
 * @returns {Object|null}
 */
export function getReceiptByPaymentId(db, paymentId) {
  const { getByPaymentId } = getReceiptStmts(db);
  return getByPaymentId.get(paymentId) || null;
}

/**
 * Normalizes Uzbek text characters for standard PDF Helvetica font rendering.
 * Replaces unicode modifiers/curly quotes with standard ASCII single quote.
 *
 * @param {string} text
 * @returns {string}
 */
function sanitizeUzbekPdfText(text) {
  if (!text) return '';
  return String(text).replace(/[\u02BB\u02BC\u2018\u2019`]/g, "'");
}

/**
 * Generates a clean, professional downloadable PDF receipt buffer.
 *
 * @param {Object} receipt
 * @returns {Promise<Buffer>}
 */
export function generateReceiptPdfBuffer(receipt) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A5',
      layout: 'portrait',
      margin: 36
    });

    const buffers = [];
    doc.on('data', (chunk) => buffers.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', (err) => reject(err));

    const methodLabels = {
      cash: "Naqd pul",
      bank_transfer: "Bank o'tkazmasi",
      card: "Plastik karta",
      other: "Boshqa"
    };

    const studentName = sanitizeUzbekPdfText(receipt.student_name || 'Noma\'lum o\'quvchi');
    const groupName = sanitizeUzbekPdfText(receipt.group_name || 'Guruhsiz');
    const receiptNum = sanitizeUzbekPdfText(receipt.receipt_number || 'REC-0000');
    const amountStr = sanitizeUzbekPdfText(formatUzbekSom(receipt.amount));
    const billingMonthStr = sanitizeUzbekPdfText(formatMonthName(receipt.billing_month));
    const paymentDateStr = sanitizeUzbekPdfText(formatDate(receipt.payment_date));
    const confirmedAtStr = sanitizeUzbekPdfText(receipt.confirmed_at ? formatDate(receipt.confirmed_at) : formatDate(receipt.issued_at));
    const methodStr = sanitizeUzbekPdfText(methodLabels[receipt.payment_method] || 'Naqd pul');

    // Header styling
    doc.rect(0, 0, doc.page.width, 70).fill('#1e293b');

    doc.fillColor('#ffffff').fontSize(18).font('Helvetica-Bold')
       .text('ECOMDEV', 36, 20);
    doc.fontSize(10).font('Helvetica')
       .text('Moliya va To\'lovlar Boshqaruvi Markazi', 36, 42);

    doc.fillColor('#38bdf8').fontSize(11).font('Helvetica-Bold')
       .text('TO\'LOV KVITANSIYASI (CHEK)', doc.page.width - 220, 26, { width: 184, align: 'right' });

    // Receipt Meta Bar
    doc.moveDown(2.5);
    const startY = 85;

    doc.rect(36, startY, doc.page.width - 72, 34).fillAndStroke('#f8fafc', '#e2e8f0');
    doc.fillColor('#475569').fontSize(9).font('Helvetica')
       .text('Chek raqami:', 46, startY + 6);
    doc.fillColor('#0f172a').fontSize(10).font('Helvetica-Bold')
       .text(receiptNum, 46, startY + 18);

    doc.fillColor('#475569').fontSize(9).font('Helvetica')
       .text('Berilgan sana:', doc.page.width - 180, startY + 6);
    doc.fillColor('#0f172a').fontSize(10).font('Helvetica-Bold')
       .text(confirmedAtStr, doc.page.width - 180, startY + 18);

    // Details Grid
    const detailsY = startY + 50;
    doc.fillColor('#0f172a').fontSize(12).font('Helvetica-Bold')
       .text('To\'lov Tafsilotlari', 36, detailsY);

    const rows = [
      ['To\'lov ID:', `#${receipt.payment_id}`],
      ['O\'quvchi F.I.SH.:', studentName],
      ['O\'quv guruhi:', groupName],
      ['To\'lov hisoblangan oy:', billingMonthStr],
      ['To\'lov sanasi:', paymentDateStr],
      ['To\'lov usuli:', methodStr],
      ['Holati:', 'Tasdiqlangan']
    ];

    let currentY = detailsY + 22;
    for (const [label, val] of rows) {
      doc.rect(36, currentY, doc.page.width - 72, 22).fill(currentY % 2 === 0 ? '#ffffff' : '#f8fafc');
      doc.fillColor('#64748b').fontSize(9).font('Helvetica')
         .text(label, 44, currentY + 6);
      doc.fillColor('#1e293b').fontSize(9).font('Helvetica-Bold')
         .text(val, 180, currentY + 6, { width: doc.page.width - 224, align: 'right' });
      currentY += 22;
    }

    // Total Highlight Box
    currentY += 12;
    doc.rect(36, currentY, doc.page.width - 72, 46).fillAndStroke('#ecfdf5', '#10b981');
    doc.fillColor('#065f46').fontSize(10).font('Helvetica-Bold')
       .text('JAMI TO\'LANGAN SUMMA:', 46, currentY + 16);
    doc.fillColor('#047857').fontSize(16).font('Helvetica-Bold')
       .text(amountStr, doc.page.width - 236, currentY + 12, { width: 190, align: 'right' });

    // Footer & Security Seal
    const footerY = doc.page.height - 75;
    doc.strokeColor('#cbd5e1').lineWidth(0.5)
       .moveTo(36, footerY).lineTo(doc.page.width - 36, footerY).stroke();

    doc.fillColor('#94a3b8').fontSize(7.5).font('Helvetica')
       .text('Ecomdev elektron to\'lov nazorati tizimi orqali avtomatik shakllantirildi.', 36, footerY + 8, { align: 'center', width: doc.page.width - 72 });
    doc.text('Ushbu kvitansiya to\'lov qabul qilinganligini tasdiqlovchi rasmiy hisob hujjati hisoblanadi.', 36, footerY + 20, { align: 'center', width: doc.page.width - 72 });

    doc.end();
  });
}
