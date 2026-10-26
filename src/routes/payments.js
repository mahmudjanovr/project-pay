/**
 * Express router for payment endpoints.
 */

import { Router } from 'express';
import { createPayment } from '../services/payments.js';
import { getStudentById } from '../services/students.js';
import { validatePaymentInput } from '../validators/index.js';

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

  return router;
}
