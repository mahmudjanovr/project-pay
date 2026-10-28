/**
 * Express router for payment endpoints.
 */

import { Router } from 'express';
import { createPayment, confirmPayment, getPaymentById } from '../services/payments.js';
import { getStudentById } from '../services/students.js';
import { getReceiptByPaymentId, generateReceiptPdfBuffer } from '../services/receipts.js';
import { validatePaymentInput, parseRouteId } from '../validators/index.js';

/**
 * Creates and configures the payment routes.
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {import('express').Router}
 */
export function createPaymentRouter(db) {
  const router = Router();

  // POST /api/payments - Record a new payment
  router.post('/', (req, res, next) => {
    try {
      const validated = validatePaymentInput(req.body);

      // Verify that referenced student exists
      const student = getStudentById(db, validated.student_id);
      if (!student) {
        return res.status(404).json({
          error: 'Not Found',
          message: `Student with ID ${validated.student_id} not found`
        });
      }

      const payment = createPayment(db, validated);
      res.status(201).json(payment);
    } catch (err) {
      next(err);
    }
  });

  // GET /api/payments/:id - Get a single payment
  router.get('/:id', (req, res, next) => {
    try {
      const paymentId = parseRouteId(req.params.id);
      const payment = getPaymentById(db, paymentId);
      if (!payment) {
        return res.status(404).json({
          error: 'Not Found',
          message: `Payment with ID ${paymentId} not found`
        });
      }
      res.status(200).json(payment);
    } catch (err) {
      next(err);
    }
  });

  // POST /api/payments/:id/confirm - Confirm a pending payment and generate persistent receipt
  router.post('/:id/confirm', (req, res, next) => {
    try {
      const paymentId = parseRouteId(req.params.id);
      const existing = getPaymentById(db, paymentId);
      if (!existing) {
        return res.status(404).json({
          error: 'Not Found',
          message: `Payment with ID ${paymentId} not found`
        });
      }

      const result = confirmPayment(db, paymentId);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  });

  // GET /api/payments/:id/receipt - Get receipt metadata for a payment
  router.get('/:id/receipt', (req, res, next) => {
    try {
      const paymentId = parseRouteId(req.params.id);
      const receipt = getReceiptByPaymentId(db, paymentId);
      if (!receipt) {
        return res.status(404).json({
          error: 'Not Found',
          message: `Receipt for payment ID ${paymentId} not found`
        });
      }
      res.status(200).json(receipt);
    } catch (err) {
      next(err);
    }
  });

  // GET /api/payments/:id/receipt/pdf - Stream downloadable PDF receipt
  router.get('/:id/receipt/pdf', async (req, res, next) => {
    try {
      const paymentId = parseRouteId(req.params.id);
      const receipt = getReceiptByPaymentId(db, paymentId);
      if (!receipt) {
        return res.status(404).json({
          error: 'Not Found',
          message: `Receipt for payment ID ${paymentId} not found`
        });
      }

      const pdfBuffer = await generateReceiptPdfBuffer(receipt);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `inline; filename="receipt-${receipt.receipt_number || paymentId}.pdf"`
      );
      res.setHeader('Content-Length', pdfBuffer.length);
      res.status(200).send(pdfBuffer);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
